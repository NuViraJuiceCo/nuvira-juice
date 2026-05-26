import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CA_ORDER_ID    = '69f75a7e8b7a8b52005e3ab8';
const ORDER_NUMBER   = 'NV-MOPV2CIK';
const CUSTOMER_EMAIL = 'henrryalbert23@yahoo.com';

const PATCH = {
  payment_status:         'paid',
  production_status:      'awaiting_production',
  assigned_delivery_date: '2026-05-06',
  status:                 'scheduled_for_production',
  tracker_step:           'Scheduled For Production'
};

const FIELDS_NOT_CHANGED = [
  'order_number',
  'customer_email',
  'customer_name',
  'line_items',
  'total_price',
  'delivery_address',
  'delivered_at',
  'delivery_status',
  'fulfillment_status',
  'stripe_checkout_session_id',
  'created_date'
];

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

    const body = await req.json().catch(() => ({}));
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

    const alreadyHydrated =
      before.payment_status === 'paid' &&
      before.production_status === 'awaiting_production' &&
      before.assigned_delivery_date === '2026-05-06' &&
      before.status === 'scheduled_for_production';

    if (alreadyHydrated) {
      return Response.json({
        status: 'already_correct',
        message: 'NV-MOPV2CIK already hydrated. No write needed.',
        ca_order_id: CA_ORDER_ID,
        order_number: ORDER_NUMBER
      });
    }

    const fieldsToWrite: Record<string, any> = {};

    for (const [key, val] of Object.entries(PATCH)) {
      if (before[key] !== val) {
        fieldsToWrite[key] = val;
      }
    }

    const preview = {
      repair_id: 'R3',
      ca_order_id: CA_ORDER_ID,
      order_number: ORDER_NUMBER,
      customer_email: CUSTOMER_EMAIL,
      match_confidence: 'HIGH',
      proposed_action: 'Hydrate null/stale Customer App fields from Hub source of truth',
      before: {
        status: before.status,
        tracker_step: before.tracker_step ?? null,
        payment_status: before.payment_status ?? null,
        production_status: before.production_status ?? null,
        delivery_status: before.delivery_status ?? null,
        fulfillment_status: before.fulfillment_status ?? null,
        assigned_delivery_date: before.assigned_delivery_date ?? null,
        delivery_address: before.delivery_address ?? null
      },
      fields_to_write: Object.keys(fieldsToWrite),
      field_values: fieldsToWrite,
      fields_not_changed: FIELDS_NOT_CHANGED,
      hub_source_order_id: '69f77aa2d81dbc896f90ec41',
      risk_notes: 'Low. Only hydrates active May 6 order tracking fields. Does not touch address, line items, delivered_at, delivery_status, or fulfillment_status.',
      live_run_blockers: 0
    };

    if (dry_run) {
      return Response.json({
        dry_run: true,
        mode: 'DRY RUN — zero writes',
        r3_preview: preview
      });
    }

    await ca.entities.Order.update(CA_ORDER_ID, fieldsToWrite);
    const after = await ca.entities.Order.get(CA_ORDER_ID);

    return Response.json({
      dry_run: false,
      status: 'success',
      repair_id: 'R3',
      ca_order_id: CA_ORDER_ID,
      order_number: ORDER_NUMBER,
      fields_written: Object.keys(fieldsToWrite),
      before: preview.before,
      after: {
        status: after.status,
        tracker_step: after.tracker_step,
        payment_status: after.payment_status,
        production_status: after.production_status,
        assigned_delivery_date: after.assigned_delivery_date,
        delivery_status: after.delivery_status,
        fulfillment_status: after.fulfillment_status,
        delivery_address: after.delivery_address
      },
      fields_not_changed: FIELDS_NOT_CHANGED,
      audit_note: {
        repair_id: 'R3',
        order_number: ORDER_NUMBER,
        executed_by: `R3 — approved_by: ${approved_by}`,
        fields_changed: Object.keys(fieldsToWrite),
        reason: 'NV-MOPV2CIK recovered via webhook repair but Customer App record had null status fields. Hydrated from Hub truth.',
        executed_at: new Date().toISOString()
      }
    });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
});
