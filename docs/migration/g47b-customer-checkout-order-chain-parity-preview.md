# G47B — Customer checkout order-chain parity preview

## 1. Executive summary

G47B adds an admin-authenticated, read-only preview to evaluate checkout/order-chain parity without changing customer checkout, payment, order creation, Hub writes, notifications, loyalty, or repair/replay behavior.

Preview mode:

```text
CUSTOMER_CHECKOUT_ORDER_CHAIN_PARITY
```

Supported modes:

```text
EXACT_CHECKOUT_ORDER_CHAIN_PARITY
BOUNDED_CHECKOUT_ORDER_CHAIN_SCAN
```

The preview determines whether paid/captured checkout orders have a complete and internally consistent chain:

```text
Stripe-linked payment state
→ Customer App Order
→ native ShopifyOrder
→ native FulfillmentTask
→ customer confirmation/history/tracker visibility
→ Hub sync context
```

Current carry-forward classification from G47A remains:

```text
checkout_order_creation_native_partial_hub_write_required
```

G47B is not a checkout cutover. It is evidence collection only.

## 2. Current checkout transaction map

| Step | Current authority/path | G47B read evidence | G47B does not do |
| --- | --- | --- | --- |
| Cart/checkout form | Customer UI and Customer App profile/order inputs | none directly beyond stored Customer App `Order` outcome | no cart or UI mutation |
| Payment initialization | `createPaymentIntent` creates Stripe PaymentIntent and pending Customer App `Order` | payment linkage presence booleans only | no PaymentIntent or Checkout Session creation |
| Payment completion | Stripe webhook promotes paid/captured state | `payment_status`, `financial_status`, `payment_captured`, and linkage presence | no Stripe call and no payment mutation |
| Customer App Order | Canonical customer order identity | exact Customer App `Order` match count, status, payment readiness, order number | no Order create/update/delete |
| Native ShopifyOrder | Candidate operational native order | exact linkage count through Customer App id/order number | no Shopify call and no native order write |
| FulfillmentTask | Candidate operational task context | exact compatible task count | no task write or lifecycle command |
| Hub sync | Active operational bridge | safe `OrderSyncLog` context and status category | no Hub call, no sync/retry/replay, no suppression |
| Confirmation/history/tracker | Customer App order canonical with limited native enrichment elsewhere | canonical order-number consistency and readiness booleans | no customer response or UI change |
| Notifications/loyalty | Webhook-triggered existing behavior | safety flags only | no notification, message log, loyalty, or credit mutation |
| Apple Pay | Stripe Express Checkout integration exists | static diagnostic flags only | no Stripe config/domain registration or live transaction |

## 3. Stripe/native/Hub source-of-truth rules

G47B preserves these rules in every response:

- `stripe_payment_source_of_truth:true`
- `customer_app_order_canonical:true`
- `hub_write_suppression_ready:false`
- `payment_mutation_ready:false`
- `refund_mutation_ready:false`
- `notification_expansion_ready:false`
- `repair_replay_ready:false`

Rules:

1. Stripe remains authoritative for payment authorization, capture, and refund state.
2. Customer App `Order` remains canonical for customer-facing order identity, order number, chronology, totals, line items, and confirmation.
3. Native `ShopifyOrder` can be considered operationally useful only when exact Customer App linkage exists.
4. Native `FulfillmentTask` can be considered operationally useful only when exactly one compatible task exists.
5. Hub writes remain active until native writes and all customer/admin reads are proven.
6. Failed or delayed Hub sync must not hide a paid Customer App `Order` from confirmation/history/tracker.
7. Native production/delivery state must not override Stripe payment authority.
8. Hub write suppression is not approved by G47B.

## 4. Exact chain parity contract

Request shape:

```json
{
  "preview_mode": "CUSTOMER_CHECKOUT_ORDER_CHAIN_PARITY",
  "mode": "EXACT_CHECKOUT_ORDER_CHAIN_PARITY",
  "order_number": "<exact order number>",
  "customer_app_order_id": "<exact Customer App Order id>",
  "request_id": "g47b_exact_checkout_order_chain_<timestamp>"
}
```

Exact mode uses only exact identifiers:

- Customer App `Order.id`
- Customer App `Order.order_number`
- Native `ShopifyOrder.base44_order_id`
- Native `ShopifyOrder.customer_app_order_id`
- Native `ShopifyOrder.order_number` / `shopify_order_number`
- `FulfillmentTask.order_id`
- `FulfillmentTask.base44_order_id`
- `FulfillmentTask.customer_app_order_id`
- `FulfillmentTask.native_shopify_order_id`
- `FulfillmentTask.shopify_order_id`
- `FulfillmentTask.order_number` / `shopify_order_number`

