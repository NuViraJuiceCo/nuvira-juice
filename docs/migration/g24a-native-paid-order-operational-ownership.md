# G24A: Native Paid Order Operational Record Ownership

## Current Incident Result

Order `NV-MPZNKGNT` recovered after the Customer App Stripe secrets were added and the Stripe event was resent.

Safe read-only verification after resend:

| Area | Result |
| --- | --- |
| Customer App Order | `scheduled_for_juicing`, `payment_status=paid`, `payment_captured=true` |
| Line items | 4 items present |
| Address | Complete |
| Confirmation | Email sent; SMS log failed because no SMS recipient was present |
| Hub bridge | `OrderSyncLog` shows Hub `created`, followed by `dedupe_exact_match` |
| Native `ShopifyOrder` | Present: `6a22ffda400eb806eb3ca945` |
| Native `FulfillmentTask` | Present: `6a22ffdaf675ea79e30575aa` |
| Review queue | None |

The initial "no native ShopifyOrder / no FulfillmentTask" finding was caused by querying the wrong field. Native operational orders use `ShopifyOrder.shopify_order_number`, not `order_number`.

## Source Path

The paid-order path is:

1. Customer App embedded checkout pre-creates a pending `Order`.
2. Stripe sends `payment_intent.succeeded`.
3. `stripeWebhook` promotes the `Order` to paid/scheduled.
4. `stripeWebhook` invokes `syncOrderToHub`.
5. `syncOrderToHub` optionally invokes `processMay30NativeOrderOps` when `ENABLE_MAY30_NATIVE_ORDER_OPS=true`.
6. `processMay30NativeOrderOps` creates/updates native `ShopifyOrder`, native audit logs, and a native delivery `FulfillmentTask` for delivery orders.
7. `syncOrderToHub` still sends the order to Hub, which remains fallback/source for downstream parity until cutover.

## Existing Native Ownership State

The Customer App already has the core Option A/B native ownership foundation for this order type:

- Native operational `ShopifyOrder` mirror exists for a paid one-time Customer App order.
- Native `OrderSyncLog` and `CommandLog` audit records are written by the mirror path.
- Native `OrderReviewQueue` is used for invalid/incomplete orders.
- Native delivery `FulfillmentTask` is created for delivery orders.
- Production and ingredient/procurement visibility reads native `ShopifyOrder` demand, while detailed production/procurement execution remains Hub-backed.
- Hub bridge remains live and is not retired.

## Gap Analysis

| Gap | Status | Risk |
| --- | --- | --- |
| Native order creation | Working for `NV-MPZNKGNT` | Low |
| Native delivery task creation | Working, but task was missing redundant order-number fields | Medium visibility risk |
| Production planning visibility | Reads native `ShopifyOrder` demand | Low/medium; execution still Hub-backed |
| Ingredient/procurement visibility | Native preview exists, with Hub-backed detailed planning | Medium |
| Hub fallback | Working | Required until native execution parity is complete |
| Privacy in sync logs | Existing `syncOrderToHub` descriptions included raw address/customer details | Medium privacy hardening |

## G24A Patch Scope

This phase hardens the existing path instead of adding a duplicate writer:

1. `processMay30NativeOrderOps`
   - Read `ENABLE_MAY30_NATIVE_ORDER_OPS` and service secret per request.
   - Add `shopify_order_id`, `shopify_order_number`, `order_number`, customer/source/status/schedule fields, address fields, and `items_summary` to native `FulfillmentTask` drafts.
   - Preserve existing feature gate and Hub fallback behavior.

2. `syncOrderToHub`
   - Replace future raw PII-heavy `OrderSyncLog.description` payload summaries with safe status/count/presence summaries.
   - Preserve Hub bridge behavior and response handling.

No live pilot was run in G24A. No existing logs were retroactively modified.

## Current Recommendation

Close G24A after this narrow hardening PR. The next migration phase should focus on native production/ingredient execution parity from the already-created native `ShopifyOrder`, while Hub remains fallback.

Do not retire Hub bridge for paid Customer App orders yet.
