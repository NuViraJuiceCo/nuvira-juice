import { readRefundProof } from './refundProof.js';
import { reconcileFullRefundLoyalty } from './refundLoyalty.js';

export const REFUND_RECOVERY_REVISION = '2026-09-09.refund-recovery-v1';
const check = (value, code) => { if (!value) throw new Error(code); };
const email = value => String(value || '').trim().toLowerCase();
const valueQuery = value => value === undefined ? { $exists: false } : value;

// Projection only: an operator can investigate an uncertain delivery without
// authorizing another refund, points debit or customer notification.
async function projectCommunicationReview({ entities, order, paymentId, amountCents, now }) {
  const queue = entities.OrderReviewQueue;
  check(typeof queue?.filter === 'function' && typeof queue?.create === 'function', 'refund_review_queue_unavailable');
  const key = `refund_communication_review:${paymentId}`;
  const read = async () => {
    const rows = await queue.filter({ idempotency_key: key }, undefined, 20);
    check(Array.isArray(rows) && rows.length < 20 && rows.every(row => row.id
      && row.existing_order_id === order.id && row.incident_type === 'refund_communication_unconfirmed'
      && row.incoming_payload?.amount_cents === amountCents
      && ['pending', 'reviewing', 'resolved', 'rejected', 'archived'].includes(row.status)),
    'refund_communication_review_identity_invalid');
    return rows;
  };
  let rows = await read();
  if (!rows.length) {
    await queue.create({ idempotency_key: key, incident_type: 'refund_communication_unconfirmed',
      existing_order_id: order.id, existing_order_number: order.order_number, existing_order_type: 'Order',
      customer_email: email(order.customer_email), incoming_source: 'stripe_refund_communication',
      status: 'pending', occurrence_count: 1, first_seen_at: now(), last_seen_at: now(),
      incoming_payload: { revision: REFUND_RECOVERY_REVISION, amount_cents: amountCents },
      issue_description: 'Stripe confirmed the full refund, but customer email, in-app or push delivery is not fully confirmed. Automatic notification replay is held to prevent duplicate messages.',
      recommended_action: 'Inspect the order and provider delivery receipts, including legacy refund emails. Confirm each channel before any explicit resend. Do not refund the payment again. Closing this alert does not resend a message or reverse points.',
    });
    rows = await read();
  }
  check(rows.length > 0, 'refund_communication_review_write_unconfirmed');
  const handled = rows.filter(row => (row.status !== 'pending' || row.admin_notes || row.resolved_by)
    && row.resolved_action !== 'duplicate_refund_communication_review');
  check(handled.length <= 1, 'refund_communication_review_decision_conflict');
  const canonical = handled[0] || [...rows].filter(row => row.status === 'pending').sort((a, b) => a.id.localeCompare(b.id))[0]
    || [...rows].sort((a, b) => a.id.localeCompare(b.id))[0];
  for (const duplicate of rows.filter(row => row.id !== canonical.id && row.status === 'pending'
    && !row.admin_notes && !row.resolved_by)) {
    check(typeof queue.updateMany === 'function', 'refund_review_queue_conditional_update_required');
    const result = await queue.updateMany({ id: duplicate.id, status: 'pending',
      updated_date: valueQuery(duplicate.updated_date),
    }, { $set: { status: 'archived', resolved_action: 'duplicate_refund_communication_review',
      archived_reason: 'Duplicate projection of the same unresolved refund communication.' } });
    check(result?.success === true && result.has_more === false && [0, 1].includes(result.updated),
      'refund_communication_review_deduplication_unconfirmed');
  }
  const confirmed = await read();
  check(confirmed.some(row => row.id === canonical.id) && confirmed.filter(row => row.status === 'pending').length <= 1,
    'refund_communication_review_write_unconfirmed');
}

