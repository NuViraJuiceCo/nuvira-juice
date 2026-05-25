# Phase G21N: safeSync Dark-Launch Comparator Policy

## Purpose

Define the sample coverage gaps, comparison policy, readiness thresholds, and runtime dark-launch rules for native Customer App `safeSyncOrderUpdate`.

This phase is planning-only. It does not add runtime instrumentation, does not enable native writes, does not sample more real data, and does not create persistent parity logs.

## Current Inputs

| Input | Status | Notes |
| --- | --- | --- |
| Synthetic fixture suite | `24/24` passing | Covers all required safeSync guardrail categories with synthetic data. |
| Synthetic negative comparison | `1/1` blocker produced | Proves the comparator detects a behavior-level mismatch. |
| Redacted real sample suite | `6/6` passing | Covers selected real bridge/order shapes without live mutation. |
| Native safeSync planner | Dry-run only | `previewNativeSafeSyncOrderUpdate`; no live writer is enabled. |
| Dark-launch comparator | Dry-run only | `previewNativeSafeSyncDarkLaunchComparison`; compares supplied summaries only. |
| Exported-sample runner | Local only | Reads fixture JSON and does not call Base44, Hub, Stripe, Shopify, or providers. |

## Coverage Matrix

| Area | Synthetic Coverage | Redacted Real Coverage | Current Coverage Class | Gap / Note |
| --- | --- | --- | --- | --- |
| Clean delivery order | `clean_new_one_time_delivery_order` | `real_redacted_001`, `003`, `004` | Both | Real samples include one bridge-log create and two order-shape snapshots. |
| Pickup/POS order | `clean_new_pos_order`, `pos_order_address_bypass` | None | Synthetic only | No safe pickup/POS real candidate was found. Required before writer cutover if POS remains in native scope. |
| Subscription order | `subscription_order_update`, `subscription_ghost_duplicate_scenario` | `real_redacted_005` | Both, partial | Real sample is an event-shape sample derived from `Subscription`, not a live Hub safeSync bridge result. |
| Subscription update/cancel | `subscription_order_update` | None | Synthetic only | Canceled subscription state was not copied into the real sample payload. Needs dedicated subscription sampling before native subscription writes. |
| Incomplete address | `incomplete_delivery_address` | `real_redacted_006` | Both | Real sample is review-like, but not a live `OrderReviewQueue` row. |
| Low-quality order | `low_quality_new_order`, `unknown_order_attempt` | None | Synthetic only | No real low-quality queued order was available. |
| Duplicate/idempotency event | `duplicate_stripe_event`, `duplicate_order_number` | `real_redacted_002` | Both | Real sample maps Hub `dedupe_exact_match` to skipped/no-second-write for comparator compatibility. |
| Paid downgrade attempt | `paid_order_attempted_downgrade_to_pending` | None | Synthetic only | Must remain covered before writer cutover; real sampling is optional unless naturally observed. |
| Pending-to-paid upgrade | `pending_order_upgrade_to_paid` | None | Synthetic only | Needs future real sample if pending order states are common in production. |
| `line_items` erase attempt | `erase_line_items_attempt` | None | Synthetic only | Critical subscription hard-lock guard; no live destructive sample should be forced. |
| `fulfillments` erase attempt | `erase_fulfillments_attempt` | None | Synthetic only | Critical subscription hard-lock guard; no live destructive sample should be forced. |
| `stripe_subscription_id` erase attempt | `erase_stripe_subscription_id_attempt` | None | Synthetic only | Critical subscription hard-lock guard; synthetic coverage is acceptable until safe real event appears. |
| Production snapshot mismatch | `production_scheduled_line_item_mismatch`, `production_snapshot_fulfillment_mismatch` | None | Synthetic only | Must be proven in dark launch before native writer cutover if production-scheduled orders can be touched. |
| `FIELD_OWNERSHIP` rejection | `field_ownership_rejection` | None | Synthetic only | Must remain 100% passing. Real sample optional before dark launch, required before cutover if available. |
| `LOCK_FROZEN_FIELDS` rejection | `lock_frozen_fields_rejection` | None | Synthetic only | Must remain 100% passing. Real sample optional before dark launch, required before cutover if available. |
| `manual_override` guard | `manual_override_protected_field_update` | None | Synthetic only | Needs dark-launch monitoring before native writer cutover. |
| Partial refund | `partial_refund_review_queue_case` | None | Synthetic only, excluded | Keep synthetic-only until refund migration contract. Do not sample refund flows in general safeSync dark launch. |
| Full refund | `refunded_cancelled_order_exclusion` | None | Synthetic only, excluded | Refund/money-adjacent flow remains outside first dark-launch scope. |
| `OrderReviewQueue` creation | Incomplete address, low-quality, partial refund, overwrite, unknown, subscription downgrade fixtures | `real_redacted_006` as queue-equivalent only | Synthetic plus inferred real | No live `OrderReviewQueue` row was readable. Must not block first runtime dark launch if synthetic queue behavior is passing. |
| `OrderSyncLog` creation | All synthetic fixtures draft `OrderSyncLog` | All 6 redacted samples include Hub-equivalent summary | Both, partial | Real bridge logs preserve action/status but not full field-level safeSync plan. |
| Refund/cancel/excluded behavior | `refunded_cancelled_order_exclusion` | None | Synthetic only, excluded | Hold until refund migration phase. |
| Subscription ghost duplicate | `subscription_ghost_duplicate_scenario` | None | Synthetic only | Keep synthetic-only until subscription dark-launch sampling is explicitly approved. |
| POS address bypass | `pos_order_address_bypass` | None | Synthetic only | Needs future real pickup/POS sample or explicit waiver before writer cutover. |

