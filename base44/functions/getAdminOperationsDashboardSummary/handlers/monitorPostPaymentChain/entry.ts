import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const ORDER_LIMIT = 80;
const RELATED_LIMIT = 240;
const DAY_MS = 24 * 60 * 60 * 1000;

function runtimeEnv(name: string) {
  return typeof Deno !== 'undefined' ? Deno.env.get(name) : undefined;
}

const RESEND_API_KEY = runtimeEnv('RESEND_API_KEY') || '';
const INTERNAL_FROM = runtimeEnv('INTERNAL_EMAIL_FROM') || 'NuVira Juice Co <operations@nuvirajuice.com>';
const INTERNAL_REPLY_TO = runtimeEnv('INTERNAL_EMAIL_REPLY_TO') || 'operations@nuvirajuice.com';
const VALID_ORDER_STATUSES = new Set([
  'order_received',
  'scheduled_for_juicing',
  'in_production',
  'bottled_packed',
  'ready_for_pickup',
  'out_for_delivery',
  'arriving_soon',
  'delivered',
  'picked_up',
]);

function normalizeOrderNumber(value: unknown) {
  return String(value || '').trim().replace(/^#/, '').toUpperCase();
}

function clampMinutes(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 15;
  return Math.min(1440, Math.max(5, Math.round(parsed)));
}

function rowTimestamp(row: any) {
  return String(row?.sync_timestamp || row?.completed_at || row?.updated_date || row?.created_date || '');
}

function newest(rows: any[]) {
  return [...rows].sort((left, right) => rowTimestamp(right).localeCompare(rowTimestamp(left)))[0] || null;
}

function listEntity(base44: any, name: string, sort: string, limit: number) {
  return base44.asServiceRole.entities[name].list(sort, limit);
}

async function readJsonBody(req: Request) {
  const raw = await req.text();
  if (!raw.trim()) return { ok: true, body: {} };
  try {
    const parsed = JSON.parse(raw);
    return {
      ok: Boolean(parsed && typeof parsed === 'object' && !Array.isArray(parsed)),
      body: parsed,
    };
  } catch {
    return { ok: false, body: null };
  }
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function startOfUtcDay(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function classifyComplianceDocument(document: any, today: Date) {
  const rawExpiry = String(document?.expiry_date || '').trim();
  if (!rawExpiry) return { state: String(document?.status || 'Pending'), days_remaining: null };
  const expiry = new Date(`${rawExpiry}T00:00:00.000Z`);
  if (Number.isNaN(expiry.getTime())) return { state: 'Pending', days_remaining: null };
  const daysRemaining = Math.ceil((expiry.getTime() - today.getTime()) / DAY_MS);
  const reminderDays = Number.isFinite(Number(document?.reminder_days))
    ? Math.max(0, Number(document.reminder_days))
    : 30;
  if (daysRemaining < 0) return { state: 'Expired', days_remaining: daysRemaining };
  if (daysRemaining <= reminderDays) return { state: 'Due Soon', days_remaining: daysRemaining };
  return { state: 'Valid', days_remaining: daysRemaining };
}

function buildComplianceRows(rows: any[], color: string) {
  return rows.map(row => `<tr><td style="padding:8px 12px;border-bottom:1px solid #eee">${escapeHtml(row.name)}</td><td style="padding:8px 12px;border-bottom:1px solid #eee">${escapeHtml(row.type)}</td><td style="padding:8px 12px;border-bottom:1px solid #eee;color:${color};font-weight:600">${escapeHtml(row.derived_status)}</td><td style="padding:8px 12px;border-bottom:1px solid #eee">${escapeHtml(row.expiry_date || 'Not set')}</td></tr>`).join('');
}

function buildComplianceEmail(overdue: any[], dueSoon: any[]) {
  return `<div style="font-family:Inter,Arial,sans-serif;max-width:640px;margin:0 auto;color:#17211b">
    <div style="background:#123c2c;padding:24px">
      <h1 style="color:#fff;font-size:20px;margin:0">NuVira compliance review</h1>
      <p style="color:#d6eadf;margin:8px 0 0">${overdue.length} expired · ${dueSoon.length} due soon</p>
    </div>
    <div style="background:#fff;padding:24px;border:1px solid #dce4df">
      ${overdue.length ? `<h2 style="font-size:16px;color:#b42318">Expired (${overdue.length})</h2><table style="width:100%;border-collapse:collapse;font-size:14px"><tbody>${buildComplianceRows(overdue, '#b42318')}</tbody></table>` : ''}
      ${dueSoon.length ? `<h2 style="font-size:16px;color:#b54708;margin-top:24px">Due soon (${dueSoon.length})</h2><table style="width:100%;border-collapse:collapse;font-size:14px"><tbody>${buildComplianceRows(dueSoon, '#b54708')}</tbody></table>` : ''}
      <p style="margin-top:24px;font-size:13px;color:#52635a">Review and update these records in the NuVira Customer App Admin Console under Compliance.</p>
    </div>
  </div>`;
}

async function handleComplianceExpiry(base44: any, body: any) {
  const mode = body?.mode === 'live' ? 'live' : 'dry_run';
  const today = startOfUtcDay(new Date());
  const documents = await base44.asServiceRole.entities.ComplianceDoc.list('-expiry_date', 200);
  const evaluated = documents.map((document: any) => ({
    id: document?.id || null,
    name: document?.name || 'Unnamed document',
    type: document?.type || 'Document',
    expiry_date: document?.expiry_date || null,
    ...classifyComplianceDocument(document, today),
  })).map((document: any) => ({ ...document, derived_status: document.state }));
  const overdue = evaluated.filter((document: any) => document.derived_status === 'Expired');
  const dueSoon = evaluated.filter((document: any) => document.derived_status === 'Due Soon');
  const attention = [...overdue, ...dueSoon];

  if (mode !== 'live' || attention.length === 0) {
    return Response.json({
      success: true,
      mode,
      sent: false,
      customer_app_native_authoritative: true,
      hub_operational_dependency: false,
      documents_checked: evaluated.length,
      expired_count: overdue.length,
      due_soon_count: dueSoon.length,
      writes_performed: false,
      provider_calls_performed: false,
    });
  }

  const users = await base44.asServiceRole.entities.User.list('-created_date', 200);
  const recipientEmails = [...new Set(users
    .filter((candidate: any) => ['admin', 'owner', 'compliance_manager'].includes(candidate?.role) && candidate?.email)
    .map((candidate: any) => String(candidate.email).trim().toLowerCase())
    .filter(Boolean))];
  const bodyHtml = buildComplianceEmail(overdue, dueSoon);
  let sentCount = 0;
  for (const email of recipientEmails) {
    if (!RESEND_API_KEY) throw new Error('resend_api_key_missing');
    const idempotencyKey = `internal:compliance_review:${new Date().toISOString().slice(0, 10)}:${email}`;
    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey.slice(0, 256),
      },
      body: JSON.stringify({
        from: INTERNAL_FROM,
        to: [email],
        reply_to: INTERNAL_REPLY_TO,
        subject: `NuVira compliance review: ${overdue.length} expired, ${dueSoon.length} due soon`,
        html: bodyHtml,
        tags: [
          { name: 'category', value: 'internal_operations' },
          { name: 'event', value: 'compliance_review' },
        ],
      }),
    });
    const emailResult = await emailResponse.json().catch(() => ({}));
    if (!emailResponse.ok || !emailResult?.id) {
      throw new Error(`resend_${emailResponse.status}_${String(emailResult?.message || 'send_failed').slice(0, 200)}`);
    }
    sentCount += 1;
  }
  console.log(`[ComplianceExpiryMonitor] documents=${evaluated.length}, expired=${overdue.length}, due_soon=${dueSoon.length}, recipients=${sentCount}`);

  return Response.json({
    success: true,
    mode,
    sent: sentCount > 0,
    customer_app_native_authoritative: true,
    hub_operational_dependency: false,
    documents_checked: evaluated.length,
    expired_count: overdue.length,
    due_soon_count: dueSoon.length,
    recipient_count: sentCount,
    writes_performed: false,
    provider_calls_performed: sentCount > 0,
    customer_notifications_sent: false,
    internal_admin_notifications_sent: sentCount,
  });
}

