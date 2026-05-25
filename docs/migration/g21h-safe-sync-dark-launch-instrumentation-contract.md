# Phase G21H: Native safeSyncOrderUpdate Dark-Launch Instrumentation Contract

## Purpose

Define the first approved dark-launch shape for native Customer App `safeSyncOrderUpdate` parity work.

This phase is planning and contract only. It does not enable native writes, create logs, process orders, call providers, or change live order behavior.

## Current State

- The Hub `safeSyncOrderUpdate` function remains the live writer.
- The Customer App `previewNativeSafeSyncOrderUpdate` function is published and dry-run only.
- The G21F/G21G fixture runner passes 24/24 synthetic fixtures.
- G21G established golden-output expectations:
  - 21 Hub-code-confirmed fixtures
  - 2 contract-inferred fixtures
  - 1 dark-launch-required fixture
- The Hub function has no safe dry-run mode. Direct invocation can write `ShopifyOrder`, `OrderSyncLog`, and `OrderReviewQueue`, so dark launch must not call Hub except through the existing live bridge path that already owns the write.

## Non-Goals

G21H does not approve:

- native `safeSyncOrderUpdate` writes
- Customer App `ShopifyOrder` create/update
- `OrderSyncLog`, `OrderReviewQueue`, or `CommandLog` create/update
- Stripe, Shopify, or provider calls
- sync/retry/repair
- checkout, subscription, payment, refund, notification, production, fulfillment, inventory, or compliance changes
- customer-facing UI changes
- broad or bulk processing

## Dark-Launch Principle

Hub remains the source of truth and live writer during dark launch. The native Customer App planner receives the same normalized input and computes a dry-run plan. The comparison layer evaluates Hub result versus native plan and records only safe parity metadata after a separate implementation approval.

No native dry-run result may be used to alter live state during dark launch.

## Proposed Runtime Placement

The first implementation should run inside the existing Customer App-to-Hub bridge flow, after the Customer App has authenticated the admin/system context and before returning the Hub result.

Preferred placement:

1. Current bridge receives a safeSync/order sync request.
2. Bridge captures a minimal existing-order snapshot already needed by the bridge, or receives it from the Hub result if available.
3. Bridge sends the request to Hub exactly as today.
4. Bridge invokes native `previewNativeSafeSyncOrderUpdate` logic in dry-run mode using the same normalized input.
5. Bridge compares native dry-run output to Hub write result.
6. Bridge optionally writes a safe parity log only if a later phase approves a log destination and schema.

Do not place the first dark-launch code in public UI, checkout, Stripe webhooks, Shopify callbacks, or broad sync/repair tools.

## Feature Gate

Future implementation must require a server-side flag:

```text
ENABLE_NATIVE_SAFE_SYNC_DARK_LAUNCH=true
```

If absent or anything else:

- do not run native dry-run comparison
- do not log parity records
- keep existing Hub bridge behavior unchanged

Optional secondary gate for log writes:

```text
ENABLE_NATIVE_SAFE_SYNC_PARITY_LOG=true
```

The comparison can run without persistent logging if the first implementation returns metadata only to an internal test caller.

## Input Contract

The dark-launch comparator may accept only normalized safeSync inputs already being sent through the bridge:

- `source`
- `idempotency_key`
- `stripe_event_id` when present
- existing order snapshot fields needed for guard evaluation
- incoming order payload fields
- Hub response/action metadata

The comparator must not accept:

- a flag that enables native writes
- bulk order IDs
- live provider execution flags
- notification flags
- sync/retry/repair flags
- raw Stripe/Shopify payload dumps
- auth headers or secrets

## Existing Order Snapshot Policy

The native planner needs enough existing order state to evaluate:

- `order_lock_status`
- `manual_override`
- `source_channel`
- `stripe_subscription_id`
- `stripe_event_id_applied`
- `payment_status`
- `production_status`
- `production_snapshot`
- `line_items`
- `fulfillments`
- address fields
- order type and fulfillment mode

The snapshot should be minimized to these fields. It should not include raw provider payloads, full customer notes, secrets, auth headers, or unrelated records.

## Comparison Contract

Compare these fields first:

