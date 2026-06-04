# Phase G22H: Native safeSync writer pilot readiness

## Purpose

Resume the post-May-30 Hub retirement migration from the current native `safeSync` state and define the next approval gates before any real-order writer pilot.

This phase is documentation and readiness only. It does not enable the native writer, does not run another writer sample, and does not mutate live business records.

## Current proven state

| Area | Status | Evidence |
| --- | --- | --- |
| Native dry-run planner | Proven on synthetic and redacted samples | `previewNativeSafeSyncOrderUpdate`; fixture and sample runners previously passed. |
| Runtime dark launch | Proven default-off and exact-gated | `syncOrderToHub` supports source/event/order allowlist, kill switch, sample rate, debug return, and logging mode gates. |
| Persistent parity logging | Proven | One exact-order dark-launch sample created `SafeSyncParityLog` `6a20c197b5e7cc380a3321e0` with no native order write. |
| Native writer endpoint | Published and default-off | `executeNativeSafeSyncOrderUpdate`; requires service auth, enabled flag, kill switch false, allowed source/event, and exact order allowlist. |
| Fake native create pilot | Proven after schema fix | Synthetic order `NV-G22WTEST-20260604004452` created one `ShopifyOrder`, one `OrderSyncLog`, and one `CommandLog`. |
| Writer idempotency | Proven for duplicate create request | Duplicate request returned `idempotent_skip` using existing `CommandLog`; no duplicate order write. |
| Native writer real-order use | Not approved | Native writer remains disabled for real orders. |

## G22G outcome carried forward

The first fake native writer pilot exposed a schema gap: `ShopifyOrder.shopify_order_id` was required even though native Customer App operational orders may not have a Shopify provider id at creation time.

PR #323 made `shopify_order_id` optional while keeping `shopify_order_number` required. After publish, the fake writer pilot succeeded.

## Current writer safety contract

Live writer mode remains fail-closed unless all are true:

```text
ENABLE_NATIVE_SAFE_SYNC_WRITER=true
NATIVE_SAFE_SYNC_WRITER_KILL_SWITCH=false
NATIVE_SAFE_SYNC_WRITER_ALLOWED_SOURCES=<exact approved source>
NATIVE_SAFE_SYNC_WRITER_ALLOWED_EVENTS=<exact approved event>
NATIVE_SAFE_SYNC_WRITER_ORDER_ALLOWLIST=<exact approved order identifier>
NATIVE_SAFE_SYNC_WRITER_SECRET=<service secret>
```

Default closed state:

```text
ENABLE_NATIVE_SAFE_SYNC_WRITER=false
NATIVE_SAFE_SYNC_WRITER_KILL_SWITCH=true
NATIVE_SAFE_SYNC_WRITER_ORDER_ALLOWLIST=disabled
NATIVE_SAFE_SYNC_WRITER_ALLOWED_SOURCES=disabled
NATIVE_SAFE_SYNC_WRITER_ALLOWED_EVENTS=disabled
NATIVE_SAFE_SYNC_WRITER_SECRET=disabled
```

No broad source, event, or sample-rate based native writer enablement is allowed.

## What is still unproven

Before a real-order writer pilot, these native writer behaviors still need explicit controlled proof:

| Behavior | Why it matters | Recommended proof |
| --- | --- | --- |
| Update of an existing native `ShopifyOrder` | Real ingestion will need safe updates, not just creates. | Fake order update using the synthetic order from G22G or a new synthetic order. |
| Rejected/quarantined payload | Bad payloads must create or update `OrderReviewQueue` without corrupting orders. | Fake incomplete delivery order or low-quality payload through exact writer gates. |
| Lock/frozen-field rejection in live writer mode | Native writer must preserve `LOCK_FROZEN_FIELDS`. | Fake existing order with `order_lock_status=production_scheduled`, then attempted line-item/address overwrite. |
| Payment downgrade guard in live writer mode | Paid orders cannot be downgraded by non-approved sources. | Fake paid order update attempting `payment_status=pending`. |
| POS no-address bypass in live writer mode | POS/event orders must not be blocked for delivery address. | Fake POS order create with no delivery address and source/event exactly allowed. |
| Real bridge/native comparison for non-dedupe outcome | The persistent parity proof used a Hub dedupe result. | One future exact real order where Hub write plan/outcome is not only dedupe, after approval. |

## Recommended next phases

### G22I - Expanded fake writer coverage

Goal: prove update, reject/quarantine, payment guard, lock guard, and POS no-address behavior using synthetic records only.

Allowed after explicit approval:

- exact synthetic order allowlist only
- `customer_app` and/or `admin` source only as needed by the fixture
- no real customer orders
- no provider calls
- no notifications
- no Hub bridge changes
- close gates immediately after each sub-test

Expected writes:

- synthetic `ShopifyOrder` creates/updates
- synthetic `OrderSyncLog`
- synthetic `CommandLog`
- synthetic `OrderReviewQueue` only for reject/quarantine tests

Expected non-writes:

- no `FulfillmentTask`
- no `ProductionBatch`
- no inventory deduction
- no purchase orders
- no customer-facing notification or delivery log
- no Stripe, Shopify, or provider calls

### G22J - One real-order writer pilot plan

Goal: design a single real-order native writer pilot after fake update/reject coverage is proven.

Required before execution:

- exact order candidate selected read-only
- order is low-risk and non-refund
- no subscription downgrade/cancel
- no production-scheduled/in-production mutation
- Hub bridge fallback remains live
- persistent parity logging available
- explicit owner approval for the exact order id/order number

The first real pilot should not be broad webhook cutover. It should be one exact order, one source, one event, and immediate gate shutdown.

### G22K - Native order ingestion ownership bridge

Goal: route one approved Customer App one-time order create/update through native safeSync while preserving Hub fallback.

This phase should only start after G22J has a clean result.

## Required verification after every writer pilot

For each pilot, verify:

- gates closed afterward
- native writer disabled
- exact expected `ShopifyOrder` count
- exact expected `OrderSyncLog` count
- exact expected `CommandLog` count
- `OrderReviewQueue` count matches expected reject/quarantine behavior
- no unexpected `SafeSyncParityLog`
- no unexpected `FulfillmentTask`
- no unexpected `ProductionBatch`
- no `Notification`
- no `CustomerMessageDeliveryLog`
- no inventory or purchase-order records
- no provider/Stripe/Shopify calls

## Hard stops

Stop before implementation if the next step requires:

- enabling native writer for a real order without explicit exact-order approval
- refunds or payment/provider mutation
- Shopify API mutation calls
- customer notification expansion
- broad sync/repair/replay
- inventory deduction or purchase-order creation
- production verification/compliance cascade
- destructive cleanup of synthetic records
- unclear business decision about POS, subscriptions, or refund handling

## Current recommendation

Proceed to G22I only with explicit approval for synthetic writer mutations. Do not move to a real-order native writer pilot until expanded fake coverage proves update, reject/quarantine, lock, payment, and POS behavior.
