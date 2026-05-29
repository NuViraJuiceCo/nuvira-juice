import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CUSTOMER_EMAIL  = 'ksukhi2000@yahoo.com';
const ORDER_NUMBER    = 'SUB-SK-4X-20260425';
const GHOST_ORDER_NUM = 'SUB-1TPMGCIR';
const GHOST_EMAIL     = '5szjpf4qrx@privaterelay.appleid.com';

const RECORD_TO_CREATE = {
  order_number:           ORDER_NUMBER,
  customer_email:         CUSTOMER_EMAIL,
  customer_name:          'Sukhwant Kahlon',
  delivery_address:       '6930 Brassel Drive, O Fallon, MO 63368',
  items:                  [],
  total:                  144,
  payment_status:         'paid',
  status:                 'active_subscription',
  tracker_step:           'Scheduled For Production',
  production_status:      'scheduled_for_production',
  fulfillment_status:     'pending_production',
  delivery_status:        'not_ready',
  assigned_delivery_date: '2026-05-09',
  notes:                  'Parent subscription record. Hub order: 69ed51368b5ca93c33a1b0b4. 4-week plan. 1/4 delivered 2026-05-02. Next: 2026-05-09. Hub FulfillmentTasks are per-fulfillment source of truth.',
};

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
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const parsedBody = await readJsonBody(req);
    if (!parsedBody.ok) {
      return Response.json({ success: false, error: 'malformed_json', error_code: 'malformed_json' }, { status: 400 });
    }
    const body = parsedBody.body && typeof parsedBody.body === 'object' && !Array.isArray(parsedBody.body) ? parsedBody.body : {};
    const dry_run: boolean = body.dry_run !== false;
    const approved_by: string = body.approved_by || 'unknown';

    if (!dry_run && approved_by === 'unknown') {
      return Response.json({ error: 'Live execution requires approved_by in payload.' }, { status: 400 });
    }

    const ca = base44.asServiceRole;

    // Guard 1: zero existing records under ksukhi2000@yahoo.com
    const existingByEmail = await ca.entities.Order.filter({ customer_email: CUSTOMER_EMAIL });
    if ((existingByEmail?.length ?? 0) > 0) {
      return Response.json({
        status: 'BLOCKED',
        reason: `Found ${existingByEmail.length} existing CA Order record(s) under ${CUSTOMER_EMAIL}. Aborting to prevent duplicate.`,
        existing: existingByEmail.map((r: any) => ({ id: r.id, order_number: r.order_number, status: r.status })),
      }, { status: 400 });
    }

    // Guard 2: order_number collision check
    const existingByOrderNum = await ca.entities.Order.filter({ order_number: ORDER_NUMBER });
    if ((existingByOrderNum?.length ?? 0) > 0) {
      return Response.json({
        status: 'BLOCKED',
        reason: `Order number ${ORDER_NUMBER} already exists. Aborting to prevent duplicate.`,
        existing: existingByOrderNum.map((r: any) => ({ id: r.id, customer_email: r.customer_email })),
      }, { status: 400 });
    }

    // Guard 3: ghost record untouched confirmation
    const ghostCheck  = await ca.entities.Order.filter({ order_number: GHOST_ORDER_NUM });
    const ghostRecord = ghostCheck?.[0] ?? null;
    const ghostSafe   = !ghostRecord || ghostRecord.customer_email === GHOST_EMAIL;

    if (dry_run) {
      return Response.json({
        dry_run: true, mode: 'DRY RUN — zero writes', repair_id: 'R4',
        preflight: {
          existing_records_under_ksukhi2000: existingByEmail?.length ?? 0,
          order_number_collision:            existingByOrderNum?.length ?? 0,
          ghost_record_id:                   ghostRecord?.id ?? null,
          ghost_record_untouched:            ghostSafe,
        },
        proposed_record:   RECORD_TO_CREATE,
        proposed_action:   'CREATE one new CA Order record',
        live_run_blockers: 0,
        fields_dropped:    ['subscription_type','fulfillment_count','fulfillments_completed','fulfillments_remaining','hub_order_id'],
      });
    }

    // Live create
    const created = await ca.entities.Order.create(RECORD_TO_CREATE);

    return Response.json({
      dry_run: false, status: 'success', repair_id: 'R4',
      records_created:      1,
      ca_order_id:          created?.id,
      order_number:         ORDER_NUMBER,
      customer_email:       CUSTOMER_EMAIL,
      created_fields:       RECORD_TO_CREATE,
      ghost_record_touched: false,
      audit_note: {
        repair_id: 'R4', order_number: ORDER_NUMBER,
        executed_by: `R4 — approved_by: ${approved_by}`,
        reason: 'Sukhwant Kahlon had zero CA records. Creating parent subscription record. Hub FulfillmentTasks remain per-fulfillment source of truth. Ghost SUB-1TPMGCIR untouched.',
        executed_at: new Date().toISOString(),
      },
    });

  } catch (e: any) { return Response.json({ error: e.message }, { status: 500 }); }
});
