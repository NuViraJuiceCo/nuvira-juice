// @ts-nocheck
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import {
  previewEventPosInventoryReadiness,
  syncVerifiedEventBatchToShopifyPos,
} from '../executeNativeProductionBatchLifecycle/eventPosInventory.ts';

const CONFIRMATION = 'retry_verified_event_pos_inventory';
const DONE_BATCH_STATUSES = new Set(['verified_logged', 'completed', 'archived', 'fulfilled']);

function text(value) {
  return (value ?? '').toString().trim();
}

function lower(value) {
  return text(value).toLowerCase();
}

function safeId(value) {
  const valueText = text(value);
  return /^[A-Za-z0-9._:@/#-]{1,220}$/.test(valueText) ? valueText : '';
}

async function bodyObject(req) {
  try {
    const body = await req.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

async function findBatch(base44, key) {
  const safeKey = safeId(key);
  if (!safeKey) return null;
  const byId = await base44.asServiceRole.entities.ProductionBatch
    .filter({ id: safeKey }, '-created_date', 2)
    .catch(() => []);
  if (byId.length === 1) return byId[0];
  const byBatchId = await base44.asServiceRole.entities.ProductionBatch
    .filter({ batch_id: safeKey }, '-created_date', 2)
    .catch(() => []);
  return byBatchId.length === 1 ? byBatchId[0] : null;
}

export default async function handler(req: Request) {
  if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 });
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me().catch(() => null);
  if (!user) return Response.json({ error: 'authentication_required' }, { status: 401 });
  if (!['admin', 'owner'].includes(lower(user.role))) {
    return Response.json({ error: 'admin_role_required' }, { status: 403 });
  }
  const body = await bodyObject(req);
  if (!body) return Response.json({ error: 'malformed_json' }, { status: 400 });
  const operation = lower(body.operation);

  if (operation === 'preview_event') {
    const result = await previewEventPosInventoryReadiness({
      base44,
      eventId: body.event_id,
      batchKeys: body.production_batch_ids,
    });
    return Response.json({
      ...result,
      operation,
      writes_performed: false,
      provider_writes_performed: false,
    }, { status: result.ready === true ? 200 : 409 });
  }

  if (operation === 'retry_verified_batch') {
    if (text(body.confirmation) !== CONFIRMATION) {
      return Response.json({ error: 'confirmation_required', writes_performed: false }, { status: 400 });
    }
    const requestId = safeId(body.request_id);
    const batch = await findBatch(base44, body.production_batch_id || body.batch_id);
    if (!requestId) return Response.json({ error: 'request_id_required', writes_performed: false }, { status: 400 });
    if (!batch) return Response.json({ error: 'production_batch_not_found', writes_performed: false }, { status: 404 });
    if (!DONE_BATCH_STATUSES.has(lower(batch.status))) {
      return Response.json({ error: 'verified_batch_required', writes_performed: false }, { status: 409 });
    }
    const result = await syncVerifiedEventBatchToShopifyPos({ base44, batch, requestId, user });
    return Response.json({
      success: result.success === true,
      operation,
      event_pos_inventory: result,
      writes_performed: result.inventory_mutation === true,
      customer_notifications_sent: false,
    }, { status: result.success === true ? 200 : 409 });
  }

  return Response.json({ error: 'unsupported_operation', writes_performed: false }, { status: 400 });
}
