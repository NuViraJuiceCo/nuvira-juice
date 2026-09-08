import { isVerifiedNoPaymentOrder } from './rewardSettlement.js';

export const REWARD_HANDOFF_REVISION = '2026-09-08.reward-handoff-v1';
// Separate channel receipts matter: an accepted email is not proof that push
// worked, and a missing device is not the same as a missing internal credential.
export const REWARD_HANDOFF_STAGES = Object.freeze([
  'native_operations', 'bag_return', 'shopify_mirror', 'confirmation_email',
  'customer_in_app', 'customer_push', 'operations_email', 'operations_push', 'sms',
]);
const skipReasons = {
  bag_return: ['not_requested'],
  customer_push: ['no_eligible_device', 'preference_opt_out', 'channel_disabled'],
  operations_push: ['no_eligible_device', 'channel_disabled'],
  sms: ['no_phone', 'preference_opt_out', 'channel_disabled'],
};
function assert(value, code) { if (!value) throw new Error(code); }
function receiptFor(stage, result) {
  // Store only bounded opaque evidence and defined reasons, never downstream
  // request/response payloads, addresses, device tokens, email or exception text.
  const evidence = result?.evidence_id;
  assert(typeof evidence === 'string' && /^[A-Za-z0-9._:/-]{1,180}$/.test(evidence), 'handoff_evidence_required');
  assert(result.outcome === 'completed' || (result.outcome === 'skipped'
    && skipReasons[stage]?.includes(result.reason)), 'handoff_outcome_unconfirmed');
  return { outcome: result.outcome, evidence_id: evidence,
    ...(result.outcome === 'skipped' ? { reason: result.reason } : {}) };
}

