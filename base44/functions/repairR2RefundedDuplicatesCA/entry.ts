import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const RECORDS = [
  {
    ca_order_id: '69f52963835b287ee217e9af',
    order_number: 'NV-MONHJHUY',
    customer_email: 'amar.kahlon23@yahoo.com'
  },
  {
    ca_order_id: '69f523db7b8126f58f9149bd',
    order_number: 'NV-MONGOVGM',
    customer_email: 'amar.kahlon23@yahoo.com'
  }
];

const PATCH = {
  status: 'cancelled',
  tracker_step: 'Cancelled / Refunded',
  payment_status: 'refunded',
  delivery_status: 'cancelled',
  fulfillment_status: 'cancelled',
  is_active: false
};

const FIELDS_NOT_CHANGED = [
  'order_number',
  'customer_email',
  'customer_name',
  'line_items',
  'total_price',
  'delivery_address',
  'created_date',
  'delivered_at'
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
    const previews: any[] = [];
    const results: any[] = [];
    const blockers: any[] = [];

    for (const record of RECORDS) {
      const before = await ca.entities.Order.get(record.ca_order_id);

      if (!before) {
        blockers.push({
          order_number: record.order_number,
          ca_order_id: record.ca_order_id,
          reason: 'Customer App Order record not found.'
        });
        continue;
      }

      if (before.customer_email !== record.customer_email || before.order_number !== record.order_number) {
        blockers.push({
          order_number: record.order_number,
          ca_order_id: record.ca_order_id,
          reason: 'Identity mismatch — aborting this record.',
          expected_email: record.customer_email,
          found_email: before.customer_email,
          expected_order: record.order_number,
          found_order: before.order_number
        });
        continue;
      }

      if (before.status === 'cancelled' && before.payment_status === 'refunded') {
        previews.push({
          repair_id: 'R2',
          order_number: record.order_number,
          ca_order_id: record.ca_order_id,
          proposed_action: 'SKIP — already cancelled/refunded',
          before: {
            status: before.status,
            payment_status: before.payment_status,
            is_active: before.is_active ?? null
          }
        });
        continue;
      }

      const preview = {
        repair_id: 'R2',
        ca_order_id: record.ca_order_id,
        order_number: record.order_number,
        customer_email: record.customer_email,
        match_confidence: 'HIGH',
        proposed_action: 'Patch refunded duplicate to cancelled/refunded/inactive',
        before: {
          status: before.status,
          tracker_step: before.tracker_step ?? null,
          payment_status: before.payment_status ?? null,
          production_status: before.production_status ?? null,
          delivery_status: before.delivery_status ?? null,
          fulfillment_status: before.fulfillment_status ?? null,
          is_active: before.is_active ?? null
        },
        after: PATCH,
        fields_to_write: Object.keys(PATCH),
        fields_not_changed: FIELDS_NOT_CHANGED,
        hub_confirmation: 'Confirmed as refunded duplicate / do_not_recover record. Suppress only, do not delete.',
        risk_notes: 'Low. Only touches two exact Customer App IDs. No broad cancellation by email.'
      };

      previews.push(preview);

      if (!dry_run) {
        try {
          await ca.entities.Order.update(record.ca_order_id, PATCH);
          const after = await ca.entities.Order.get(record.ca_order_id);

          results.push({
            order_number: record.order_number,
            ca_order_id: record.ca_order_id,
            status: 'updated',
            after: {
              status: after.status,
              tracker_step: after.tracker_step,
              payment_status: after.payment_status,
              delivery_status: after.delivery_status,
              fulfillment_status: after.fulfillment_status,
              is_active: after.is_active
            }
          });
        } catch (e: any) {
          blockers.push({
            order_number: record.order_number,
            ca_order_id: record.ca_order_id,
            reason: `Write failed: ${e.message}`
          });
        }
      }
    }

    return Response.json({
      dry_run,
      mode: dry_run ? 'DRY RUN — zero writes' : 'LIVE — writes executed',
      summary: {
        records_previewed: previews.length,
        records_updated: results.length,
        blockers: blockers.length,
        live_run_clear: blockers.length === 0
      },
      previews,
      results: dry_run ? [] : results,
      blockers,
      audit_note: dry_run
        ? null
        : {
            repair_id: 'R2',
            executed_by: `R2 — approved_by: ${approved_by}`,
            records_targeted: RECORDS.map(r => r.order_number),
            reason: 'Refunded duplicate Customer App records were still appearing as scheduled_for_juicing. Patched to cancelled/refunded/inactive.',
            executed_at: new Date().toISOString()
          }
    });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
});