// All mutations below are recoverable local projections. This coordinator has
// no Stripe refund/create method and cannot refund money a second time.
export async function recoverOrderRefund({ entities, stripe, event, order: initialOrder,
  postLoyalty, projectNative, notifyCustomer, communicationsReady, skipLoyalty = false,
  now = () => new Date().toISOString(), attemptId = () => crypto.randomUUID() }) {
  const proof = await readRefundProof({ entities, stripe, event, order: initialOrder });
  if (proof.pending) return { received: true, action: 'refund_not_succeeded' };
  const { paymentId, amountCents, full } = proof;
  const load = async () => {
    const rows = await entities.Order.filter({ stripe_payment_intent_id: paymentId }, undefined, 2);
    check(Array.isArray(rows) && rows.length === 1 && rows[0].id === initialOrder.id
      && email(rows[0].customer_email) === proof.customerEmail, 'refund_order_changed');
    const row = rows[0];
    check(row.refund_processing_revision === undefined || (Number.isSafeInteger(row.refund_processing_revision)
      && row.refund_processing_revision >= 0), 'refund_processing_revision_invalid');
    check(!row.refund_processing || (row.refund_processing.revision === REFUND_RECOVERY_REVISION
      && row.refund_processing.payment_intent_id === paymentId && row.refund_processing.amount_cents === amountCents),
    'refund_processing_identity_invalid');
    return row;
  };
  const save = async (row, patch) => {
    check(typeof entities.Order.updateMany === 'function', 'refund_conditional_update_required');
    const revision = (row.refund_processing_revision || 0) + 1;
    const result = await entities.Order.updateMany({ id: row.id, customer_email: row.customer_email,
      stripe_payment_intent_id: paymentId, status: valueQuery(row.status), payment_status: valueQuery(row.payment_status),
      refund_amount: valueQuery(row.refund_amount), refund_status: valueQuery(row.refund_status),
      refund_processing_revision: valueQuery(row.refund_processing_revision),
      ...(row.updated_date ? { updated_date: row.updated_date } : {}),
    }, { $set: { ...patch, refund_processing_revision: revision } });
    check(result?.success === true && result.has_more === false && result.updated === 1, 'refund_write_raced_or_unconfirmed');
    const current = await load();
    check(current.refund_processing_revision === revision && Object.entries(patch)
      .every(([key, value]) => JSON.stringify(current[key]) === JSON.stringify(value)), 'refund_write_readback_failed');
    return current;
  };
  let order = await load();
  const alreadyFull = order.payment_status === 'refunded' && order.refund_status === 'fully_refunded';
  // Prior code could persist "refunded" before sending an untracked email.
  // New refunds atomically save their pending receipt with the terminal status.
  const newProcessing = () => ({ revision: REFUND_RECOVERY_REVISION,
    payment_intent_id: paymentId, amount_cents: amountCents, native_confirmed: false,
    communication: { state: order.payment_status === 'refunded' || order.status === 'refunded'
      ? 'legacy_review_required' : 'pending' },
  });
  check(Math.round(Number(order.refund_amount || 0) * 100) <= amountCents && (full || !alreadyFull),
    'refund_total_regression_requires_review');
  const changed = order.refund_status !== (full ? 'fully_refunded' : 'partially_refunded')
    || order.refund_type !== (full ? 'full' : 'partial')
    || Math.round(Number(order.refund_amount || 0) * 100) !== amountCents
    || (full && (!order.stripe_refund_id || !order.refund_processing
      || order.status !== 'refunded' || order.payment_status !== 'refunded'
      || order.financial_status !== 'refunded' || order.payment_captured !== false || !order.do_not_recover));
  if (changed) {
    order = await save(order, {
      refund_status: full ? 'fully_refunded' : 'partially_refunded', refund_type: full ? 'full' : 'partial',
      refund_amount: amountCents / 100, refund_currency: 'USD', refund_source: 'stripe_webhook',
      refunded_at: alreadyFull && order.refunded_at ? order.refunded_at : now(),
      refund_event_id: alreadyFull && order.refund_event_id ? order.refund_event_id : event.id,
      stripe_refund_id: alreadyFull && order.stripe_refund_id ? order.stripe_refund_id : proof.latestRefund.id,
      is_partial_refund: !full,
      ...(full ? { status: 'refunded', payment_status: 'refunded', financial_status: 'refunded',
        payment_captured: false, do_not_recover: true, sync_status: 'refund_pending_native_projection',
        ...(!order.refund_processing ? { refund_processing: newProcessing() } : {}) }
        : { refund_review_required: !proof.approvedCustomerAdjustment,
          refund_review_status: proof.approvedCustomerAdjustment ? 'resolved' : 'pending',
          refund_reason: proof.approvedCustomerAdjustment ? 'Customer requested refund for the OASIS portion only.'
            : 'Stripe partial refund received; operational and loyalty review required.',
          sync_status: proof.approvedCustomerAdjustment ? 'customer_adjustment_hub_pending' : 'partial_refund_review_required' }),
      status_history: [...(order.status_history || []), { status: full ? 'refunded' : order.status,
        timestamp: now(), message: `Stripe confirmed cumulative ${full ? 'full' : 'partial'} refund: $${(amountCents / 100).toFixed(2)}.` }],
    });
  }
  if (!full) return { received: true, action: proof.approvedCustomerAdjustment
    ? 'customer_adjustment_partial_refund_recorded' : 'partial_refund_review_required', refund_amount: amountCents / 100 };

  check(order.refund_processing, 'refund_processing_receipt_missing');
  if (!order.refund_processing.native_confirmed) {
    const result = await projectNative(order);
    check(result?.success === true && result.native_authoritative === true && result.external_calls_performed === false
      && result.native_order_ops?.success === true && result.native_order_ops.dry_run === false
      && ['refund_mirrored', 'skipped'].includes(result.native_order_ops.action)
      && (result.native_order_ops.action !== 'skipped' || result.native_order_ops.reason === 'already_refunded_idempotent'),
    'refund_native_projection_unconfirmed');
    order = await load();
    order = await save(order, { refund_processing: { ...order.refund_processing, native_confirmed: true },
      sync_status: 'refund_native_projected' });
  }
  const normalizedEvent = { ...event, type: 'charge.refunded', data: { object: proof.charge } };
  const loyalty = skipLoyalty ? { outcome: 'skipped_staging_safe_mode' }
    : await reconcileFullRefundLoyalty({ entities, stripe, event: normalizedEvent, order, postLoyalty });

  // Recover delivery receipts before any dispatch. Unknown responses cannot be
  // replayed after Resend's finite idempotency window and duplicate a message.
  const communicationProof = async () => {
    const marker = order.stripe_refund_id;
    check(/^re_[\w]+$/.test(marker || ''), 'refund_communication_marker_missing');
    const read = async channel => {
      const rows = await entities.CustomerMessageDeliveryLog.filter({
        idempotency_key: `txn:${order.id}:refunded:${channel}:${marker}`,
      }, '-created_date', 20);
      check(Array.isArray(rows) && rows.length < 20 && rows.every(row => row.order_id === order.id
        && email(row.customer_email) === proof.customerEmail && row.channel === channel
        && row.metadata?.event === 'refunded' && row.metadata.event_id === marker), 'refund_communication_log_invalid');
      return rows;
    };
    const emails = await read('email'); const pushes = await read('push');
    const acceptedEmails = emails.filter(row => ['sent', 'delivered'].includes(row.status) && row.provider === 'resend'
      && typeof row.provider_message_id === 'string' && row.provider_message_id.length > 0);
    const acceptedPushes = pushes.filter(row => row.status === 'sent' || (row.status === 'skipped'
      && ['no_active_push_subscription', 'customer_push_disabled', 'push_suppressed_by_channel_plan',
        'push_preference_disabled'].includes(row.error_message)));
    check(new Set(acceptedEmails.map(row => row.provider_message_id)).size <= 1, 'refund_duplicate_email_requires_review');
    const push = acceptedPushes[0];
    if (!acceptedEmails.length || !push?.metadata?.notification_id) return { complete: false, existing: emails.length + pushes.length > 0 };
    const notifications = await entities.Notification.filter({ id: push.metadata.notification_id }, undefined, 2);
    check(Array.isArray(notifications) && notifications.length === 1 && notifications[0].order_id === order.id
      && email(notifications[0].customer_email) === proof.customerEmail
      && notifications[0].notification_subtype === 'order_refunded'
      && notifications[0].idempotency_key === `elevated_order:${order.id}:refunded:${marker}`, 'refund_in_app_receipt_invalid');
    return { complete: true, email_log_id: acceptedEmails[0].id, push_log_id: push.id, notification_id: notifications[0].id };
  };
  let communication;
  try {
    communication = await communicationProof();
    order = await load();
    if (!communication.complete) {
      check(order.refund_processing.communication?.state === 'pending' && !communication.existing,
        'refund_communication_outcome_requires_review');
      check(communicationsReady === true, 'refund_communications_not_configured');
      order = await save(order, { refund_processing: { ...order.refund_processing,
        communication: { state: 'dispatching', attempt_id: attemptId(), started_at: now() } } });
      try { await notifyCustomer(order); } catch { /* Reconcile persisted receipts; never blindly resend. */ }
      communication = await communicationProof();
      check(communication.complete, 'refund_communication_outcome_requires_review');
    }
  } catch (error) {
    // Do not convert a database/configuration outage before dispatch into a
    // reason to resend. Persist only the bounded, already-proven incident.
    if (['refund_communication_outcome_requires_review', 'refund_communication_log_invalid',
      'refund_communication_marker_missing', 'refund_duplicate_email_requires_review',
      'refund_in_app_receipt_invalid'].includes(error?.message)) {
      await projectCommunicationReview({ entities, order, paymentId, amountCents, now });
    }
    throw error;
  }
  order = await load();
  if (order.refund_processing.communication.state !== 'complete') await save(order, {
    refund_processing: { ...order.refund_processing, communication: { state: 'complete', ...communication, completed_at: now() } },
  });
  return { received: true, action: alreadyFull ? 'already_refunded' : 'full_refund_processed',
    refund_amount: amountCents / 100, loyalty_outcome: loyalty.outcome, native_confirmed: true, communications_confirmed: true };
}