// Adapters must implement two different operations:
// - perform: do the exact step using the supplied stable idempotency key;
// - reconcile: read existing authoritative evidence ONLY, never resend/recreate.
// A lost provider response cannot justify a second send. If evidence cannot be
// recovered, the step remains review_required rather than duplicating an action.
export async function runRewardHandoff({ entities, orderId, adapters, now = () => new Date().toISOString(),
  attemptId = () => crypto.randomUUID() }) {
  assert(typeof entities.Order?.updateMany === 'function', 'conditional_order_updates_unavailable');
  assert(REWARD_HANDOFF_STAGES.every(stage => typeof adapters?.[stage]?.perform === 'function'
    && typeof adapters[stage].reconcile === 'function'), 'reward_handoff_adapters_incomplete');
  const load = async () => {
    const rows = await entities.Order.filter({ id: orderId }, undefined, 2);
    const row = rows?.length === 1 ? rows[0] : null;
    assert(isVerifiedNoPaymentOrder(row), 'reward_handoff_order_unconfirmed');
    const progress = row.reward_handoff;
    assert(!progress || (progress.revision === REWARD_HANDOFF_REVISION
      && progress.checkout_session_id === row.stripe_checkout_session_id
      && progress.context_hash === row.reward_settlement.context_hash && progress.steps
      && typeof progress.steps === 'object' && !Array.isArray(progress.steps)), 'reward_handoff_revision_unconfirmed');
    assert(row.reward_handoff_revision === undefined || (Number.isSafeInteger(row.reward_handoff_revision)
      && row.reward_handoff_revision >= 0), 'reward_handoff_counter_invalid');
    if (progress) {
      for (const [stage, step] of Object.entries(progress.steps)) {
        assert(REWARD_HANDOFF_STAGES.includes(stage), 'reward_handoff_unknown_stage');
        assert(['dispatching', 'complete'].includes(step?.state), 'reward_handoff_step_invalid');
        assert(typeof step.attempt_id === 'string' && typeof step.started_at === 'string'
          && Number.isFinite(Date.parse(step.started_at)), 'reward_handoff_attempt_invalid');
        if (step.state === 'complete') receiptFor(stage, step.receipt);
      }
    }
    return row;
  };
  const save = async (row, steps, status) => {
    const nextRevision = (row.reward_handoff_revision ?? 0) + 1;
    const query = { id: row.id, customer_email: row.customer_email,
      stripe_checkout_session_id: row.stripe_checkout_session_id,
      status: row.status, payment_status: 'paid', financial_status: 'paid', payment_captured: false,
      do_not_recover: { $ne: true }, is_abandoned_checkout: { $ne: true },
      reward_handoff_revision: row.reward_handoff_revision === undefined ? { $exists: false } : row.reward_handoff_revision,
      ...(row.updated_date ? { updated_date: row.updated_date } : {}) };
    const result = await entities.Order.updateMany(query, { $set: {
      reward_handoff_revision: nextRevision,
      reward_handoff: { revision: REWARD_HANDOFF_REVISION, checkout_session_id: row.stripe_checkout_session_id,
        context_hash: row.reward_settlement.context_hash, steps }, reward_handoff_status: status,
    } });
    assert(result?.success === true && result.has_more === false && [0, 1].includes(result.updated), 'reward_handoff_write_unconfirmed');
    const current = await load();
    assert(result.updated === 1 && current.reward_handoff_revision === nextRevision
      && JSON.stringify(current.reward_handoff?.steps) === JSON.stringify(steps), 'reward_handoff_write_raced');
    return current;
  };
  let row = await load();
  for (const stage of REWARD_HANDOFF_STAGES) {
    // Re-read between stages: cancellation, another worker, or fulfillment may
    // have advanced independently. Handoff must never replace lifecycle history.
    row = await load();
    let steps = { ...(row.reward_handoff?.steps || {}) };
    let step = steps[stage];
    if (step?.state === 'complete') continue;
    const idempotencyKey = `reward_handoff:${row.id}:${stage}`;
    if (step?.state === 'dispatching') {
      let proof = null;
      try { proof = receiptFor(stage, await adapters[stage].reconcile({ order: row, idempotencyKey, startedAt: step.started_at })); }
      catch { /* Unknown is not permission to repeat a customer/provider action. */ }
      if (!proof) {
        await save(row, steps, 'review_required');
        return { complete: false, review_required: true, stage };
      }
      steps[stage] = { ...step, state: 'complete', completed_at: now(), receipt: proof };
      row = await save(row, steps, 'pending');
      continue;
    }
    step = { state: 'dispatching', attempt_id: attemptId(), started_at: now() };
    steps[stage] = step;
    row = await save(row, steps, 'pending'); // Claim durably before dispatch.
    let receipt;
    try { receipt = receiptFor(stage, await adapters[stage].perform({ order: row, idempotencyKey })); }
    catch {
      // Preserve the dispatch claim even when a timeout followed provider success.
      // The next invocation can recover a receipt, but cannot blindly resend.
      const current = await load();
      if (current.reward_handoff?.steps?.[stage]?.state === 'complete') continue;
      assert(current.reward_handoff?.steps?.[stage]?.attempt_id === step.attempt_id, 'reward_handoff_claim_changed');
      await save(current, current.reward_handoff.steps, 'review_required');
      return { complete: false, review_required: true, stage };
    }
    const current = await load();
    const currentStep = current.reward_handoff?.steps?.[stage];
    if (currentStep?.state === 'complete') continue; // Concurrent read-only reconciliation won.
    assert(currentStep?.attempt_id === step.attempt_id, 'reward_handoff_claim_changed');
    steps = { ...current.reward_handoff.steps,
      [stage]: { ...currentStep, state: 'complete', completed_at: now(), receipt } };
    row = await save(current, steps, 'pending');
  }
  row = await load();
  assert(REWARD_HANDOFF_STAGES.every(stage => row.reward_handoff?.steps?.[stage]?.state === 'complete'),
    'reward_handoff_not_complete');
  if (row.reward_handoff_status !== 'complete') row = await save(row, row.reward_handoff.steps, 'complete');
  return { complete: true, revision: REWARD_HANDOFF_REVISION };
}
