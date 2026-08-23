// @ts-nocheck
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { buildDeliveryRouteSnapshots } from './deliverySnapshot.ts';

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || '');
  return message
    .replace(/\s+/g, ' ')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted email]')
    .replace(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, '[redacted phone]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, '[redacted auth]')
    .replace(/\b(?:sk|pk|rk|whsec|ghp|github_pat|xoxb|xoxp|shpat|secret|token|api[_-]?key)[A-Za-z0-9:_-]{8,}\b/gi, '[redacted secret]')
    .slice(0, 180);
}

async function readJsonBody(req: Request) {
  try {
    const body = await req.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

function authorizeOrderAccess(user: Record<string, any>, order: Record<string, any>) {
  const requester = String(user.email || '').trim().toLowerCase();
  const owner = String(order?.customer_email || '').trim().toLowerCase();
  return user.role === 'admin' || user.role === 'owner' || user.role === 'driver' || requester === owner;
}

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return Response.json({ error: 'method_not_allowed' }, { status: 405 });
  }

  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user?.email) return Response.json({ error: 'unauthorized' }, { status: 401 });

    const body = await readJsonBody(req);
    if (!body) return Response.json({ error: 'malformed_json' }, { status: 400 });
    const orderId = typeof body.order_id === 'string' ? body.order_id.trim() : '';
    if (!orderId || orderId.length > 160 || !/^[A-Za-z0-9._:@/-]+$/.test(orderId)) {
      return Response.json({ error: 'order_id required' }, { status: 400 });
    }

    const ownedOrderRows = await base44.asServiceRole.entities.Order.filter({ id: orderId }, undefined, 1);
    const ownedOrder = ownedOrderRows[0] || null;
    if (!ownedOrder) return Response.json({ error: 'Order not found' }, { status: 404 });
    if (!authorizeOrderAccess(user, ownedOrder)) return Response.json({ error: 'forbidden' }, { status: 403 });

    const result = await buildDeliveryRouteSnapshots({
      base44,
      anchorOrderId: orderId,
      googleMapsApiKey: Deno.env.get('GOOGLE_MAPS_API_KEY') || '',
    });
    if (!result.anchor_order) return Response.json({ error: 'Order not found' }, { status: 404 });

    return Response.json(result.anchor_snapshot || { on_route: false, activity_eligible: false });
  } catch (error) {
    console.error(`[getDeliveryEta] ${safeErrorMessage(error)}`);
    return Response.json({ error: 'delivery_eta_unavailable' }, { status: 500 });
  }
}
