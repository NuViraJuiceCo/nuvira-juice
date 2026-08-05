import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { buildLoyaltyIntegrityReport } from './loyaltyIntegrity.js';
import { buildAuthoritativeLoyaltyReconciliation } from './loyaltyReconciliation.js';
import { handleLoyaltyAdminAction } from './loyaltyAdmin.ts';

const PAGE_SIZE = 200;
const MAX_ROWS_PER_ENTITY = 5000;
const APPLY_CONFIRMATION = 'RECONCILE LOYALTY FROM AUTHORITATIVE ORDERS';
const RECONCILIATION_DEPLOYMENT = 'g68-gated-live-reconciliation-v3-closed';

async function readAll(entity: any) {
  const rows = [];
  for (let skip = 0; skip < MAX_ROWS_PER_ENTITY; skip += PAGE_SIZE) {
    const page = await entity.list('-created_date', PAGE_SIZE, skip);
    const normalized = Array.isArray(page) ? page : [];
    rows.push(...normalized);
    if (normalized.length < PAGE_SIZE) break;
  }
  return rows;
}

async function readEntity(name: string, entity: any, readErrors: string[]) {
  try {
    return await readAll(entity);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    readErrors.push(`${name}: ${message}`);
    console.error(`[loyalty-integrity] ${name} read failed: ${message}`);
    return [];
  }
}

/**
 * Scheduled, read-only aggregate loyalty integrity audit.
 *
 * The historical function name is retained only because Base44 cannot create a
 * replacement while this grandfathered app remains above the current function
 * slot ceiling. The implementation contains no named-customer expectations.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    if (['list', 'adjust_points', 'update_profile'].includes(String(body?.action || '').toLowerCase())) {
      return await handleLoyaltyAdminAction(base44, user, body);
    }
    const apply = body?.action === 'apply_reconciliation';
    if (apply && Deno.env.get('ENABLE_LOYALTY_RECONCILIATION_WRITES') !== 'true') {
      return Response.json({ error: 'loyalty_reconciliation_writes_disabled' }, { status: 409 });
    }
    if (apply && body?.confirmation !== APPLY_CONFIRMATION) {
      return Response.json({ error: 'confirmation_required', confirmation_phrase: APPLY_CONFIRMATION }, { status: 400 });
    }

    const readErrors: string[] = [];
    const [members, pointsAccounts, profiles, orders, shopifyOrders, posClaims] = await Promise.all([
      readEntity('LoyaltyMember', base44.asServiceRole.entities.LoyaltyMember, readErrors),
      readEntity('UserPoints', base44.asServiceRole.entities.UserPoints, readErrors),
      readEntity('UserProfile', base44.asServiceRole.entities.UserProfile, readErrors),
      readEntity('Order', base44.asServiceRole.entities.Order, readErrors),
      readEntity('ShopifyOrder', base44.asServiceRole.entities.ShopifyOrder, readErrors),
      readEntity('POSCustomerClaim', base44.asServiceRole.entities.POSCustomerClaim, readErrors),
    ]);

    const report = buildLoyaltyIntegrityReport({
      members,
      pointsAccounts,
      profiles,
      orders,
      shopifyOrders,
      posClaims,
      readErrors,
    });
    const reconciliation = buildAuthoritativeLoyaltyReconciliation({
      members,
      pointsAccounts,
      profiles,
      orders,
      shopifyOrders,
    });

    if (apply && (readErrors.length > 0 || reconciliation.blocked_customer_count > 0)) {
      return Response.json({
        error: 'reconciliation_blocked',
        read_errors: readErrors,
        blocked_customer_count: reconciliation.blocked_customer_count,
      }, { status: 409 });
    }

    const applied = [];
    if (apply) {
      const secret = Deno.env.get('LOYALTY_LEDGER_SECRET') || Deno.env.get('CUSTOMER_APP_SYNC_SECRET') || '';
      for (const row of reconciliation.actionable) {
        if (row.needs_balance_reconciliation || row.cache_mismatch) {
          const expected = row.expected;
          const reconciliationKey = `loyalty_order_reconciliation:v1:${row.customer_email}:${expected.total_points}:${expected.lifetime_points}:${expected.redeemed_points}`;
          const response = await base44.asServiceRole.functions.invoke('enrollNewCustomerInLoyalty', {
            action: 'reconcile',
            customer_email: row.customer_email,
            expected_total: expected.total_points,
            expected_lifetime: expected.lifetime_points,
            expected_redeemed: expected.redeemed_points,
            idempotency_key: reconciliationKey,
            description: 'Authoritative reconciliation from paid, non-refunded order history',
            source_type: 'order_history_reconciliation',
            source_id: 'loyalty-order-ledger-v1-2026-08-04',
            metadata: row.components,
          }, { headers: { 'x-internal-secret': secret } });
          const result = response?.data || response;
          if (result?.success !== true) throw new Error(`reconciliation_failed:${row.customer_email}:${result?.error || 'unknown'}`);
          const [transactions, pointRows, memberRows] = await Promise.all([
            base44.asServiceRole.entities.LoyaltyTransaction.filter({ idempotency_key: reconciliationKey }, '-created_date', 2),
            base44.asServiceRole.entities.UserPoints.filter({ customer_email: row.customer_email }, '-updated_date', 2),
            base44.asServiceRole.entities.LoyaltyMember.filter({ email: row.customer_email }, '-updated_date', 2),
          ]);
          const pointProjection = pointRows[0] || {};
          const memberProjection = memberRows[0] || {};
          const projectionMatches = [pointProjection, memberProjection].every(projection =>
            Number(projection.total_points) === expected.total_points
            && Number(projection.lifetime_points) === expected.lifetime_points
            && Number(projection.redeemed_points) === expected.redeemed_points);
          if (!transactions[0] || transactions[0].status !== 'posted' || !projectionMatches) {
            throw new Error(`reconciliation_verification_failed:${row.customer_email}`);
          }
        }
        if (row.contact?.needs_profile_update) {
          const profilePayload = {
            customer_email: row.contact.profile_customer_email || row.customer_email,
            contact_email: row.customer_email,
            ...(row.contact.first_name ? { first_name: row.contact.first_name } : {}),
            ...(row.contact.last_name ? { last_name: row.contact.last_name } : {}),
            ...(row.contact.phone ? { phone: row.contact.phone } : {}),
          };
          if (row.contact.profile_id) await base44.asServiceRole.entities.UserProfile.update(row.contact.profile_id, profilePayload);
          else await base44.asServiceRole.entities.UserProfile.create(profilePayload);
        }
        applied.push({
          customer_email: row.customer_email,
          balance_reconciled: row.needs_balance_reconciliation || row.cache_mismatch,
          profile_enriched: row.contact?.needs_profile_update === true,
          expected: row.expected,
        });
      }
    }

    console.log(`[loyalty-integrity] complete healthy=${report.healthy} members=${report.summary.loyalty_member_count} points_accounts=${report.summary.user_points_account_count} exceptions=${report.summary.critical_exception_count}`);

    return Response.json({
      mode: 'LOYALTY_INTEGRITY_AUDIT',
      deployment: RECONCILIATION_DEPLOYMENT,
      timestamp: new Date().toISOString(),
      ...report,
      read_only: !apply,
      writes_performed: apply,
      reconciliation: {
        ...reconciliation,
        applied_count: applied.length,
        applied,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[loyalty-integrity] unexpected failure: ${message}`);
    return Response.json({ error: 'loyalty_integrity_audit_failed', detail: message }, { status: 500 });
  }
});
