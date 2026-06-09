# G33C: Eligible one-time order native workflow preview bundle

## Scope

G33C adds an admin-safe, read-only preview bundle for evaluating a proposed one-time order before any second controlled native pilot. It is intended to replace manual chaining of many preview panels when an operator needs to know whether a future natural order is ready for exact-order native workflow approval.

This phase does not open gates, run live commands, create native records, update Customer App orders, update native ShopifyOrder or FulfillmentTask records, create or update production batches, send notifications, call Stripe, call Shopify, call providers, run sync/repair/replay, deduct inventory, create PurchaseOrders, mutate Hub records, or disable the Hub bridge.

## Function

- Deployed runtime: `base44/functions/previewNativeOrderCutoverReadiness/entry.ts` with `preview_mode: ELIGIBLE_ONE_TIME_ORDER_NATIVE_WORKFLOW`.
- Requested/alias function name: `previewEligibleOneTimeOrderNativeWorkflow`.
- Reason for deployed alias: Base44 CLI currently blocks creating new function records on this app because the app is above the CLI function-count creation limit. G33C therefore extends the already-deployed read-only cutover readiness preview instead of adding a new remote function.
- Auth: admin session or internal preview secret.
- Public unauthenticated POST returns `401`.
- GET and other non-POST methods return `405`.
- Default mode:
  - `EXACT_ORDER_PREVIEW` when `order_number` or `customer_app_order_id` is supplied.
  - `RECENT_CANDIDATE_SCAN` when no exact target is supplied.

### Allowed inputs

- `mode`
- `order_number`
- `shopify_order_number`
- `customer_app_order_id`
- `base44_order_id`
- `order_id`
- `max_recent_candidates`
- `include_hub_context`
- `request_id`
- internal preview secret fields/headers used by existing admin preview patterns

Unsupported body keys are rejected so callers cannot smuggle write flags, provider payloads, notification payloads, bulk ids, or sync/repair requests into the preview path.

## Reads

The preview reads only local Customer App/native context:

- `Order`
- `ShopifyOrder`
- `FulfillmentTask`
- `OrderSyncLog`
- `OrderReviewQueue`
- `CommandLog`
- `SafeSyncParityLog`
- `ProductionBatch`
- `BatchComplianceLog`

Hub context is reported conservatively from local bridge/sync evidence. The function does not call Hub repair/replay, Shopify, Stripe, provider APIs, or broad sync endpoints.

## Response contract

Top-level fields include:

- `success`
- `dry_run:true`
- `writes_performed:false`
- `mode`
- `include_hub_context`
- `scanned_count`
- `selected_order_number`
- `eligible_candidate_count`
- `eligible_candidate_found`
- `candidate_rows`
- `blockers`
- `warnings`
- `next_action`
- `safety`

Each candidate row includes safe IDs and operational readiness fields:

- order number and Customer App/native ids where found
- payment/capture state
- order type/source/fulfillment type
- delivery or pickup date
- line item count and total quantity
- cancelled/refunded and subscription/multi-delivery flags
- native ShopifyOrder and FulfillmentTask presence
- OrderSyncLog, OrderReviewQueue, CommandLog, and SafeSyncParityLog summaries
- production batch/compliance counts and lifecycle state
- post-production, customer status, delivery, and notification policy state
- eligibility classification
- blockers, warnings, and next safe action

The preview does not return raw provider payloads, payment IDs, auth headers, full addresses, raw Hub payloads, proof/drop files, secrets, or stack traces.

## Eligibility rules

A row is eligible for a second exact controlled one-time pilot only when the preview can prove:

- Customer App Order exists.
- Order is paid/captured.
- Order is one-time and single-delivery/pickup compatible.
- Order is not cancelled/refunded.
- Line items are present.
- Delivery or pickup classification is clear.
- No open OrderReviewQueue blocker exists.
- No duplicate Customer App Order, native ShopifyOrder, or native FulfillmentTask conflict is detected.
- Native ShopifyOrder mirror exists.
- Native FulfillmentTask exists.
- Provider/payment calls, notifications, broad sync/repair/replay, inventory deduction, PurchaseOrder creation, and Hub mutation are not required.

Rows are not eligible if they are pending payment, subscription/multi-delivery, cancelled/refunded, missing line items, missing core order context, ambiguous delivery/pickup data, under review, duplicate/conflicting, missing a native mirror, missing a task, or require write/provider/sync/payment actions.

## Classifications

Candidate rows can be classified as:

- `eligible_next_one_time_order_candidate`
- `paid_but_native_mirror_missing`
- `paid_but_task_missing`
- `pending_payment_do_not_process`
- `needs_review`
- `duplicate_or_deduped`
- `unsupported_subscription_or_multi_delivery`
- `cancelled_or_refunded`
- `insufficient_data`
- `no_action_needed_already_native_complete`

If no row is eligible, the top-level next action remains to wait for the next natural paid one-time order or run an exact preview for a proposed order number.

Already completed native lifecycle examples, including the proven `NV-MPZNKGNT` path, must not be counted as eligible new pilot candidates in recent scans. They should return `no_action_needed_already_native_complete`.

## Candidate targets for first smoke

G33C should be run read-only for the two G33B summary-card candidates:

- `NV-MON367R7`
- `NV-MODIHVQQ`

Neither order is approved for live pilot by G33C itself. The function must return exact ids, missing data, blockers, and next safe action before any G33D approval packet is considered.

## Admin UI

`/admin/sync-health` includes a read-only panel titled **Eligible One-Time Order Native Workflow Preview**. The panel invokes `previewNativeOrderCutoverReadiness` with `preview_mode: ELIGIBLE_ONE_TIME_ORDER_NATIVE_WORKFLOW`. It supports:

- exact order preview by order number,
- recent candidate scan,
- candidate table with safe IDs,
- eligibility classification,
- blockers/warnings,
- next safe action,
- No Writes Performed status.

The panel intentionally has no Start Pilot, Create Mirror, Create Task, Sync/Repair, Notification, Provider, Payment, or write buttons.

## Validation expectations

Required checks before merge:

- `node --check` for changed function/script files.
- G33C harness.
- Relevant G31/G32 harnesses.
- Scoped ESLint.
- `npm run build`.
- `git diff --check`.
- `git diff --check origin/main...HEAD`.
- Changed-file scope check.
- Mutation/provider/action scan.
- Secret scan.
- Privacy/raw-payload scan.

## No-write verification

The function exposes a fixed `READ_ONLY_SAFETY` object with all write/provider/sync/payment/notification flags set to false. It uses only `list`, `filter`, and `get` entity reads. Harness tests assert that no writes occur and that downstream production/delivery previews are treated as not applicable until prerequisites exist rather than being invoked noisily.

## Next phase

After merge and publish, run boundary checks against `previewNativeOrderCutoverReadiness` and read-only G33C-mode previews for `NV-MON367R7` and `NV-MODIHVQQ`.

Possible next actions:

- G33D second exact controlled pilot for a clean candidate.
- Wait for the next natural paid one-time order.
- Patch native intake/mirror/task preview paths if candidates are blocked by missing native context.
- Hold.
