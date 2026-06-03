# Phase G22B: Direct ShopifyOrder writer consolidation

## Purpose

Move the Customer App toward native order-operation ownership by eliminating unaudited `ShopifyOrder` writes first, then replacing direct writers with `executeNativeSafeSyncOrderUpdate` only where parity and gates are ready.

## Current direct writer map

| Path | Current role | Risk | G22B classification |
| --- | --- | --- | --- |
| `executeNativeSafeSyncOrderUpdate` | Default-off native safeSync writer gateway. | Low when disabled/exact-gated. | Target writer. |
| `processMay30NativeOrderOps` | May 30 native operational mirror for one-time/POS order types. | Medium because it writes `ShopifyOrder`, `OrderSyncLog`, `OrderReviewQueue`, `CommandLog`, and `FulfillmentTask` under its own gates. | Keep temporarily; later route order record writes through native safeSync gateway. |
| `shopifyWebhookReceiver` | Live Shopify webhook receiver for POS/order events and product sync. | High because order topics directly create/update `ShopifyOrder`. | Patched first to emit sanitized `OrderSyncLog` for every direct order write. |
| `shopifyPollFallback` | Disabled Shopify poll fallback. | Low while disabled; high if re-enabled because it writes directly. | Keep disabled; future patch should route through native safeSync before enabling. |
| `shopifyResyncOrders` | Admin manual Shopify import/resync, mostly disabled/exact-gated. | Medium when exact import enabled. | Exact import already uses `processMay30NativeOrderOps`; broad direct resync remains disabled. |
| Exact repair/correction functions | Owner/admin targeted corrections. | Medium, but narrow and command-gated. | Keep gated; migrate case by case after order ingestion is stable. |

## G22B patch

`shopifyWebhookReceiver` now creates a sanitized `OrderSyncLog` after direct `ShopifyOrder` writes for order topics:

- `orders/create`
- `orders/paid`
- `orders/updated`
- `orders/cancelled`
- `orders/refunded`
- `orders/fulfilled`

The log stores only safe audit context:

- order number
- native `ShopifyOrder` id
- Shopify order id
- topic
- action
- status
- safe reason
- updated field names
- idempotency/request/correlation keys

The log does not store:

- raw Shopify payload
- payment or provider details
- auth headers
- secrets
- full address
- phone number
- stack traces
- proof/drop evidence

## Non-goals

This phase does not:

- enable native safeSync writer
- alter Shopify webhook HMAC verification
- call Shopify or Stripe beyond existing webhook handling
- change payment/provider behavior
- change order mutation payloads
- disable Hub bridge/fallback
- send customer notifications
- run sync/retry/repair
- deduct inventory
- create purchase orders
- change production/compliance records

## Next migration step

After this patch is published and verified, the next safe step is to route one exact, low-risk Shopify webhook order source through `executeNativeSafeSyncOrderUpdate` under the existing native writer gates, with the current direct write path retained as fallback until parity is proven.