It does not resolve through:

- customer name
- partial email
- phone
- approximate total
- approximate creation date
- newest record selection

Exact response reports safe booleans/counts only, including:

- exact Customer App `Order` match count
- payment linkage presence
- payment captured/readiness status
- native ShopifyOrder match count
- compatible FulfillmentTask count
- Hub sync context category
- confirmation/history/tracker readiness booleans
- duplicate risk flags
- blockers/warnings/classification

The exact response does not return raw payment/provider identifiers, customer email, customer name, phone, full address, payment method details, raw Hub/Stripe/Shopify payloads, webhook bodies, line items, or full records.

## 5. Bounded scan strategy

Request shape:

```json
{
  "preview_mode": "CUSTOMER_CHECKOUT_ORDER_CHAIN_PARITY",
  "mode": "BOUNDED_CHECKOUT_ORDER_CHAIN_SCAN",
  "order_limit": 100,
  "related_entity_limit": 100,
  "request_id": "g47b_bounded_checkout_order_chain_<timestamp>"
}
```

The bounded scan reads each broad source once and joins in memory:

| Source | Read strategy |
| --- | --- |
| Customer App `Order` | one bounded list |
| Native `ShopifyOrder` | one bounded list |
| Native `FulfillmentTask` | one bounded list |
| `OrderSyncLog` | one bounded list |
| `SafeSyncParityLog` | one bounded list |
| `OrderReviewQueue` | one bounded list |

No per-order query loop is used in bounded mode.

Aggregate counts include:

- `unique_customer_order_count`
- `paid_captured_order_count`
- `pending_payment_order_count`
- `refunded_cancelled_count`
- `native_shopify_order_present_count`
- `native_fulfillment_task_present_count`
- `native_chain_complete_count`
- `hub_sync_success_count`
- `hub_sync_pending_count`
- `hub_sync_failed_count`
- `confirmation_native_ready_count`
- `history_ready_count`
- `tracker_ready_count`
- `payment_order_mismatch_count`
- `duplicate_order_risk_count`
- `duplicate_native_order_risk_count`
- `duplicate_task_risk_count`
- `repair_replay_hold_count`
- `review_required_count`
- `hub_write_shadow_candidate_count`
- `fallback_required_count`
- `classification_counts`

If `OrderSyncLog`, `SafeSyncParityLog`, or another required source is truncated, G47B reports source truncation and exact follow-up required. It does not claim fleet-wide Hub parity from truncated log coverage.

## 6. Duplicate/idempotency risk coverage

G47B explicitly classifies these cases:

| Risk | G47B evidence |
| --- | --- |
| Duplicate Customer App order | exact Customer App match count and duplicate-order classification |
| Pending-payment customer order | pending-payment classification without mutation |
| Payment/order mismatch | payment fields compared for consistency |
| Native ShopifyOrder missing | native match count and missing classification |
| Duplicate native ShopifyOrder | duplicate native order risk classification |
| FulfillmentTask missing | compatible task count and missing-task classification |
| Duplicate/conflicting task | duplicate task risk classification |
| Hub sync pending/failed | `OrderSyncLog` status category |
| Repair/replay ambiguity | `OrderSyncLog` / `SafeSyncParityLog` hold classification |
| Review queue hold | `OrderReviewQueue` blocker classification |
| Refund/cancel hold | refund/payment and cancellation source-of-truth hold |
| Historical late mirror | not accepted as proof of native-born checkout authority |

## 7. Customer confirmation/history/tracker rules

G47B preserves these customer-surface rules:

- Customer App `Order` is canonical for confirmation identity.
- The canonical order number must be consistent across confirmation/history/tracker.
- Confirmation can be considered ready only from Customer App `Order` evidence, not Hub success.
- Order history remains governed by current G43B limited-native-first behavior.
- OrderTracker remains governed by current G43C limited-native-first behavior.
- G47B does not alter G43B/G43C gates or allowlists.
- `NV-MPZNKGNT` is not added to G43C without its owning-customer smoke.
- No customer-visible diagnostics, source-of-truth labels, raw payloads, or internal ids are exposed by G47B.

## 8. Hub write necessity

G47B keeps Hub active.

Classifications include:

- `hub_checkout_write_required`
- `hub_write_shadow_candidate`
- `hub_write_suppression_not_ready`

A native chain can be a future shadow candidate only when:

