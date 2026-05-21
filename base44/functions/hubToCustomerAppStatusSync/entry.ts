import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * hubToCustomerAppStatusSync
 * 
 * Reconciles Customer App Order records against Hub source of truth.
 * For each active CA order, fetches the matching Hub order and patches
 * only fields that are out of sync (status, payment_status, assigned_delivery_date, tracker_step).
 * 
 * Guards:
 * - DO_NOT_TOUCH: specific order numbers never modified
 * - Terminal CA statuses (delivered, cancelled, refunded, etc.) are never overwritten
 * - dry_run=true (default) returns full diff without any writes
 * - live writes are disabled; use syncHubDeliveryStatuses for scheduled status readback
 */

// Explicit approved patches — applied verbatim regardless of Hub field availability
const APPROVED_PATCHES: Record<string, Record<string, any>> = {
  'NV-MOOV82PT': {
    status: 'scheduled_for_production',
    tracker_step: 'Scheduled For Production',
    payment_status: 'paid',
    assigned_delivery_date: '2026-05-06',
  },
  'NV-MOOPFCUS': {
    status: 'scheduled_for_production',
    tracker_step: 'Scheduled For Production',
    payment_status: 'paid',
    assigned_delivery_date: '2026-05-06',
  },
};

// Orders that must NEVER be touched
const DO_NOT_TOUCH = new Set([
  'NV-MON367R7',        // R1 — repaired delivered
  'SUB-SK-4X-20260425', // R4 — freshly created parent sub record
  'SUB-1TPMGCIR',       // ghost record
]);

// CA statuses that are terminal — never overwrite
const TERMINAL_CA_STATUSES = new Set([
  'delivered', 'picked_up', 'cancelled', 'refunded', 'active_subscription'
]);

const TERMINAL_PAYMENT_STATUSES = new Set(['refunded', 'failed']);

