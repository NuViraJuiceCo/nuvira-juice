# Phase G22C: Shopify webhook native safeSync bridge

## Purpose

Begin moving Shopify webhook order writes toward the native Customer App safeSync writer without broad cutover.

This phase adds an exact-gated bridge from `shopifyWebhookReceiver` to `executeNativeSafeSyncOrderUpdate` for low-risk Shopify order create/update topics. The existing direct webhook write path remains fallback.

## New gate

```text
ENABLE_SHOPIFY_WEBHOOK_NATIVE_SAFE_SYNC_WRITER=true
SHOPIFY_WEBHOOK_NATIVE_SAFE_SYNC_TOPICS=orders/create,orders/paid
SHOPIFY_WEBHOOK_NATIVE_SAFE_SYNC_ORDER_ALLOWLIST=<exact order id/order number/shopify id>
```

The bridge also depends on the existing native writer gates:

```text
ENABLE_NATIVE_SAFE_SYNC_WRITER=true
NATIVE_SAFE_SYNC_WRITER_KILL_SWITCH=false
NATIVE_SAFE_SYNC_WRITER_ALLOWED_SOURCES=admin,customer_app
NATIVE_SAFE_SYNC_WRITER_ALLOWED_EVENTS=shopify.webhook.orders_create,shopify.webhook.orders_paid
NATIVE_SAFE_SYNC_WRITER_ORDER_ALLOWLIST=<same exact order identifier>
NATIVE_SAFE_SYNC_WRITER_SECRET=<service secret>
```

If any gate is missing or does not match, the bridge fails closed and the existing Shopify webhook behavior continues.

## Supported topics

The default bridge topic list is intentionally narrow:

- `orders/create`
- `orders/paid`

`orders/updated` can be included only by explicitly adding it to both topic/event allowlists:

- `SHOPIFY_WEBHOOK_NATIVE_SAFE_SYNC_TOPICS=orders/create,orders/paid,orders/updated`
- `NATIVE_SAFE_SYNC_WRITER_ALLOWED_EVENTS=shopify.webhook.orders_create,shopify.webhook.orders_paid,shopify.webhook.orders_updated`

Refund, cancellation, and fulfillment topics are not enabled by default and should remain out of scope until their native cascades are separately audited.

## Behavior

When disabled:

- no native writer call is made
- existing Shopify webhook processing is unchanged

When enabled and exact-allowlisted:

- `shopifyWebhookReceiver` maps the Shopify payload to a native operational order shape
- raw Shopify payload is stripped before calling `executeNativeSafeSyncOrderUpdate`
- POS records use the same conservative planner source strategy as `processMay30NativeOrderOps`
- the native writer can create/update the native `ShopifyOrder` and its own audit logs
- if native writer handles the event, the direct webhook order write is skipped to avoid duplicate writes
- if native writer skips, rejects, errors, or is not allowlisted, the existing direct webhook path remains fallback

## Safety boundaries

This phase does not:

- enable the bridge or native writer by default
- broaden sampling beyond exact order allowlists
- alter Shopify webhook HMAC verification
- call Shopify APIs
- call Stripe
- send customer notifications
- change order mutation payloads outside exact-gated native writer attempts
- change refund/cancel/fulfillment behavior
- deduct inventory
- create purchase orders
- change production/compliance records
- disable Hub bridge/fallback
- persist raw Shopify payloads through the native writer

## Next step

After publish, run a disabled-boundary check first. A live pilot should use one exact safe order and close all gates immediately after the result is captured.