- action: create, update, skipped, rejected
- `would_create_order`
- `would_update_order`
- `would_quarantine`
- `would_reject`
- `error_code`
- accepted field names
- rejected field names and reasons
- payment status result
- production status result
- fulfillment status result
- order lock result
- `stripe_event_id_applied`
- `OrderSyncLog` draft action and success
- `OrderReviewQueue` draft incident type

Do not compare raw payload object equality. Compare normalized field-name and high-signal state outcomes.

## Mismatch Categories

| Category | Definition | Required Response |
| --- | --- | --- |
| `blocker` | Native would create/update when Hub rejects, native rejects when Hub writes, or duplicate/idempotency behavior differs. | Stop native writer work; add fixture and patch planner. |
| `high` | Lock, subscription, payment, line item, fulfillment, production snapshot, or address gate differs. | Patch planner before expanding dark launch. |
| `medium` | Log draft, queue draft, or non-critical metadata differs while write plan is equivalent. | Document or patch before cutover. |
| `low` | Wording, ordering, timestamp, or harmless metadata-only mismatch. | Track but does not block dark-launch continuation. |

## Safe Parity Log Shape

If a future phase approves persistent logging, prefer `CommandLog` with safe metadata or a dedicated `SafeSyncParityLog` entity. Do not add the entity until explicitly approved.

Candidate safe fields:

- `comparison_type: native_safe_sync_dark_launch`
- `source`
- `idempotency_key`
- `stripe_event_id`
- `hub_action`
- `native_action`
- `mismatch_category`
- `matched: boolean`
- `accepted_field_diff`
- `rejected_field_diff`
- `hub_error_code`
- `native_error_code`
- `review_queue_incident_diff`
- `created_at`

Do not store:

- raw order payloads
- full customer PII
- auth headers
- secrets
- Stripe/Shopify raw provider payloads
- payment method details
- stack traces

## Response Contract For First Implementation

If the comparator is exposed as an admin-only preview helper, it should return:

```json
{
  "success": true,
  "dry_run": true,
  "dark_launch": true,
  "native_writer_enabled": false,
  "hub_remains_live_writer": true,
  "matched": true,
  "mismatch_category": null,
  "hub_action": "updated",
  "native_action": "updated",
  "accepted_field_diff": [],
  "rejected_field_diff": [],
  "error_code_diff": null,
  "warnings": []
}
```

It must not return raw order records, raw provider payloads, secrets, auth headers, stack traces, or full customer PII.

## Rollout Plan

1. Contract and PR planning: complete this G21H document.
2. Implement admin/internal comparator in dry-run-only mode.
3. Run synthetic fixture comparison locally and through the preview helper.
4. Add a wrapper only if server-side context or secret-bearing bridge access is required.
5. Run dark launch on a narrow internal sample with persistent logging disabled.
6. If no blocker/high mismatches, enable safe parity logging for a larger sample.
7. Continue until the approved parity threshold is reached.
8. Only then plan native writer implementation.

## Acceptance Threshold Before Native Writer Planning

Native writer planning remains blocked until:

- zero blocker mismatches
- zero high mismatches
- medium mismatches fixed or explicitly accepted
- no unresolved idempotency mismatch
- no unresolved payment/subscription/lock/production snapshot mismatch
- dark-launch sample covers one-time, subscription, POS, duplicate event, refund/review, address quality, manual override, and production lock cases

## Test Plan For Future Implementation

- Unit fixture runner still passes 24/24.
- Comparator rejects `mode:"live"` or any writer flag.
- Comparator does not import or call Base44 entity create/update/delete.
- Comparator does not call Stripe, Shopify, provider APIs, sync, retry, or repair.
- Synthetic comparison returns `native_writer_enabled:false`.
- Mismatch fixtures produce expected category.
- No live records are created during boundary verification.

## Hard Stops

Stop implementation if:

- existing order snapshot cannot be obtained without broad live reads
- comparison requires raw provider payloads
- parity logging requires a schema not yet approved
- implementation needs native writes
- Hub bridge output lacks enough metadata to compare safely
- any part would process refunds, call providers, send notifications, or mutate customer-facing status

## Recommendation

Proceed next with a narrow dry-run comparator PR only if it can reuse the existing native planner without adding entity writes. Keep persistent parity logging disabled until a separate schema/logging decision is approved.
