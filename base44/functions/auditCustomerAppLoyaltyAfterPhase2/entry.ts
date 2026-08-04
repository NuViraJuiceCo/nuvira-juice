import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { buildLoyaltyIntegrityReport } from './loyaltyIntegrity.js';

const PAGE_SIZE = 200;
const MAX_ROWS_PER_ENTITY = 5000;

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

    const readErrors: string[] = [];
    const [members, pointsAccounts, profiles, orders, shopifyOrders] = await Promise.all([
      readEntity('LoyaltyMember', base44.asServiceRole.entities.LoyaltyMember, readErrors),
      readEntity('UserPoints', base44.asServiceRole.entities.UserPoints, readErrors),
      readEntity('UserProfile', base44.asServiceRole.entities.UserProfile, readErrors),
      readEntity('Order', base44.asServiceRole.entities.Order, readErrors),
      readEntity('ShopifyOrder', base44.asServiceRole.entities.ShopifyOrder, readErrors),
    ]);

    const report = buildLoyaltyIntegrityReport({
      members,
      pointsAccounts,
      profiles,
      orders,
      shopifyOrders,
      readErrors,
    });

    console.log(`[loyalty-integrity] complete healthy=${report.healthy} members=${report.summary.loyalty_member_count} points_accounts=${report.summary.user_points_account_count} exceptions=${report.summary.critical_exception_count}`);

    return Response.json({
      mode: 'LOYALTY_INTEGRITY_AUDIT',
      timestamp: new Date().toISOString(),
      ...report,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[loyalty-integrity] unexpected failure: ${message}`);
    return Response.json({ error: 'loyalty_integrity_audit_failed', detail: message }, { status: 500 });
  }
});