## Known Real-Sample Gaps

- No pickup/POS real sample was found.
- No live `OrderReviewQueue` sample was readable in the Customer App at extraction time.
- Refund, payment/refund mutation, provider, notification, delivery status, proof/drop, unable-to-deliver, repair/replay/backfill, broad sync, inventory, purchase order, production complete/verify, credit, and bag-return samples were excluded by design.
- Bridge logs preserve status/action but do not preserve full accepted/rejected safeSync field plans. Redacted real `hub_result` values are Hub-equivalent golden summaries, not raw Hub dry-run outputs.
- Some real samples are order-shape snapshots, not direct bridge-log events, because most recent bridge logs were excluded categories.

## Which Gaps Must Close Before Each Gate

| Gap | Before Runtime Dark Launch | Before Native Writer Cutover |
| --- | --- | --- |
| Pickup/POS real sample | Not required if POS source is excluded from first runtime dark-launch allowed sources. | Required or explicitly waived if POS remains in writer scope. |
| Live `OrderReviewQueue` sample | Not required if synthetic queue fixtures pass and runtime dark launch logs queue summaries only. | Required for final cutover, or queue behavior must be proven by a safe real queued event. |
| Refund samples | Not required; refunds stay excluded. | Required only after dedicated refund migration contract and tests. |
| Provider/payment mutation samples | Not required; excluded from safeSync dark-launch scope. | Required only for provider/refund/reconciliation cutover phases. |
| Customer-facing delivery samples | Not required; excluded. | Required only for delivery/status migration phases. |
| Repair/replay/backfill samples | Not required; excluded. | Required only for dedicated repair tooling migration. |
| Production snapshot real mismatch | Not required for first runtime dark launch if production-scheduled writes are excluded. | Required or explicitly waived before native writer can touch production-scheduled/in-production orders. |
| Subscription destructive-field real attempts | Do not force. | Synthetic coverage plus dark-launch observation is acceptable; real destructive samples should not be manufactured. |

## Comparator Policy

Future comparator output should use these statuses:

| Status | Meaning | Runtime Handling |
| --- | --- | --- |
| `match` | Hub summary and native dry-run summary agree on action, create/update/reject/skip flags, accepted/rejected fields, error code, sync-log action, and queue incident. | Count as passing. |
| `acceptable_difference` | Difference is known, documented, non-material, and does not alter write eligibility or guardrail outcome. | Count separately; does not block sampling, but must be visible. |
| `mismatch` | Difference is material but not automatically unsafe, such as non-critical accepted field drift. | Requires review; can block cutover depending on severity. |
| `unsupported` | Sample source or event type is outside the current native planner/comparator scope. | Do not run native write; exclude source until a contract exists. |
| `blocked` | Difference indicates unsafe behavior or missing critical guardrail. | Hard block for native writer and runtime expansion. |
| `needs_manual_review` | Sample lacks enough redacted context to classify safely. | Hold that sample; do not count as passing. |

Current implementation only emits `matched:true/false` plus `mismatch_category` severity. The statuses above should be introduced before persistent runtime logging so reports are operationally readable.

## Mismatch Categories

