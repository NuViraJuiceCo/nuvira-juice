# G27 Native order cutover readiness gate

## Purpose

G27 adds a read-only readiness gate for moving paid Customer App order operations toward native ownership while the Hub bridge remains fallback.

It answers:

- whether recent paid Customer App delivery orders have enough native operational context to be reviewed without hiding behind Hub rows
- whether an exact order is ready for a separately approved native pilot
- whether native writer/task gates are still guarded instead of broadly enabled
- what blockers or warnings remain before any Hub retirement step

## Implementation

### Backend

`base44/functions/previewNativeOrderCutoverReadiness/entry.ts`

- requires admin auth or the existing internal preview secret
- accepts `mode: "dry_run"` only
- can check either:
  - one exact order by Customer App order id, native ShopifyOrder id, or order number
  - a bounded recent set of paid Customer App delivery orders
- reads Customer App `Order`, native `ShopifyOrder`, and native `FulfillmentTask`
- invokes the existing `previewNativeSafeSyncLiveOrderParity` dry-run function to reuse the safe parity planner
- returns only sanitized summaries, readiness classifications, gate state, blockers, warnings, and safety booleans

### Admin UI

`src/pages/admin/SyncHealth.jsx`

Adds a "Native Cutover Readiness Gate" panel with:

- an optional exact order number input
- a single read-only check button
- aggregate readiness classification
- target order readiness cards
- native safeSync writer, May 30 native ops, and native task materialization gate summaries
- blocker/warning lists
- explicit dry-run/no-write safety language

No write/action controls are added.

## Readiness classifications

Target-level classifications:

- `pilot_ready_native_create_dry_run`
- `pilot_ready_native_update_or_dedupe_dry_run`
- `usable_with_hub_fallback`
- `blocked`
- `hold`

Aggregate classifications:

- `pilot_ready_with_exact_order_approval`
- `usable_with_hub_fallback_monitor_next_order`
- `hold_before_live_pilot`
- `review_required`

`pilot_ready_with_exact_order_approval` is not permission to run a live mutation. It means the read-only planner found at least one target that may be suitable for a separately approved exact-order pilot.

## Safety boundary

G27 does not:

- mutate Customer App `Order`
- mutate native `ShopifyOrder`
- mutate native `FulfillmentTask`
- backfill existing tasks
- enable broad native safeSync writer access
- disable or retire Hub bridge
- call Stripe, Shopify, providers, or notification services
- run sync, retry, repair, replay, refund, production, inventory, PO, route, proof, drop, or delivery commands
- change checkout/payment behavior
- create process/sync/repair/write buttons

Hub bridge remains fallback.

## How to use

1. Open `/admin/sync-health`.
2. Run the native cutover readiness check without an order number to inspect recent paid delivery orders.
3. Optionally enter one exact order number to inspect a known target.
4. Treat blockers as hold conditions.
5. Treat warnings as explicit migration follow-up items.
6. If the gate reports `pilot_ready_with_exact_order_approval`, approve one exact live pilot separately before any writer is run.

## Local regression harness

`node scripts/migration/run-g27-native-cutover-readiness-tests.mjs`

This in-memory harness verifies:

- lookup normalization for exact order/native order identifiers
- native task display metadata completeness detection
- target readiness classifications
- aggregate readiness classification
- gate summary handling without broad real-order mode

## Recommended next migration step

Use G27 to monitor the next natural paid Customer App delivery order. If it reports a clean exact target, approve one exact-order native pilot with:

- order number
- Customer App order id
- expected native order/task state
- allowed writer path
- idempotency key
- explicit no-provider/no-notification/no-production/inventory side-effect boundary unless separately approved

Do not retire Hub until native production, inventory/procurement, fulfillment command, notification, refund, and reconciliation ownership are independently validated.
