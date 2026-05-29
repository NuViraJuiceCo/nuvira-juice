import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

type Base44Client = any;
type AdminRecipient = { email: string };

const INTERNAL_SECRET = Deno.env.get('ADMIN_PUSH_INTERNAL_SECRET')
  || Deno.env.get('HUB_SYNC_SECRET')
  || Deno.env.get('CUSTOMER_APP_SYNC_SECRET')
  || '';
const ADMIN_PUSH_RECIPIENT_EMAILS = Deno.env.get('ADMIN_PUSH_RECIPIENT_EMAILS') || '';
const NOTIFICATION_SUBTYPE = 'admin_order_processed';
const DEEP_LINK = '/admin/orders';

function envFlag(name: string): boolean {
  return Deno.env.get(name) === 'true';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'unknown');
}

function normalizeSingleLine(value: unknown): string {
  return (value ?? '').toString().trim().replace(/\s+/g, ' ');
}

function normalizeEmail(value: unknown): string {
  const email = normalizeSingleLine(value).toLowerCase();
  if (!email || email.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '';
  return email;
}

function normalizeOrderNumber(value: unknown): string {
  return normalizeSingleLine(value).replace(/^#/, '').toUpperCase();
}

function parseEmailList(value: string): string[] {
  return [...new Set(value
    .split(',')
    .map((item) => normalizeEmail(item))
    .filter(Boolean))];
}

async function authorize(base44: Base44Client, req: Request, body: Record<string, any>) {
  const authHeader = req.headers.get('authorization') || '';
  const bearer = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';
  const bodySecret = normalizeSingleLine(body.internal_secret || body._internal_secret);
  const isInternal = Boolean(INTERNAL_SECRET && (bodySecret === INTERNAL_SECRET || bearer === INTERNAL_SECRET));

  if (isInternal) {
    return { ok: true, actor_type: 'system', actor_email: 'system', user: null };
  }

  const user = await base44.auth.me().catch(() => null);
  if (user?.role === 'admin') {
    return { ok: true, actor_type: 'admin', actor_email: normalizeEmail(user.email), user };
  }

  return {
    ok: false,
    status: user ? 403 : 401,
    error: user ? 'Admin access required' : 'Authentication required',
  };
}

async function resolveOrder(base44: Base44Client, body: Record<string, any>) {
  const orderId = normalizeSingleLine(body.order_id);
  if (!orderId) {
    return { error: 'order_id is required', status: 400, order: null };
  }

  const rows = await base44.asServiceRole.entities.Order.filter({ id: orderId }, null, 1);
  const order = rows[0];
  if (!order) {
    return { error: 'Order not found', status: 404, order: null };
  }

  const requestOrderNumber = normalizeOrderNumber(body.order_number);
  const actualOrderNumber = normalizeOrderNumber(order.order_number || order.shopify_order_number || order.name);
  if (requestOrderNumber && actualOrderNumber && requestOrderNumber !== actualOrderNumber) {
    return { error: 'Order number mismatch', status: 409, order: null };
  }

  const requestEmail = normalizeEmail(body.customer_email);
  const actualEmail = normalizeEmail(order.customer_email);
  if (requestEmail && actualEmail && requestEmail !== actualEmail) {
    return { error: 'Customer email mismatch', status: 409, order: null };
  }

  return { error: null, status: 200, order };
}

async function findAdminRecipients(base44: Base44Client, actorEmail: string, testOnly: boolean): Promise<AdminRecipient[]> {
  if (testOnly && actorEmail) return [{ email: actorEmail }];

  const envRecipients = parseEmailList(ADMIN_PUSH_RECIPIENT_EMAILS);
  if (envRecipients.length > 0) return envRecipients.map((email) => ({ email }));

  const adminUsers = await base44.asServiceRole.entities.User.filter({ role: 'admin' }).catch(() => []);
  const emails = new Set<string>();

  for (const admin of adminUsers) {
    const email = normalizeEmail(admin.email || admin.customer_email || admin.user_email || admin.created_by);
    if (email) emails.add(email);
  }

  if (actorEmail) emails.add(actorEmail);

  return [...emails].map((email) => ({ email }));
}

async function existingNotification(base44: Base44Client, idempotencyKey: string) {
  const rows = await base44.asServiceRole.entities.Notification.filter({ idempotency_key: idempotencyKey }, null, 1);
  return rows[0] || null;
}

async function createAdminNotification(
  base44: Base44Client,
  recipient: AdminRecipient,
  order: Record<string, any>,
  title: string,
  message: string,
  idempotencyKey: string,
) {
  const existing = await existingNotification(base44, idempotencyKey);
  if (existing) return { notification: existing, created: false };

  const notification = await base44.asServiceRole.entities.Notification.create({
    customer_email: recipient.email,
    title,
    message,
    type: 'order_update',
    notification_subtype: NOTIFICATION_SUBTYPE,
    order_id: order.id || null,
    deep_link: DEEP_LINK,
    is_read: false,
    icon: null,
    idempotency_key: idempotencyKey,
  });

  return { notification, created: true };
}

async function sendPushForNotification(
  base44: Base44Client,
  recipient: AdminRecipient,
  notification: Record<string, any>,
  title: string,
  message: string,
  idempotencyKey: string,
) {
  if (!envFlag('ENABLE_ADMIN_PUSH_NOTIFICATIONS')) {
    return {
      push_attempted: false,
      push_sent: false,
      push_skipped_reason: 'admin_push_disabled',
      token_count: 0,
    };
  }

  const result = await base44.asServiceRole.functions.invoke('sendCustomerPushNotification', {
    customer_email: recipient.email,
    notification_id: notification.id,
    title,
    message,
    type: 'order_update',
    notification_subtype: NOTIFICATION_SUBTYPE,
    order_id: notification.order_id || null,
    deep_link: DEEP_LINK,
    idempotency_key: idempotencyKey,
  }).catch((error: unknown) => ({
    push_attempted: false,
    push_sent: false,
    push_skipped_reason: `push_function_error:${errorMessage(error).slice(0, 80)}`,
    token_count: 0,
  }));

  return result?.data || result || {};
}

async function readJsonBody(req) {
  if (!['POST', 'PUT', 'PATCH'].includes(req.method)) {
    return { ok: true, body: {} };
  }

  const raw = await req.text();
  if (!raw.trim()) {
    return { ok: true, body: {} };
  }

  try {
    return { ok: true, body: JSON.parse(raw) };
  } catch {
    return { ok: false, body: null };
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const base44 = createClientFromRequest(req);
    const parsedBody = await readJsonBody(req);
    if (!parsedBody.ok) {
      return Response.json({ success: false, error: 'malformed_json', error_code: 'malformed_json' }, { status: 400 });
    }
    const body = parsedBody.body && typeof parsedBody.body === 'object' && !Array.isArray(parsedBody.body) ? parsedBody.body : {};
    const auth = await authorize(base44, req, body);
    if (!auth.ok) {
      return Response.json({ error: auth.error }, { status: auth.status || 403 });
    }
    const actorEmail = 'actor_email' in auth ? normalizeEmail(auth.actor_email) : '';

    if (!envFlag('ENABLE_ADMIN_PUSH_NOTIFICATIONS') || !envFlag('ENABLE_ADMIN_ORDER_PROCESSED_PUSH')) {
      return Response.json({
        success: true,
        skipped: true,
        reason: 'admin_order_processed_push_disabled',
        notification_created_count: 0,
        push_attempted: false,
        push_sent: false,
        push_token_count: 0,
      });
    }

    const resolved = await resolveOrder(base44, body);
    if (!resolved.order) {
      return Response.json({ error: resolved.error }, { status: resolved.status });
    }

    const order = resolved.order;
    const orderNumber = normalizeOrderNumber(order.order_number || order.shopify_order_number || order.name || body.order_number)
      || normalizeSingleLine(order.id).slice(0, 12);
    const title = 'New NuVira Order';
    const message = `Order #${orderNumber} is paid and ready for operations.`;
    const recipients = await findAdminRecipients(base44, actorEmail, body.test_only === true);

    if (recipients.length === 0) {
      return Response.json({
        success: true,
        skipped: true,
        reason: 'admin_push_recipients_unavailable',
        order_id: order.id,
        order_number: orderNumber,
        notification_created_count: 0,
        push_attempted: false,
        push_sent: false,
        push_token_count: 0,
      });
    }

    let notificationCreatedCount = 0;
    let duplicateCount = 0;
    let pushAttempted = false;
    let pushSent = false;
    let pushTokenCount = 0;
    let pushSentCount = 0;
    const skippedReasons = new Set<string>();

    for (const recipient of recipients) {
      const idempotencyKey = `admin_order_processed_${order.id}_${recipient.email}`;
      const created = await createAdminNotification(base44, recipient, order, title, message, idempotencyKey);

      if (created.created) {
        notificationCreatedCount += 1;
      } else {
        duplicateCount += 1;
        skippedReasons.add('duplicate_idempotency_key');
        continue;
      }

      const push = await sendPushForNotification(base44, recipient, created.notification, title, message, idempotencyKey);
      pushAttempted = pushAttempted || Boolean(push.push_attempted);
      pushSent = pushSent || Boolean(push.push_sent);
      pushTokenCount += Number(push.token_count || 0);
      pushSentCount += Number(push.sent_count || (push.push_sent ? 1 : 0));
      if (push.push_skipped_reason) skippedReasons.add(push.push_skipped_reason);
    }

    return Response.json({
      success: true,
      skipped: notificationCreatedCount === 0 && duplicateCount > 0,
      reason: notificationCreatedCount === 0 && duplicateCount > 0 ? 'duplicate_idempotency_key' : null,
      order_id: order.id,
      order_number: orderNumber,
      recipient_count: recipients.length,
      notification_created_count: notificationCreatedCount,
      duplicate_count: duplicateCount,
      push_attempted: pushAttempted,
      push_sent: pushSent,
      push_sent_count: pushSentCount,
      push_token_count: pushTokenCount,
      push_skipped_reason: pushSent ? null : [...skippedReasons].join('+') || null,
    });
  } catch (error) {
    console.error(`[sendAdminOrderProcessedNotification] Error: ${errorMessage(error)}`);
    return Response.json({
      error: 'Unable to send admin order notification',
      push_attempted: false,
      push_sent: false,
      push_skipped_reason: 'admin_order_processed_error',
    }, { status: 500 });
  }
});
