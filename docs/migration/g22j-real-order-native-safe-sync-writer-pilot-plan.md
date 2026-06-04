# Phase G22J: Real-order native safeSync writer pilot plan

## Purpose

Plan the first native `safeSync` writer pilot for one real order after the synthetic writer coverage in G22I.

This phase is planning only. It does not enable the native writer, does not select a real order for execution, does not send a request to `executeNativeSafeSyncOrderUpdate`, and does not mutate any live order.

## Current prerequisite state

| Prerequisite | Status |
| --- | --- |
| Native dry-run planner | Proven through synthetic fixtures and redacted samples. |
| Persistent parity logging | Proven with `SafeSyncParityLog` `6a20c197b5e7cc380a3321e0`. |
| Fake native create writer | Proven with synthetic order `NV-G22WTEST-20260604004452`. |
| Duplicate idempotency | Proven through `CommandLog`/`OrderSyncLog` idempotency checks. |
| Expanded fake writer coverage | Proven in G22I for update, reject/quarantine, lock guard, payment downgrade guard, and POS no-address. |
| Native writer for real orders | Not enabled and not yet approved. |

## Pilot objective

Run exactly one native writer pilot for one owner-approved real order while preserving Hub fallback.

The pilot should prove that a low-risk one-time order can be written or updated natively through `executeNativeSafeSyncOrderUpdate` with:

- safeSync guardrails applied
- native `OrderSyncLog` created
- native `CommandLog` created
- idempotent duplicate behavior
- no provider calls
- no customer notifications
- no production, fulfillment, inventory, purchase-order, compliance, refund, or broad sync side effects

## Candidate selection criteria

The first real-order candidate must satisfy all required criteria.

| Criterion | Required value |
| --- | --- |
| Order type | One-time Customer App/website order or one simple POS/event order. |
| Refund state | Not refunded, not partially refunded, not cancellation-related. |
| Subscription state | Not a subscription, subscription update, downgrade, cancel, or ghost duplicate. |
| Production state | Not `production_scheduled`, `in_production`, `out_for_delivery`, or `fulfilled` unless the pilot is read-only planning only. |
| Fulfillment state | Not delivered, not proof/drop, not unable-to-deliver. |
| Data quality | Complete enough for dry-run planner success, or intentionally chosen for a separately approved review-queue pilot. |
| Provider involvement | No Shopify API call, Stripe API call, provider mutation, webhook replay, or payment action required. |
| Notifications | No customer notification path should be triggered. |
| Exact identifier | Order id and order number must be known before gates open. |
| Hub fallback | Existing Hub bridge/fallback remains live. |

Recommended first candidate: a recent one-time Customer App order that already has a clean Customer App order record and an operational order number, but where the native pilot can use a no-provider payload derived from the app order data.

Do not use a refund, POS refund, subscription, repair/replay, production-scheduled order, or delivery status order for the first real pilot.

## Candidate discovery process

Candidate discovery must be read-only:

1. Query a small set of recent one-time Customer App or POS orders.
2. Collect only admin-safe context needed for eligibility:
   - order id
   - order number
   - source
   - payment status
   - order type
   - fulfillment method
   - production status
   - order lock status
   - whether an existing native `ShopifyOrder` exists
   - whether recent `OrderSyncLog`, `CommandLog`, `OrderReviewQueue`, or `SafeSyncParityLog` records exist
3. Exclude any order requiring provider calls, refunds, notifications, repair/replay, or production/fulfillment side effects.
4. Present one candidate with exact id/order number for explicit owner approval.

Candidate discovery may show limited admin-safe customer/order context, but it must not expose raw provider payloads, full addresses, auth headers, secrets, payment method details, or raw webhook bodies.

## Required preflight for selected candidate

Before execution, run a dry-run request to `previewNativeSafeSyncOrderUpdate` or an equivalent native writer dry-run using only the proposed payload.

Preflight must confirm:

- `success:true`
- no unexpected rejected fields
- no unexpected quarantine/reject result
- proposed write is create or update as intended
- expected `OrderSyncLog` draft is safe
- expected `OrderReviewQueue` draft is null unless the pilot is specifically a review-queue pilot
- no `FulfillmentTask`, `ProductionBatch`, inventory, purchase order, notification, provider, Stripe, Shopify, sync/repair/replay, refund, or compliance action is involved

If preflight does not match expectations, stop before live writer gates.

## Gate contract for execution

The pilot execution is not approved by this document. When explicitly approved later, use only these exact gates:

