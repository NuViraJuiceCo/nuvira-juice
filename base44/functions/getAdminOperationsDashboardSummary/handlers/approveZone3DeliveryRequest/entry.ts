import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';
import { decideRouteReview } from '../../../../shared/routeReviewDecision.js';
import { ROUTE_REVIEW_REVISION } from '../../../../shared/routeReview.js';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

// Compatibility name retained. Capture only the customer-confirmed canonical
// checkout, never capture first and manufacture a second order afterward.
export default async (req: Request) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (user?.role !== 'admin') return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    if (Deno.env.get('ENABLE_ZONE3_ROUTE_REVIEW_DECISIONS') !== 'true') {
      return Response.json({ success: false, skipped: true, reason: 'zone3_route_review_decisions_disabled' }, { status: 409 });
    }
    const { dar_id, approved_delivery_fee, admin_decision_reason } = await req.json();
    if (!dar_id || !admin_decision_reason?.trim()) return Response.json({ error: 'Request and decision reason are required.' }, { status: 400 });
    const rows = await base44.asServiceRole.entities.DeliveryApprovalRequest.filter({ id: dar_id }, undefined, 2);
    if (!Array.isArray(rows) || rows.length !== 1) return Response.json({ error: 'DeliveryApprovalRequest not found or ambiguous' }, { status: 404 });
    if (rows[0].checkout_revision !== ROUTE_REVIEW_REVISION) {
      return Response.json({ success: false, error_code: 'ROUTE_REVIEW_RECONFIRMATION_REQUIRED',
        error: 'This older request lacks a protected checkout agreement. Release its authorization, then ask the customer to confirm a new checkout. No payment was captured.' }, { status: 409 });
    }
    return Response.json(await decideRouteReview({ base44, stripe, darId: dar_id, kind: 'approve',
      actor: user.email, reason: admin_decision_reason, approvedDeliveryFee: approved_delivery_fee, env: Deno.env }));
  } catch (error) {
    console.error('[Zone3 Approve] Decision unconfirmed:', error.message);
    return Response.json({ success: false, error: 'Route approval is not confirmed. Refresh its status before retrying.',
      reason: /^route_review_[a-z_]+$/.test(error.message || '') ? error.message : 'route_review_decision_unconfirmed' }, { status: 503 });
  }
};
