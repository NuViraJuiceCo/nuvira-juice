const APPLY_PHRASE = 'RESOLVE STALE OPERATIONAL NOTICES';
const MAX_ROWS = 1000;
const WRITE_BATCH_SIZE = 10;
const MAINTENANCE_DEPLOYMENT = 'g68-notice-maintenance-v2-closed';

function text(value: unknown, max = 300): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function olderThan(value: unknown, hours: number): boolean {
  const timestamp = Date.parse(String(value || ''));
  return Number.isFinite(timestamp) && timestamp < Date.now() - hours * 60 * 60 * 1000;
}

function orderReference(row: any): string {
  return text(row?.existing_order_id || row?.incoming_payload?.id || row?.incoming_payload?.order_id, 180);
}

function validOperationalOrder(order: any): boolean {
  if (!order) return false;
  const paid = ['paid', 'succeeded'].includes(text(order.payment_status || order.financial_status, 40).toLowerCase());
  if (!paid) return false;
  if (order.fulfillment_method !== 'delivery') return true;
  return Boolean(text(order.delivery_address || order.address_line1, 300) && text(order.requested_delivery_date || order.assigned_delivery_date, 80));
}

async function inBatches(rows: any[], update: (row: any) => Promise<unknown>) {
  for (let index = 0; index < rows.length; index += WRITE_BATCH_SIZE) {
    await Promise.all(rows.slice(index, index + WRITE_BATCH_SIZE).map(update));
  }
}

export async function handleOperationalNoticeMaintenance(base44: any, user: any, body: any) {
  try {
    const apply = body?.action === 'maintenance_apply';
    if (apply && Deno.env.get('ENABLE_OPERATIONAL_NOTICE_MAINTENANCE') !== 'true') {
      return Response.json({ error: 'operational_notice_maintenance_disabled' }, { status: 409 });
    }
    if (apply && text(body?.confirmation, 100) !== APPLY_PHRASE) {
      return Response.json({ error: 'confirmation_required', confirmation_phrase: APPLY_PHRASE }, { status: 400 });
    }

    const [alerts, reviewRows, deliveryLogs, shopifyOrders] = await Promise.all([
      base44.asServiceRole.entities.OperationalAlert.list('-created_date', MAX_ROWS),
      base44.asServiceRole.entities.OrderReviewQueue.list('-created_date', MAX_ROWS),
      base44.asServiceRole.entities.CustomerMessageDeliveryLog.list('-created_date', MAX_ROWS),
      base44.asServiceRole.entities.ShopifyOrder.list('-created_date', MAX_ROWS),
    ]);
    const ordersById = new Map((shopifyOrders || []).map((row: any) => [String(row.id), row]));
    const ordersByNumber = new Map((shopifyOrders || []).map((row: any) => [text(row.shopify_order_number, 180).replace(/^#/, ''), row]));

    const routineAlerts = (alerts || []).filter((row: any) => row?.resolved !== true && row?.alert_type === 'new_order');
    const seenAlertKeys = new Set<string>();
    const duplicateAlerts: any[] = [];
    for (const row of alerts || []) {
      if (row?.resolved === true || row?.alert_type === 'new_order') continue;
      const key = `${text(row.alert_type, 80)}:${text(row.shopify_order_id || row.order_number, 180)}`;
      if (seenAlertKeys.has(key)) duplicateAlerts.push(row);
      else seenAlertKeys.add(key);
    }

    const legacyReviewRows = (reviewRows || []).filter((row: any) => {
      if (!['pending', 'reviewing'].includes(row?.status)) return false;
      return row?.incident_type === 'payment_not_paid' && olderThan(row?.created_date, 24 * 30);
    });
    const recoveredReviewRows = (reviewRows || []).filter((row: any) => {
      if (!['pending', 'reviewing'].includes(row?.status)) return false;
      const reference = orderReference(row);
      const number = text(row?.existing_order_number || row?.incoming_payload?.order_number, 180).replace(/^#/, '');
      return validOperationalOrder(ordersById.get(reference) || ordersByNumber.get(number));
    });
    const expiredPreparedLogs = (deliveryLogs || []).filter((row: any) =>
      row?.status === 'prepared' && olderThan(row?.created_date, 48));

    const changes = {
      routine_alerts_resolved: routineAlerts.length,
      duplicate_exception_alerts_resolved: duplicateAlerts.length,
      legacy_review_rows_archived: legacyReviewRows.length,
      recovered_review_rows_resolved: recoveredReviewRows.length,
      expired_prepared_logs_skipped: expiredPreparedLogs.length,
    };

    if (apply) {
      await inBatches([...routineAlerts, ...duplicateAlerts], row =>
        base44.asServiceRole.entities.OperationalAlert.update(row.id, {
          resolved: true,
          is_read: true,
          description: row.alert_type === 'new_order'
            ? 'Resolved automatically: routine successful orders are shown on the operations dashboard.'
            : 'Resolved automatically: duplicate active exception alert.',
        }));
      await inBatches(legacyReviewRows, row =>
        base44.asServiceRole.entities.OrderReviewQueue.update(row.id, {
          status: 'archived',
          queue_visibility_status: 'archived',
          archived_at: new Date().toISOString(),
          archived_by: user.email,
          archived_reason: 'stale unlinked payment review noise',
        }));
      const recoveredOnly = recoveredReviewRows.filter(row => !legacyReviewRows.some((legacy: any) => legacy.id === row.id));
      await inBatches(recoveredOnly, row =>
        base44.asServiceRole.entities.OrderReviewQueue.update(row.id, {
          status: 'resolved',
          queue_visibility_status: 'resolved',
          resolved_at: new Date().toISOString(),
          resolved_by: user.email,
          resolved_action: 'canonical_order_record_is_now_complete',
        }));
      await inBatches(expiredPreparedLogs, row =>
        base44.asServiceRole.entities.CustomerMessageDeliveryLog.update(row.id, {
          status: 'skipped',
          error_message: 'Expired preparation-only record; no provider delivery occurred.',
          metadata: { ...(row.metadata || {}), lifecycle_resolution: 'expired_preparation_record' },
        }));
    }

    return Response.json({
      success: true,
      deployment: MAINTENANCE_DEPLOYMENT,
      mode: apply ? 'apply' : 'preview',
      writes_performed: apply,
      scanned: {
        alerts: alerts?.length || 0,
        review_rows: reviewRows?.length || 0,
        delivery_logs: deliveryLogs?.length || 0,
        shopify_orders: shopifyOrders?.length || 0,
      },
      changes,
      samples: {
        routine_alert_ids: routineAlerts.slice(0, 10).map((row: any) => row.id),
        legacy_review_ids: legacyReviewRows.slice(0, 10).map((row: any) => row.id),
        recovered_review_ids: recoveredReviewRows.slice(0, 10).map((row: any) => row.id),
        expired_prepared_log_ids: expiredPreparedLogs.slice(0, 10).map((row: any) => row.id),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'notice_maintenance_failed');
    console.error('[updateAdminOpsAlertStatus:maintenance]', message);
    return Response.json({ error: text(message, 500) || 'notice_maintenance_failed' }, { status: 500 });
  }
}
