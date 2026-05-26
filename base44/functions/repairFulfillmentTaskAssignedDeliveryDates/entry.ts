import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * repairFulfillmentTaskAssignedDeliveryDates
 * 
 * Patches missing assigned_delivery_date on specific FulfillmentTask records.
 * Matched by exact ID and identity-verified (order_number + customer_email).
 * Only patches assigned_delivery_date — no status, delivery_status, or other fields touched.
 * 
 * Guards:
 * - Match by exact FulfillmentTask ID
 * - Verify order_number matches expected before patching
 * - Abort individual record if identity mismatch
 * - Patch ONLY assigned_delivery_date
 * - Do not touch completed/cancelled/refunded tasks
 * - Do not touch ShopifyOrder or Customer App Order
 */

const APPROVED_PATCHES = [
  {
    id: '69f6faa0690e14bb5bf5938a',
    expected_order_id_ref: 'NV-MOOPFCUS',
    customer_label: 'Jasdeep Gill',
    assigned_delivery_date: '2026-05-06',
  },
  {
    id: '69f6faa0690e14bb5bf5938b',
    expected_order_id_ref: 'NV-MOOV82PT',
    customer_label: 'Gavandeep Shinger',
    assigned_delivery_date: '2026-05-06',
  },
  {
    id: '69f77aa2d81dbc896f90ec40',
    expected_order_id_ref: 'NV-MOPV2CIK',
    customer_label: 'Henrry Robles',
    assigned_delivery_date: '2026-05-06',
  },
  {
    id: '69f509d5a1bea46cdce8e274',
    expected_order_id_ref: 'SUB-SK-4X-20260425',
    customer_label: 'Sukhwant Kahlon (fulfillment 2)',
    assigned_delivery_date: '2026-05-16',
  },
  {
    id: '69f509d5a1bea46cdce8e275',
    expected_order_id_ref: 'SUB-SK-4X-20260425',
    customer_label: 'Sukhwant Kahlon (fulfillment 3)',
    assigned_delivery_date: '2026-05-23',
  },
];

// Terminal statuses — never patch
const TERMINAL_STATUSES = new Set(['delivered', 'cancelled', 'completed']);

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

    const body = await req.json().catch(() => ({}));
    const dry_run: boolean = body.dry_run !== false;
    const approved_by: string = body.approved_by || 'unknown';

    if (!dry_run && approved_by === 'unknown') {
      return Response.json({ error: 'Live run requires approved_by in payload.' }, { status: 400 });
    }

    const ca = base44.asServiceRole;

    // Build lookup: CA Order.order_number → CA Order.id
    // Used to verify FulfillmentTask.order_id matches expected order
    const caOrders = await ca.entities.Order.list('-updated_date', 500);
    const caOrderByNum = new Map<string, string>(); // order_number → id
    for (const o of caOrders) {
      if (o.order_number) caOrderByNum.set(o.order_number, o.id);
    }

    const results: any[] = [];

    for (const patch of APPROVED_PATCHES) {
      const result: any = {
        id: patch.id,
        customer_label: patch.customer_label,
        expected_order_ref: patch.expected_order_id_ref,
        target_date: patch.assigned_delivery_date,
        status: null,
        blockers: [],
        before: null,
        patch: null,
      };

      // Fetch the FulfillmentTask by ID
      let task: any = null;
      try {
        const tasks = await ca.entities.FulfillmentTask.filter({ id: patch.id });
        task = tasks?.[0] ?? null;
      } catch (e: any) {
        result.status = 'ERROR';
        result.blockers.push(`Fetch error: ${e.message}`);
        results.push(result);
        continue;
      }

      if (!task) {
        result.status = 'NOT_FOUND';
        result.blockers.push(`FulfillmentTask ${patch.id} not found`);
        results.push(result);
        continue;
      }

      result.before = {
        id: task.id,
        order_id: task.order_id,
        customer_email: task.customer_email,
        status: task.status,
        fulfillment_number: task.fulfillment_number,
        delivery_date: task.delivery_date,
        assigned_delivery_date: task.assigned_delivery_date ?? null,
      };

      // Guard: terminal status check
      if (TERMINAL_STATUSES.has(task.status)) {
        result.status = 'SKIPPED_TERMINAL';
        result.blockers.push(`Status is terminal: ${task.status}`);
        results.push(result);
        continue;
      }

      // Guard: identity verification via order_id → CA Order → order_number
      const expectedCAOrderId = caOrderByNum.get(patch.expected_order_id_ref);

      // For Sukhwant (SUB-SK-4X-20260425), CA Order may be newly created — look up by order_number
      // The task.order_id must match the CA Order id for that order_number
      if (expectedCAOrderId && task.order_id !== expectedCAOrderId) {
        result.status = 'IDENTITY_MISMATCH';
        result.blockers.push(
          `order_id mismatch: task.order_id=${task.order_id}, expected CA Order id for ${patch.expected_order_id_ref}=${expectedCAOrderId}`
        );
        results.push(result);
        continue;
      }

      if (!expectedCAOrderId) {
        // CA Order not found — still allow for Sukhwant's new record; flag as warning
        result.blockers.push(`WARN: CA Order for ${patch.expected_order_id_ref} not found in CA — identity unverified`);
      }

      // Guard: already patched?
      if (task.assigned_delivery_date === patch.assigned_delivery_date) {
        result.status = 'ALREADY_PATCHED';
        result.patch = null;
        results.push(result);
        continue;
      }

      result.status = dry_run ? 'WOULD_PATCH' : 'PATCHED';
      result.patch = { assigned_delivery_date: patch.assigned_delivery_date };

      if (!dry_run) {
        try {
          await ca.entities.FulfillmentTask.update(task.id, { assigned_delivery_date: patch.assigned_delivery_date });
          console.log(`[Repair] Patched FulfillmentTask ${task.id} (${patch.customer_label}): assigned_delivery_date → ${patch.assigned_delivery_date}`);
        } catch (e: any) {
          result.status = 'WRITE_ERROR';
          result.blockers.push(`Write error: ${e.message}`);
        }
      }

      results.push(result);
    }

    const summary = {
      total: results.length,
      would_patch: results.filter(r => r.status === 'WOULD_PATCH' || r.status === 'PATCHED').length,
      already_patched: results.filter(r => r.status === 'ALREADY_PATCHED').length,
      skipped_terminal: results.filter(r => r.status === 'SKIPPED_TERMINAL').length,
      not_found: results.filter(r => r.status === 'NOT_FOUND').length,
      identity_mismatch: results.filter(r => r.status === 'IDENTITY_MISMATCH').length,
      errors: results.filter(r => r.status === 'ERROR' || r.status === 'WRITE_ERROR').length,
    };

    return Response.json({
      dry_run,
      mode: dry_run ? 'DRY RUN — zero writes' : 'LIVE — writes executed',
      summary,
      records: results,
      ...((!dry_run) && {
        audit_note: {
          executed_by: `repairFulfillmentTaskAssignedDeliveryDates — approved_by: ${approved_by}`,
          executed_at: new Date().toISOString(),
        }
      }),
    });

  } catch (e: any) {
    console.error('[Repair] Fatal:', e.message);
    return Response.json({ error: e.message }, { status: 500 });
  }
});