// Hub production_status → CA status
function mapHubStatus(hubStatus) {
  const map = {
    new: 'order_received',
    awaiting_production: 'scheduled_for_production',
    scheduled_for_production: 'scheduled_for_production',
    in_production: 'in_production',
    bottled: 'bottled_packed',
    labeled: 'bottled_packed',
    qc_checked: 'bottled_packed',
    packed: 'bottled_packed',
    in_cold_storage: 'bottled_packed',
    assigned_for_pickup: 'ready_for_pickup',
    assigned_for_delivery: 'out_for_delivery',
    fulfilled: 'delivered',
    pending: 'order_received',
    production_scheduled: 'scheduled_for_production',
    // pass-through
    order_received: 'order_received',
    scheduled_for_juicing: 'scheduled_for_juicing',
    bottled_packed: 'bottled_packed',
    out_for_delivery: 'out_for_delivery',
    arriving_soon: 'arriving_soon',
    ready_for_pickup: 'ready_for_pickup',
    picked_up: 'picked_up',
  };
  return map[hubStatus] || null;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Admin access required' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const dry_run: boolean = body.dry_run !== false;

    if (!dry_run) {
      return Response.json({
        error: 'DEPRECATED_LIVE_WRITE_DISABLED',
        message: 'hubToCustomerAppStatusSync live writes are disabled. Use syncHubDeliveryStatuses for scheduled status readback or request a separately approved repair plan.',
        deprecated_live_write: true,
        mutated: false,
        replacement: 'syncHubDeliveryStatuses',
        requires_separate_approval: true,
      }, { status: 410 });
    }

    const ca = base44.asServiceRole;

    // ===== 1. FETCH ALL CA ORDERS =====
    let caOrders: any[] = [];
    try {
      caOrders = await ca.entities.Order.list('-updated_date', 500);
      console.log(`[Sync] Fetched ${caOrders.length} CA orders`);
    } catch (e: any) {
      return Response.json({ error: `Failed to fetch CA orders: ${e.message}` }, { status: 500 });
    }

    // Filter to only active/non-terminal CA orders that have a real order_number
    const activeCAOrders = caOrders.filter(o =>
      o.order_number &&
      !DO_NOT_TOUCH.has(o.order_number) &&
      !TERMINAL_CA_STATUSES.has(o.status) &&
      !TERMINAL_PAYMENT_STATUSES.has(o.payment_status)
    );

    console.log(`[Sync] ${activeCAOrders.length} active CA orders to reconcile`);

    // Build lookup by order_number for terminal/cancelled guard reporting
    const allCAByOrderNum = new Map<string, any>();
    caOrders.forEach(o => { if (o.order_number) allCAByOrderNum.set(o.order_number, o); });

    // ===== 2. FETCH MATCHING HUB ORDERS (one batch per unique customer) =====
    const hubBase = (Deno.env.get('HUB_API_URL') || '').replace(/\/$/, '').replace(/\/functions\/.*$/, '');
    const hubSecret = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

    // Unique emails from active CA orders
    const uniqueEmails = [...new Set(activeCAOrders.map(o => o.customer_email).filter(Boolean))];
    console.log(`[Sync] Fetching Hub data for ${uniqueEmails.length} unique customers`);

    // Map: order_number → hub order data
    const hubByOrderNum = new Map<string, any>();

    for (const email of uniqueEmails) {
      try {
        const hubUrl = `${hubBase}/functions/getOrderUpdatesForCustomerApp?email=${encodeURIComponent(email)}`;
        const hubRes = await fetch(hubUrl, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${hubSecret}`,
            'Content-Type': 'application/json',
          },
        });

        if (!hubRes.ok) {
          console.warn(`[Sync] Hub returned ${hubRes.status} for ${email}`);
          continue;
        }

        const hubData = await hubRes.json();
        const rawOrders: any[] = hubData.orders || [];

        for (const order of rawOrders) {
          const num = (order.shopify_order_number || order.order_number || '').replace('#', '');
          if (num) hubByOrderNum.set(num, order);
        }
      } catch (e: any) {
        console.warn(`[Sync] Hub fetch error for ${email}: ${e.message}`);
      }
    }

    console.log(`[Sync] Fetched ${hubByOrderNum.size} Hub orders`);

    // ===== 3. RECONCILE =====
    const would_update: any[] = [];
    const in_sync: string[] = [];
    const cancelled_guard: string[] = [];
    const missing_ca: string[] = [];
    const no_hub_data: string[] = [];
    const errors: string[] = [];

    // Check terminal CA records (skipped from active loop) for guard reporting
    caOrders.forEach(o => {
      if (!o.order_number || DO_NOT_TOUCH.has(o.order_number)) return;
      if (TERMINAL_CA_STATUSES.has(o.status) || TERMINAL_PAYMENT_STATUSES.has(o.payment_status)) {
        cancelled_guard.push(o.order_number);
      }
    });

    for (const caOrder of activeCAOrders) {
      const orderNum = caOrder.order_number;

      // Use explicit approved patch if present (overrides Hub-derived diff)
      if (APPROVED_PATCHES[orderNum]) {
        const approvedPatch = APPROVED_PATCHES[orderNum];
        // Only include fields that actually differ
        const patch: Record<string, any> = {};
        for (const [k, v] of Object.entries(approvedPatch)) {
          if (caOrder[k] !== v) patch[k] = v;
        }
        if (Object.keys(patch).length === 0) {
          in_sync.push(orderNum);
        } else {
          would_update.push({
            order_number: orderNum,
            ca_id: caOrder.id,
            before: {
              status: caOrder.status,
              payment_status: caOrder.payment_status,
              assigned_delivery_date: caOrder.assigned_delivery_date,
              tracker_step: caOrder.tracker_step,
            },
            patch,
            source: 'approved_patch',
          });
        }
        continue;
      }

      const hubOrder = hubByOrderNum.get(orderNum);

      if (!hubOrder) {
        no_hub_data.push(orderNum);
        continue;
      }

      // Determine target status from Hub
      const hubProdStatus = hubOrder.production_status || hubOrder.status;
      const mappedStatus = mapHubStatus(hubProdStatus);
      const hubPayment = hubOrder.financial_status || hubOrder.payment_status;
      const hubDeliveryDate = hubOrder.assigned_delivery_date || null;
      const hubTrackerStep = hubOrder.tracker_step || null;

      const patch: Record<string, any> = {};

      if (mappedStatus && mappedStatus !== caOrder.status) {
        patch.status = mappedStatus;
      }
      if (hubPayment && hubPayment !== caOrder.payment_status && !TERMINAL_PAYMENT_STATUSES.has(caOrder.payment_status)) {
        patch.payment_status = hubPayment;
      }
      if (hubDeliveryDate && hubDeliveryDate !== caOrder.assigned_delivery_date) {
        patch.assigned_delivery_date = hubDeliveryDate;
      }
      if (hubTrackerStep && hubTrackerStep !== caOrder.tracker_step) {
        patch.tracker_step = hubTrackerStep;
      }

      if (Object.keys(patch).length === 0) {
        in_sync.push(orderNum);
        continue;
      }

      would_update.push({
        order_number: orderNum,
        ca_id: caOrder.id,
        before: {
          status: caOrder.status,
          payment_status: caOrder.payment_status,
          assigned_delivery_date: caOrder.assigned_delivery_date,
          tracker_step: caOrder.tracker_step,
        },
        patch,
        source: 'hub_derived',
      });
    }

    return Response.json({
      dry_run: true,
      mode: 'DRY RUN — zero writes',
      mutated: false,
      summary: {
        would_update: would_update.map(r => r.order_number),
        would_update_count: would_update.length,
        in_sync_count: in_sync.length,
        in_sync: in_sync,
        cancelled_guard: cancelled_guard,
        missing_ca: missing_ca,
        no_hub_data: no_hub_data,
        errors: errors.length,
      },
      would_update_details: would_update,
      blockers: errors,
    });

  } catch (e: any) {
    console.error('[Sync] Fatal error:', e.message);
    return Response.json({ error: e.message }, { status: 500 });
  }
});