| Category | Examples | Default Severity |
| --- | --- | --- |
| `accepted_fields_diff` | Native would accept fields Hub rejects, or vice versa. | High if critical field; medium otherwise. |
| `rejected_fields_diff` | Native misses or adds rejected fields. | High if critical field; medium otherwise. |
| `proposed_state_diff` | Final proposed status, lock, payment, subscription, line item, fulfillment, or address state differs. | High/blocker depending on field. |
| `order_sync_log_diff` | Draft action, success flag, reason, idempotency key, or field lists differ. | Medium, high if it hides a guardrail result. |
| `order_review_queue_diff` | Queue incident missing, extra, or wrong incident type. | High for missing required queue, medium for incident label drift. |
| `error_code_diff` | Error/rejection code differs. | Blocker if write/reject behavior differs; medium otherwise. |
| `idempotency_diff` | Duplicate event not skipped, or non-duplicate skipped. | Blocker. |
| `normalization_diff` | Title cleanup, array ordering, casing, or date formatting differs. | Acceptable difference if write outcome is unchanged. |
| `source_ownership_diff` | FIELD_OWNERSHIP or source label behavior differs. | High/blocker. |
| `redaction_limitation` | Redacted sample omits raw value needed to compare proposed state. | Needs manual review or acceptable difference if field-level comparison still works. |

## Acceptable Differences

These may be classified as `acceptable_difference` when action, guardrails, and write eligibility are unchanged:

- Redacted customer email/name/phone/address placeholders differ from live values.
- Stable fake Stripe/Shopify ids differ from real ids.
- Timestamps are date-shifted, omitted, or compared only by presence.
- Raw provider/webhook payload values are omitted.
- Fixture-only synthetic ids are used.
- Array ordering differs after semantic normalization.
- Native creates default `order_type` or `fulfillment_mode` for a new order where Hub behavior is known to derive the same semantics downstream.
- `dedupe_exact_match` is summarized as skipped/no-second-write for dark-launch comparison.

## Unacceptable Differences

These must be `blocked` or high-severity `mismatch`:

- Wrong accepted/rejected fields for payment, subscription, lock, line items, fulfillments, production snapshot, address, production status, fulfillment status, or order lock fields.
- Missing `OrderReviewQueue` draft when Hub would queue.
- Missing `OrderSyncLog` draft/action when Hub would log.
- Paid order downgrade accepted outside approved refund flow.
- Subscription hard lock missed.
- Production snapshot mismatch missed.
- Frozen field accepted under `LOCK_FROZEN_FIELDS`.
- Duplicate/idempotency event not detected.
- Address quality gate missed for new delivery orders.
- Customer App source allowed to alter operational ownership fields that Hub would protect.
- Any comparator path that requires raw provider payloads, auth headers, secrets, customer-facing notification data, or payment method details.

## Readiness Thresholds

### To Move From Offline Fixtures To Runtime Dark Launch

All must be true:

- Synthetic fixture runner remains `24/24` passing.
- Synthetic negative comparison still produces `blocker`.
- Current redacted real exported sample runner remains `6/6` passing.
- No blocker or high-severity parity gaps remain in the planned runtime source set.
- At least one real or redacted-real sample exists for:
  - one-time delivery
  - subscription shape
  - duplicate/idempotency
  - incomplete/review-like behavior
- Pickup/POS, refund, production snapshot, and repair/replay gaps are documented and excluded from initial allowed runtime sources.
- Runtime dark launch is feature-flagged, no-write, and has a kill switch.

### To Move From Runtime Dark Launch To Native Writer

All must be true:

- Runtime dark launch has zero `blocked` results over the approved sample window.
- All `mismatch` results are resolved or documented as `acceptable_difference`.
- `OrderReviewQueue` and `OrderSyncLog` behavior is proven for real queue/log cases or explicitly covered by a safe real pilot.
- Pickup/POS has a real sample or is explicitly excluded from native writer source allowlist.
- Refund and money-adjacent paths have a dedicated migration contract before they can route to the native writer.
- Production-scheduled/in-production locked orders are proven or excluded.
- Native writer has its own feature flag, source allowlist, rollback plan, and idempotency tests.

## Runtime Dark-Launch Instrumentation Policy

Future runtime dark launch should:

- run native safeSync planner alongside the existing Hub bridge
- keep Hub as the only live writer
- not mutate via the native planner
- not call Stripe, Shopify, providers, sync/retry/repair, or notifications
- compare Hub result summary to native dry-run summary
- redact/summarize customer and provider fields before any logging
- be feature-flagged and source-allowlisted
- default to no persistent logging
- support an immediate kill switch

