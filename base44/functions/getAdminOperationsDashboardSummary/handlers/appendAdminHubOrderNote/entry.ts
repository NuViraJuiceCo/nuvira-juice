// @ts-nocheck
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const MAX_NOTE_LENGTH = 1000;

function normalizeText(value) {
  return (value ?? '').toString().trim();
}

function normalizeSingleLine(value) {
  return normalizeText(value).replace(/\s+/g, ' ');
}

async function readJsonBody(req) {
  try {
    const body = await req.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  } catch {
    return null;
  }
}

async function findFirst(entity, filters) {
  for (const filter of filters) {
    const rows = await entity.filter(filter, '-created_date', 2).catch(() => []);
    if (rows.length > 0) return rows[0];
  }
  return null;
}

async function resolveOrder(base44, { customerAppOrderId, nativeOrderId, orderNumber }) {
  const entities = base44.asServiceRole.entities;
  const customerOrder = await findFirst(entities.Order, [
    ...(customerAppOrderId ? [{ id: customerAppOrderId }] : []),
    ...(orderNumber ? [{ order_number: orderNumber }] : []),
  ]);
  const resolvedOrderNumber = orderNumber || normalizeText(customerOrder?.order_number);
  const nativeOrder = await findFirst(entities.ShopifyOrder, [
    ...(nativeOrderId ? [{ id: nativeOrderId }] : []),
    ...(customerAppOrderId ? [{ base44_order_id: customerAppOrderId }] : []),
    ...(resolvedOrderNumber ? [{ shopify_order_number: resolvedOrderNumber }] : []),
  ]);

  if (!customerOrder && !nativeOrder) return null;
  return {
    customerOrder,
    nativeOrder,
    orderNumber: resolvedOrderNumber || normalizeText(nativeOrder?.shopify_order_number),
    targetId: normalizeText(nativeOrder?.id || customerOrder?.id),
    relatedOrderId: normalizeText(customerOrder?.id || nativeOrder?.base44_order_id || nativeOrder?.id),
  };
}

export default async function handler(req: Request) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const body = await readJsonBody(req);
    if (body === null) return Response.json({ error: 'malformed_json' }, { status: 400 });

    const customerAppOrderId = normalizeText(body.customer_app_order_id);
    const nativeOrderId = normalizeText(body.native_shopify_order_id);
    const orderNumber = normalizeSingleLine(body.order_number);
    const note = normalizeSingleLine(body.note);
    const requestId = normalizeSingleLine(body.request_id);

    if (!customerAppOrderId && !nativeOrderId && !orderNumber) {
      return Response.json({
        error: 'At least one scoped Customer App order identifier is required',
        required_any_of: ['customer_app_order_id', 'native_shopify_order_id', 'order_number'],
      }, { status: 400 });
    }
    if (!note) return Response.json({ error: 'note is required' }, { status: 400 });
    if (note.length > MAX_NOTE_LENGTH) {
      return Response.json({ error: `note must be ${MAX_NOTE_LENGTH} characters or fewer` }, { status: 400 });
    }
    if (!requestId) return Response.json({ error: 'request_id is required' }, { status: 400 });

    const idempotencyKey = `admin_order_note:${requestId}`;
    const existing = await base44.asServiceRole.entities.CommandLog.filter(
      { idempotency_key: idempotencyKey },
      '-created_date',
      1,
    ).catch(() => []);
    if (existing.length > 0) {
      return Response.json({
        success: true,
        appended: false,
        skipped: true,
        reason: 'duplicate_request_id',
        request_id: requestId,
        order_number: normalizeText(existing[0]?.related_order_number) || null,
        note_id: existing[0]?.id || null,
        source: 'customer_app_native',
      });
    }

    const resolved = await resolveOrder(base44, { customerAppOrderId, nativeOrderId, orderNumber });
    if (!resolved) return Response.json({ error: 'Customer App order not found' }, { status: 404 });

    const now = new Date().toISOString();
    const command = await base44.asServiceRole.entities.CommandLog.create({
      command_id: requestId,
      command_type: 'admin_order_note_appended',
      command_source: 'customer_app_admin',
      status: 'success',
      target_entity: resolved.nativeOrder ? 'ShopifyOrder' : 'Order',
      target_id: resolved.targetId,
      target_display_id: resolved.orderNumber || resolved.targetId,
      actor_email: user.email,
      actor_role: user.role,
      actor_type: 'authenticated_admin',
      payload: {
        note_length: note.length,
      },
      result: {
        appended: true,
        source: 'customer_app_native',
      },
      idempotency_key: idempotencyKey,
      idempotent_skipped: false,
      request_id: requestId,
      submitted_at: now,
      started_at: now,
      completed_at: now,
      duration_ms: 0,
      function_name: 'appendAdminHubOrderNote',
      related_order_id: resolved.relatedOrderId || null,
      related_order_number: resolved.orderNumber || null,
      notes: note,
    });

    return Response.json({
      success: true,
      appended: true,
      skipped: false,
      request_id: requestId,
      order_number: resolved.orderNumber || null,
      note_id: command?.id || null,
      source: 'customer_app_native',
    });
  } catch (error) {
    console.error('[appendAdminHubOrderNote] Unable to append Customer App order note:', error?.message || 'unknown');
    return Response.json({ error: 'Unable to append internal order note' }, { status: 500 });
  }
}