- exactly one Customer App `Order` exists
- Stripe-linked payment state is paid/captured
- Customer App payment fields agree
- exactly one native `ShopifyOrder` exists
- native payment fields agree
- exactly one compatible `FulfillmentTask` exists when operational context is required
- no duplicate identity risk exists
- no review/repair/replay hold exists
- confirmation/history/tracker can use the canonical Customer App order
- Hub sync delay/failure does not hide the paid order

Even then, G47B does not approve Hub write suppression.

## 9. Apple Pay diagnostics

G47B returns read-only Apple Pay diagnostic flags only:

- `express_checkout_code_present:true`
- `apple_pay_button_integration_present:true`
- `apple_pay_domain_registration_required:true`
- `apple_pay_domain_registration_status_known:false`
- `safari_ios_validation_required:true`
- `apple_pay_live_device_test_completed:false`
- `apple_pay_patch_ready:false`

G47B does not:

- register an Apple Pay domain
- create Payment Requests
- change Stripe configuration
- modify checkout UI
- run a live transaction

Apple Pay remains a separate G47F path.

## 10. Response safety

Every G47B response includes:

```text
success
dry_run:true
writes_performed:false
preview_mode
mode
scan_complete
blockers
warnings
pii_returned:false
raw_payloads_returned:false
provider_call_impact:false
stripe_calls:false
shopify_calls:false
hub_calls:false
notifications_sent:false
hub_mutation_performed:false
payment_mutation_performed:false
order_mutation_performed:false
native_order_mutation_performed:false
fulfillment_task_mutation_performed:false
reward_points_mutated:false
command_log_created:false
```

G47B returns safe operational summaries only. It does not return customer names, emails, phones, full addresses, payment methods, full Stripe identifiers, full Shopify identifiers, raw provider payloads, raw webhook bodies, line items, or full entity rows.

## 11. Write hard stops

G47B must not:

- create a PaymentIntent
- create a Checkout Session
- submit checkout
- create or update Customer App `Order`
- create or update native `ShopifyOrder`
- create or update native `FulfillmentTask`
- capture payment
- refund payment
- call Stripe
- call Shopify
- call Hub
- call delivery/provider APIs
- send notifications
- grant or reverse loyalty points/credits
- create logs/queues
- run sync/repair/replay
- suppress Hub writes
- change order confirmation behavior
- change Apple Pay behavior
- publish during PR prep

## 12. Test coverage

Harness:

```text
scripts/migration/run-g47b-customer-checkout-order-chain-parity-tests.mjs
```

Coverage includes:

1. Missing admin auth returns 401.
2. Exact Customer App `Order` resolves.
3. Duplicate Customer App `Order` blocks readiness.
4. Pending-payment order classified safely.
5. Paid/captured order classified safely.
6. Payment/order mismatch reported.
7. Exact native `ShopifyOrder` resolves.
8. Duplicate native `ShopifyOrder` blocks readiness.
9. Exact `FulfillmentTask` resolves.
10. Duplicate/conflicting task blocks readiness.
11. Customer-order-only/native-order-missing classification.
12. Native order present/task missing classification.
13. Complete native chain classification.
14. Hub sync success classification.
15. Hub sync pending classification.
16. Hub sync failure does not hide paid order.
17. Repair/replay evidence holds.
18. Review queue holds.
19. Refund remains Stripe/payment source-of-truth.
20. Cancelled order held.
21. Order confirmation uses canonical Customer App order.
22. History and tracker canonical order number agree.
23. Historical late mirror does not prove native-born checkout.
24. Bounded scan uses one read per source.
25. Truncated log coverage requires exact follow-up.
26. No PII returned.
27. No raw payloads returned.
28. No PaymentIntent/session creation.
29. No payment mutation.
30. No Order creation/update.
31. No ShopifyOrder creation/update.
32. No FulfillmentTask creation/update.
33. No Stripe/Shopify/Hub/provider calls.
34. No notifications.
35. No loyalty/credit mutation.
36. No logs/queues created.

## 13. Recommendation

After merge, publish only:

```text
previewNativeOrderCutoverReadiness
```

Then run:

1. Boundary verification.
2. One exact preview for `NV-MQHJR3V2`.
3. One bounded scan.
4. Exact follow-up only for provisional anomalies or candidates.
5. No-write verification.

Do not suppress Hub writes, change checkout, alter payment behavior, alter notifications, or change Apple Pay in G47B.

Proceed toward G47C/G47D planning only when paid/captured Customer App Orders consistently show complete native chains, confirmation/history/tracker do not depend on immediate Hub success, duplicate/idempotency risks are controlled, repair/replay state is understood, Stripe remains payment authority, and Hub suppression remains separately gated/default-off.
