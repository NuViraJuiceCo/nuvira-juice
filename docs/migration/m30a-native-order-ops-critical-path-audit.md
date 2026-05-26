# M30A Native Order Operations Critical Path Audit

Date: 2026-05-26

## Goal

May 30 launch readiness is operational parity, not full Hub retirement. Future one-time Customer App / website orders and Shopify POS event orders must become operationally processable in the Customer App backend/admin while the Hub remains available as bridge and fallback.

## Current State

### One-time Customer App / website orders

- `stripeWebhook` captures paid checkout sessions, creates a Customer App `Order`, and calls `syncOrderToHub`.
- `syncOrderToHub` validates paid status and delivery schedule, then sends `order.created` to Hub `receiveCustomerAppEvent`.
- Hub `receiveCustomerAppEvent` routes through Hub `safeSyncOrderUpdate` and downstream operational generation.
- Before M30A, the Customer App did not create a native `ShopifyOrder` operational mirror for these future paid one-time orders.

### Shopify POS event orders

- Hub `shopifyOrderWebhook` and `ingestShopifyPOSOrder` classify POS/event orders as `source_channel=pos`, `source_type=shopify_pos`, `fulfillment_method=pos`, `production_status=not_required`, `fulfillment_status=fulfilled`, and no delivery/production task requirement.
- Customer App POS admin visibility is currently Hub-backed through `getAdminPOSOrdersSummary`.
- Before M30A, Customer App `ShopifyOrder.production_status` did not include `not_required`, so native POS parity required a schema enum extension.

### Production / ingredient / procurement

- Customer App production planning and ingredient/procurement visibility are Hub-backed through `getAdminProductionPlanningSummary`.
- Customer App has `Product` and `SubscriptionBundle`, but no native `Recipe`, `Bundle`, `IngredientYield`, or inventory-yield model sufficient to replace Hub Recipe/Bundle calculations before May 30.
- Make-to-order policy remains: stock shortfall is procurement need, not a preview blocker; inventory deduction and purchase orders remain deferred.

### Compliance and fulfillment

- Existing production, compliance, fulfillment, driver, out-for-delivery, and delivered operational paths remain Hub-backed or wrapper-backed.
- Customer-facing non-confirmation notifications remain disabled.
- Hub bridge paths remain live.

## P0 Gap

The P0 May 30 gap was lack of a native Customer App operational order mirror for future launch-order types. Without it, Customer App admin relies entirely on Hub records for operational order visibility.

## Chosen Implementation

Option B-lite: native Customer App operational mirror with Hub fallback.

- Add default-off native May 30 order ops function.
- Wire `syncOrderToHub` to invoke the native mirror only when `ENABLE_MAY30_NATIVE_ORDER_OPS=true`.
- Preserve Hub bridge behavior regardless of native mirror success/failure.
- Do not enable native safeSync writer.
- Do not disable Hub bridge.

## Implemented Scope

### `processMay30NativeOrderOps`

Default-off function for May 30 launch order types:

- `customer_app_one_time`
- `website_one_time`
- `shopify_pos`

The function can:

- validate source, paid status, line items, and delivery address rules
- run native safeSync dry-run planner before writes
- create/update native Customer App `ShopifyOrder`
- create native `OrderSyncLog`
- create native `OrderReviewQueue` for rejected/bad orders
- create safe native `CommandLog`
- return fulfillment, production demand, and ingredient/procurement summaries

The function does not:

- call Stripe, Shopify, or providers
- send notifications
- deduct inventory
- create purchase orders
- run sync/retry/repair
- mutate Customer App `Order`
- create production/compliance records
- replace Hub bridge processing

### `syncOrderToHub`

Adds a guarded call to `processMay30NativeOrderOps` before Hub push. If disabled, there is no behavior change. If enabled and native mirror fails, the Hub bridge continues unchanged.

### Schema

Adds `not_required` to Customer App `ShopifyOrder.production_status` so POS/event orders can be represented without false production demand.

## Remaining Hub Fallback Through May 30

Keep live:

- `stripeWebhook`
- `syncOrderToHub`
- Hub `receiveCustomerAppEvent`
- Hub `safeSyncOrderUpdate`
- Hub official Shopify POS webhook
- Hub production planning / recalculation
- Hub compliance and fulfillment operational paths
- Hub-backed Customer App admin summaries for POS and production planning

## Watch Items

- Native detailed Recipe/Bundle/IngredientYield procurement calculation is not complete in Customer App. Use Hub-backed production planning summary for May 30.
- POS native mirror exists as a function path, but official Shopify POS webhook still enters Hub first. A later narrow PR can forward or mirror POS payloads to Customer App if needed.
- FulfillmentTask creation remains Hub-backed for May 30; native mirror records fulfillment need and fulfillments summary, not separate native FulfillmentTask creation.

## May 30 Go/No-Go

Status: launch ready with watch items after PR merge/publish and boundary verification.

Blockers:

- none in this PR scope

Required before event day:

- publish this PR after audit
- verify disabled state does not alter `syncOrderToHub`
- enable `ENABLE_MAY30_NATIVE_ORDER_OPS=true` only after one synthetic/controlled order smoke
- keep Hub bridge enabled as fallback
