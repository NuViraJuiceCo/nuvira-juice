import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CA_ORDER_ID    = '69f4cb1ed203be21083f170c';
const ORDER_NUMBER   = 'NV-MON367R7';
const CUSTOMER_EMAIL = 'gk5c2nxn8m@privaterelay.appleid.com';

const PATCH = {
  status:                 'delivered',
  tracker_step:           'Delivered',
  payment_status:         'paid',
  production_status:      'fulfilled',
  delivery_status:        'delivered',
  fulfillment_status:     'fulfilled',
  assigned_delivery_date: '2026-05-03',
  delivered_at:           '2026-05-03T12:30:00',
};

const FIELDS_NOT_CHANGED = [
  'order_number',
  'customer_email',
  'customer_name',
  'line_items',
  'total_price',
  'delivery_address',
  'stripe_checkout_session_id',
  'stripe_payment_intent_id',
  'created_date'
];

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
  try {
    if (Deno.env.get('ENABLE_LEGACY_REPAIR_TOOLS') !== 'true') {
      return Response.json({
        success: true,
        skipped: true,
        reason: 'legacy_repair_tools_disabled',
        message: 'Legacy repair tools are disabled for May 30 launch freeze.',
      });
    }

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parsedBody = await readJsonBody(req);
    if (!parsedBody.ok) {
      return Response.json({ success: false, error: 'malformed_json', error_code: 'malformed_json' }, { status: 400 });
    }
    const body = parsedBody.body && typeof parsedBody.body === 'object' && !Array.isArray(parsedBody.body) ? parsedBody.body : {};
    const dry_run: boolean = body.dry_run !== false;
    const approved_by: string = body.approved_by || 'unknown';

    if (!dry_run && approved_by === 'unknown') {
      return Response.json({ error: 'Live execution requires approved_by.' }, { status: 400 });
    }

    const ca = base44.asServiceRole;
    const before = await ca.entities.Order.get(CA_ORDER_ID);

    if (!before) {
      return Response.json({ error: 'CA Order not found.' }, { status: 404 });
    }

    if (before.customer_email !== CUSTOMER_EMAIL || before.order_number !== ORDER_NUMBER) {
      return Response.json(
        {
          error: 'Identity mismatch — aborting.',
          expected_email: CUSTOMER_EMAIL,
          found_email: before.customer_email,
          expected_order: ORDER_NUMBER,
          found_order: before.order_number
        },
        { status: 400 }
      );
    }

    if (before.status === 'delivered') {
      return Response.json({
        status: 'already_correct',
        message: 'Already delivered. No write needed.',
        ca_order_id: CA_ORDER_ID,
        order_number: ORDER_NUMBER
      });
    }

    const preview = {
      repair_id: 'R1',
      ca_order_id: CA_ORDER_ID,
      order_number: ORDER_NUMBER,
      customer_email: CUSTOMER_EMAIL,
      match_confidence: 'HIGH',
      before: {
        status: before.status,
        tracker_step: before.tracker_step ?? null,
        payment_status: before.payment_status ?? null,
        production_status: before.production_status ?? null,
        delivery_status: before.delivery_status ?? null,
        fulfillment_status: before.fulfillment_status ?? null,
        assigned_delivery_date: before.assigned_delivery_date ?? null,
        delivered_at: before.delivered_at ?? null
      },
      after: PATCH,
      fields_to_write: Object.keys(PATCH),
      fields_not_changed: FIELDS_NOT_CHANGED,
      hub_source_order_id: '69f4cb5cc55b645ed2d3cbf7',
      hub_delivered_at: '2026-05-03T12:30:00-05:00',
      hub_fulfillment_task: '69f4fc9546da90d039d8aa35 — Completed',
      risk_notes: 'Low. Hub truth unambiguous. Single Customer App record.',
      live_run_blockers: 0
    };

    if (dry_run) {
      return Response.json({
        dry_run: true,
        mode: 'DRY RUN — zero writes',
        r1_preview: preview
      });
    }

    await ca.entities.Order.update(CA_ORDER_ID, PATCH);
    const after = await ca.entities.Order.get(CA_ORDER_ID);

    return Response.json({
      dry_run: false,
      status: 'success',
      repair_id: 'R1',
      ca_order_id: CA_ORDER_ID,
      order_number: ORDER_NUMBER,
      before: preview.before,
      after: {
        status: after.status,
        tracker_step: after.tracker_step,
        payment_status: after.payment_status,
        production_status: after.production_status,
        delivery_status: after.delivery_status,
        fulfillment_status: after.fulfillment_status,
        assigned_delivery_date: after.assigned_delivery_date,
        delivered_at: after.delivered_at
      },
      fields_not_changed: FIELDS_NOT_CHANGED,
      audit_note: {
        repair_id: 'R1',
        order_number: ORDER_NUMBER,
        executed_by: `R1 — approved_by: ${approved_by}`,
        fields_changed: Object.keys(PATCH),
        reason: 'Deepa Customer App record was stuck at scheduled_for_juicing. Hub confirmed paid, fulfilled, and delivered on 2026-05-03T12:30.',
        executed_at: new Date().toISOString()
      }
    });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
});