Proposed flags:

| Flag | Purpose |
| --- | --- |
| `ENABLE_NATIVE_SAFE_SYNC_DARK_LAUNCH=true` | Enables no-write comparison path. |
| `NATIVE_SAFE_SYNC_DARK_LAUNCH_SAMPLE_RATE` | Limits volume; first value should be low, such as `0.05` or owner-approved exact count. |
| `NATIVE_SAFE_SYNC_DARK_LAUNCH_ALLOWED_SOURCES` | Comma-separated source labels, initially `customer_app` only. |
| `NATIVE_SAFE_SYNC_DARK_LAUNCH_LOGGING_MODE=none|local|entity` | Controls persistence; first runtime phase should use `none` or tightly scoped local-only operator output. |
| `NATIVE_SAFE_SYNC_DARK_LAUNCH_KILL_SWITCH=true` | Emergency off switch if the environment requires separate kill semantics. |

Initial allowed sources should exclude:

- refunds
- Stripe/Shopify provider webhooks
- provider reconciliation
- repair/replay/backfill
- customer-facing delivery status
- proof/drop/unable-to-deliver
- notifications
- subscriptions that imply cancellation, downgrade, or destructive field changes

## Persistent Logging Recommendation

| Option | Pros | Risks | Recommendation |
| --- | --- | --- | --- |
| No persistent logging | Lowest risk; no new records or privacy exposure. | Harder to review larger sample windows. | Use for first runtime dark launch smoke. |
| Local file in migration environment | Useful for owner-operated sampling without app schema writes. | Operator-machine artifact; must manage redaction and retention. | Good second step after no-persistence smoke. |
| Customer App `CommandLog` | Reuses existing generalized command log. | Could mix parity noise with command audit; creates live records. | Hold until privacy contract and retention policy are approved. |
| Extend `OrderSyncLog` | Tied to order sync semantics. | Could confuse real sync audit with dry-run comparison logs. | Avoid for parity logging. |
| Dedicated `SafeSyncParityLog` entity | Clean separation and queryability. | Requires schema, privacy, retention, and writer audit. | Best long-term if persistent dark launch becomes necessary. |

Recommended first runtime dark launch: `NATIVE_SAFE_SYNC_DARK_LAUNCH_LOGGING_MODE=none`, with aggregate operator-visible output only. If persistence is needed, implement a dedicated `SafeSyncParityLog` later rather than overloading `OrderSyncLog`.

## Next Sample Recommendation

Do not collect more real samples before the comparator policy is accepted.

If more samples are later approved, use this order:

1. Wait for or locate one safe pickup/POS order snapshot, no provider call.
2. Fix/confirm live `OrderReviewQueue` readability and extract one redacted queued sample if available.
3. Collect 3-5 more clean one-time delivery bridge samples only if they are non-refund, non-delivery-status, and non-repair.
4. Keep refunds synthetic until the refund migration contract.
5. Keep provider webhooks, repair/replay/backfill, notifications, delivery proof/drop, inventory, purchase orders, and production verification out of safeSync dark-launch sampling.

## Hard Stops

Stop before any step that would:

- enable native safeSync writer
- add runtime instrumentation without feature flag and kill switch
- create persistent parity logs
- read or store raw provider payloads
- store full address, phone, raw customer notes, auth headers, secrets, or payment method details
- call Stripe, Shopify, providers, sync/retry/repair, notifications, or mutation endpoints
- process refunds or payment/refund mutations
- run broad sync, repair, replay, or backfill
- mutate `ShopifyOrder`, Customer App `Order`, `OrderSyncLog`, `OrderReviewQueue`, `CommandLog`, fulfillment, production, inventory, compliance, route, proof/drop, or customer-facing state

## Recommended Next Phases

1. **G21O: runtime dark-launch no-persistence contract**
   - Docs/contract first.
   - Define exact bridge insertion point, source allowlist, sample-rate behavior, kill switch, and no-persistence output.

2. **G21P: runtime dark-launch no-persistence PR prep**
   - Implement feature-flagged comparison only if G21O approves it.
   - No native writes, no persistent logs, no provider calls.

3. **G21Q: controlled runtime dark-launch smoke**
   - Run only with owner-approved source/rate.
   - Confirm Hub remains sole writer and native planner only computes summaries.

## Final Recommendation

Proceed to G21O runtime dark-launch no-persistence contract. Do not add persistent logging yet, do not broaden real sampling, and do not enable native safeSync writes.
