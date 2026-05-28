import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function bearerToken(req) {
  const header = req.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function hasInternalSyncAuth(req) {
  const token = bearerToken(req);
  const allowed = [
    Deno.env.get('CUSTOMER_APP_SYNC_SECRET'),
    Deno.env.get('HUB_SYNC_SECRET'),
  ].filter(Boolean);
  return Boolean(token && allowed.includes(token));
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = hasInternalSyncAuth(req) ? null : await base44.auth.me().catch(() => null);
    if (!hasInternalSyncAuth(req) && user?.role !== 'admin') {
      return Response.json({ error: user ? 'forbidden' : 'unauthorized' }, { status: user ? 403 : 401 });
    }

    const body = await req.json();
    const { status } = body;

    const query = status ? { verification_status: status } : {};
    const bagReturns = await base44.asServiceRole.entities.BagReturn.filter(query, '-created_date');

    const formatted = bagReturns.map(br => ({
      id: br.id,
      order_id: br.order_id,
      customer_email: br.customer_email,
      small_bags_requested: br.small_bags_requested,
      tote_bags_requested: br.tote_bags_requested,
      small_bags_accepted: br.small_bags_accepted,
      tote_bags_accepted: br.tote_bags_accepted,
      small_bag_status: br.small_bag_status,
      tote_bag_status: br.tote_bag_status,
      verification_status: br.verification_status,
      credit_issued: br.credit_issued,
      credit_applied: br.credit_applied,
      verified_by: br.verified_by,
      verified_at: br.verified_at,
      photo_url: br.photo_url,
      created_date: br.created_date,
    }));

    console.log(`getBagReturnsForSync: returning ${formatted.length} bag returns`);
    return Response.json({ bag_returns: formatted, count: formatted.length });
  } catch (error) {
    console.error('getBagReturnsForSync error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