```text
ENABLE_NATIVE_SAFE_SYNC_WRITER=true
NATIVE_SAFE_SYNC_WRITER_KILL_SWITCH=false
NATIVE_SAFE_SYNC_WRITER_ALLOWED_SOURCES=<exact approved source>
NATIVE_SAFE_SYNC_WRITER_ALLOWED_EVENTS=<exact approved event>
NATIVE_SAFE_SYNC_WRITER_ORDER_ALLOWLIST=<exact approved order id/order number>
NATIVE_SAFE_SYNC_WRITER_SECRET=<temporary service secret>
```

Default closed state after the pilot:

```text
ENABLE_NATIVE_SAFE_SYNC_WRITER=false
NATIVE_SAFE_SYNC_WRITER_KILL_SWITCH=true
NATIVE_SAFE_SYNC_WRITER_ORDER_ALLOWLIST=disabled
NATIVE_SAFE_SYNC_WRITER_ALLOWED_SOURCES=disabled
NATIVE_SAFE_SYNC_WRITER_ALLOWED_EVENTS=disabled
NATIVE_SAFE_SYNC_WRITER_SECRET=disabled
```

Rules:

- exact order allowlist only
- no wildcard
- no broad source
- no broad event
- no sample-rate driven real writer access
- no persistent enabled window after the pilot
- close gates immediately after first call and duplicate idempotency call
- never print or commit the temporary writer secret

## Execution shape for later approval

If owner later approves the exact order, the pilot should run:

1. Snapshot selected order and related logs.
2. Run native writer live call once.
3. Run the same native writer live call again with the same idempotency key.
4. Close gates immediately.
5. Run closed-gate boundary check.
6. Snapshot selected order and related logs again.
7. Verify side effects.

Expected first-call result for a normal create/update pilot:

- `success:true`
- `writes_performed:true`
- `action:created` or `action:updated`
- native `ShopifyOrder` created/updated exactly once
- one `OrderSyncLog`
- one `CommandLog`
- no `OrderReviewQueue` unless expected
- no provider calls
- no notifications
- no Hub bridge modification

Expected duplicate result:

- `success:true`
- `skipped:true`
- `action:idempotent_skip`
- `writes_performed:false`
- no duplicate order mutation
- no duplicate success log

## Verification checklist

After any approved real pilot, verify:

- writer gates closed
- `ENABLE_NATIVE_SAFE_SYNC_WRITER=false`
- `NATIVE_SAFE_SYNC_WRITER_KILL_SWITCH=true`
- closed-gate live request skips safely
- exact expected `ShopifyOrder` create/update only
- exact expected `OrderSyncLog`
- exact expected `CommandLog`
- `OrderReviewQueue` count matches expectation
- no unexpected `SafeSyncParityLog`
- no `FulfillmentTask`
- no `ProductionBatch`
- no `Notification`
- no `CustomerMessageDeliveryLog`
- no inventory mutation
- no purchase order
- no Stripe call
- no Shopify API call
- no provider call
- no sync/retry/repair
- no refund/cancel cascade
- no production/fulfillment/compliance cascade

## Rollback / recovery

If the native writer returns unexpected output:

1. Close gates immediately.
2. Do not run repair/replay.
3. Do not issue refunds.
4. Do not call Stripe or Shopify.
5. Snapshot the affected order and audit logs read-only.
6. Classify the issue:
   - gate/config issue
   - dry-run planner mismatch
   - schema mismatch
   - idempotency issue
   - unexpected write
   - visibility/logging issue
7. Patch only after the issue is scoped.

If the pilot creates an unintended real-order native record but no customer/provider side effect, hold for owner decision before cleanup or correction.

## Hard stops

Stop before execution if:

- exact order id/order number is not approved
- the order is refund/cancel/payment-provider related
- the order is a subscription or subscription lifecycle event
- the order is production-scheduled, in production, delivered, or proof/drop related
- the payload requires raw provider data
- a Stripe/Shopify/provider call would be needed
- a customer notification could be sent
- broad sync/repair/replay would be needed
- inventory deduction or purchase-order creation would be involved
- the gate cannot be restricted to one exact order
- preflight dry-run differs from expected behavior
- Base44 publish/runtime state is ambiguous

## Recommendation

Proceed next to candidate discovery only:

1. Perform a read-only candidate scan.
2. Present one low-risk candidate with exact id/order number and expected payload.
3. Wait for explicit approval to run the real-order native writer pilot.

Do not execute a real-order writer pilot from this planning document alone.