export default async (req: Request) => {
  try {
    if (req.method !== 'POST') {
      return Response.json({ error: 'method_not_allowed' }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin' && user.role !== 'owner') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const parsed = await readJsonBody(req);
    if (!parsed.ok) {
      return Response.json({ success: false, error: 'malformed_json', error_code: 'malformed_json' }, { status: 400 });
    }

    if (req.headers.get('x-nuvira-admin-action') === 'monitorComplianceExpiry') {
      return await handleComplianceExpiry(base44, parsed.body);
    }

    const minutesAgo = clampMinutes(parsed.body?.minutes_ago);
    const verbose = parsed.body?.verbose === true;
    const cutoff = new Date(Date.now() - minutesAgo * 60 * 1000).toISOString();

    const [orders, operationalOrders, tasks, syncLogs, subscriptions, pendingCheckouts, pointsRows] = await Promise.all([
      listEntity(base44, 'Order', '-created_date', ORDER_LIMIT),
      listEntity(base44, 'ShopifyOrder', '-created_date', RELATED_LIMIT),
      listEntity(base44, 'FulfillmentTask', '-created_date', RELATED_LIMIT),
      listEntity(base44, 'OrderSyncLog', '-created_date', RELATED_LIMIT),
      listEntity(base44, 'Subscription', '-created_date', ORDER_LIMIT),
      listEntity(base44, 'PendingSubscriptionCheckout', '-created_date', ORDER_LIMIT),
      listEntity(base44, 'UserPoints', '-created_date', RELATED_LIMIT),
    ]);

    const recentOrders = orders.filter((order: any) => (
      String(order?.created_date || '') >= cutoff && order?.is_test_order !== true
    ));

    const orderResults = recentOrders.map((order: any) => {
      const orderNumber = normalizeOrderNumber(order?.order_number);
      const operationalOrder = newest(operationalOrders.filter((candidate: any) => (
        String(candidate?.base44_order_id || '') === String(order?.id || '') ||
        normalizeOrderNumber(candidate?.shopify_order_number) === orderNumber
      )));
      const nativeLog = newest(syncLogs.filter((candidate: any) => (
        candidate?.sync_source === 'native_order_ops' &&
        normalizeOrderNumber(candidate?.order_number) === orderNumber
      )));
      const task = newest(tasks.filter((candidate: any) => (
        String(candidate?.base44_order_id || '') === String(order?.id || '') ||
        String(candidate?.order_id || '') === String(operationalOrder?.id || '') ||
        normalizeOrderNumber(candidate?.order_number || candidate?.shopify_order_number) === orderNumber
      )));
      const fulfillmentType = String(order?.fulfillment_type || operationalOrder?.fulfillment_method || 'delivery').toLowerCase();
      const deliveryRequired = fulfillmentType === 'delivery';
      const issues: string[] = [];

      if (order?.payment_captured !== true) issues.push('payment_not_captured');
      if (order?.payment_status !== 'paid') issues.push(`payment_status=${String(order?.payment_status || 'missing')}`);
      if (!VALID_ORDER_STATUSES.has(String(order?.status || ''))) issues.push(`order_status=${String(order?.status || 'missing')}`);
      if (!operationalOrder) issues.push('native_operational_order_missing');
      if (!nativeLog) issues.push('native_order_audit_missing');
      else if (!['success', 'deduped'].includes(String(nativeLog?.status || ''))) {
        issues.push(`native_order_audit=${String(nativeLog?.status || 'missing')}`);
      }
      if (deliveryRequired && !task) issues.push('native_fulfillment_task_missing');
      if (deliveryRequired && !String(order?.assigned_delivery_date || operationalOrder?.assigned_delivery_date || task?.assigned_delivery_date || task?.delivery_date || '')) {
        issues.push('assigned_delivery_date_missing');
      }

      return {
        order_number: order?.order_number || 'unknown',
        created_at: order?.created_date || null,
        status: order?.status || 'unknown',
        fulfillment_type: fulfillmentType,
        payment_confirmed: order?.payment_captured === true && order?.payment_status === 'paid',
        native_operational_order_present: Boolean(operationalOrder),
        native_fulfillment_task_present: !deliveryRequired || Boolean(task),
        native_audit_status: nativeLog?.status || 'missing',
        chain_ok: issues.length === 0,
        issues,
      };
    });

    const recentSubscriptions = subscriptions.filter((subscription: any) => String(subscription?.created_date || '') >= cutoff);
    const subscriptionResults = recentSubscriptions.map((subscription: any) => {
      const points = pointsRows.find((row: any) => String(row?.customer_email || '').toLowerCase() === String(subscription?.customer_email || '').toLowerCase());
      const loyaltyAwarded = Boolean(points?.points_history?.some((entry: any) => (
        String(entry?.description || '').includes(String(subscription?.stripe_subscription_id || '__missing__'))
      )));
      const pending = newest(pendingCheckouts.filter((row: any) => (
        String(row?.stripe_subscription_id || '') === String(subscription?.stripe_subscription_id || '')
      )));
      const issues = ['native_subscription_fulfillment_not_enabled'];
      if (subscription?.status !== 'active') issues.push(`subscription_status=${String(subscription?.status || 'missing')}`);
      if (!loyaltyAwarded) issues.push('loyalty_not_awarded');
      if (pending?.status !== 'completed') issues.push(`pending_checkout=${String(pending?.status || 'missing')}`);
      return {
        subscription_record_id: subscription?.id || 'unknown',
        created_at: subscription?.created_date || null,
        status: subscription?.status || 'unknown',
        loyalty_awarded: loyaltyAwarded,
        pending_checkout_status: pending?.status || 'missing',
        chain_ok: false,
        issues,
      };
    });

    const stuckPending = pendingCheckouts.filter((row: any) => (
      String(row?.created_date || '') >= cutoff && row?.status === 'pending'
    ));
    const failedOrders = orderResults.filter(result => !result.chain_ok);
    const failedSubscriptions = subscriptionResults.filter(result => !result.chain_ok);
    const allGreen = failedOrders.length === 0 && failedSubscriptions.length === 0 && stuckPending.length === 0;

    console.log(`[PostPaymentMonitor] native chain checked: orders=${orderResults.length}, subscriptions=${subscriptionResults.length}, pending=${stuckPending.length}, failures=${failedOrders.length + failedSubscriptions.length + stuckPending.length}`);

    return Response.json({
      success: true,
      customer_app_native_authoritative: true,
      hub_operational_dependency: false,
      writes_performed: false,
      provider_calls_performed: false,
      customer_notifications_sent: false,
      window_minutes: minutesAgo,
      checked_at: new Date().toISOString(),
      overall: allGreen ? 'all_clear' : 'issues_detected',
      orders: {
        total: orderResults.length,
        ok: orderResults.length - failedOrders.length,
        failed: failedOrders.length,
        ...(verbose || failedOrders.length > 0 ? { details: orderResults } : {}),
        failed_items: failedOrders.map(result => ({ order_number: result.order_number, issues: result.issues })),
      },
      subscriptions: {
        total: subscriptionResults.length,
        ok: 0,
        failed: failedSubscriptions.length,
        native_recurring_fulfillment_enabled: false,
        ...(verbose || failedSubscriptions.length > 0 ? { details: subscriptionResults } : {}),
        failed_items: failedSubscriptions.map(result => ({ subscription_record_id: result.subscription_record_id, issues: result.issues })),
      },
      stuck_pending_checkouts: {
        count: stuckPending.length,
        records: stuckPending.map((row: any) => ({
          record_id: row?.id || 'unknown',
          created_at: row?.created_date || null,
          status: row?.status || 'pending',
        })),
      },
    });
  } catch (error) {
    console.error('[PostPaymentMonitor] monitor_failed');
    return Response.json({ success: false, error: 'monitor_failed' }, { status: 500 });
  }
};
