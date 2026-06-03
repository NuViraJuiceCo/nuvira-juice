# Phase G22A: Native safeSync writer

## Purpose

This phase adds the first reusable native Customer App `safeSync` writer endpoint:

`base44/functions/executeNativeSafeSyncOrderUpdate/entry.ts`

The function is intended to become the native replacement for the order-writing portion of the Customer App to Hub bridge after parity and cutover validation. It does not retire `syncOrderToHub` and does not make native writes primary.

## Default behavior

The writer is default-off.

Required live gate:

```text
ENABLE_NATIVE_SAFE_SYNC_WRITER=true
```

If this flag is absent or not exactly `true`, live mode returns a skipped response and performs no writes.

Additional gates:

```text
NATIVE_SAFE_SYNC_WRITER_KILL_SWITCH=false
NATIVE_SAFE_SYNC_WRITER_ALLOWED_SOURCES=<comma-separated safeSync source labels>
NATIVE_SAFE_SYNC_WRITER_ALLOWED_EVENTS=<comma-separated event types>
NATIVE_SAFE_SYNC_WRITER_ORDER_ALLOWLIST=<comma-separated exact order identifiers>
NATIVE_SAFE_SYNC_WRITER_SECRET=<service secret>
```

The order allowlist fails closed. An empty allowlist means no order is eligible for native write sampling.
The event allowlist also fails closed in live mode. If `NATIVE_SAFE_SYNC_WRITER_ALLOWED_EVENTS` is empty, no live event is eligible.

## Supported behavior

Dry-run mode:

- requires admin or service authentication
- invokes `previewNativeSafeSyncOrderUpdate`
- returns the proposed order state and safe draft logs
- performs no writes

Live mode:

- requires service authentication
- requires all feature gates to pass
- invokes `previewNativeSafeSyncOrderUpdate`
- writes a native `ShopifyOrder` create/update only when the safeSync plan allows it
- creates `OrderSyncLog` and `CommandLog` audit records
- creates or updates `OrderReviewQueue` only when the safeSync plan rejects/quarantines the update
- enforces idempotency through existing `CommandLog` / `OrderSyncLog` records

## Explicit non-goals

This phase does not:

- enable the native safeSync writer
- wire native writes into `syncOrderToHub`
- disable Hub bridge fallback
- process refunds as a migrated native cascade
- call Stripe
- call Shopify
- call providers
- send notifications
- create purchase orders
- deduct inventory
- run sync/retry/repair
- alter checkout/subscription/payment behavior
- change production, fulfillment, delivery, route, proof/drop, bag credit, or compliance behavior

## Cutover role

This endpoint is the native order-operation gateway that can be tested one order/source at a time. Future phases should use it to replace direct `ShopifyOrder.create/update` paths and eventually move `stripeWebhook`, Customer App order ingestion, and Shopify POS ingestion to native safeSync ownership.

Recommended next phases:

1. Audit PR and publish the default-off writer.
2. Boundary verify disabled live mode, dry-run mode, and unsupported method behavior.
3. Run one allowlisted synthetic live writer pilot against a fake/test order only.
4. Patch existing native direct writers to call this endpoint.
5. Move `syncOrderToHub` to fallback-only after native order ingestion parity is proven.
