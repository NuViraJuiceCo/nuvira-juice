# G43A: Customer order history and order tracker native parity preview

## 1. Executive summary

G43A is a read-only/static parity preview for customer-facing order history and order tracker migration. It compares the current customer page data path with native Customer App `Order`, native operational `ShopifyOrder`, native `FulfillmentTask`, and Hub-derived customer-facing order context, then identifies the exact subset that can be considered for a future native-first patch.

No runtime behavior was changed. No schemas were changed. No Base44 publish was performed. No gates were opened. No live endpoint was called. No Order, ShopifyOrder, FulfillmentTask, Hub, provider, notification, sync, repair, replay, queue, inventory, or PurchaseOrder write was run.

Current conclusion:

```text
customer_order_history_tracker_native_parity_preview_ready_customer_behavior_unchanged
```

The safe native-first subset is narrow:

- one-time orders only
- Customer App `Order` present
- native `ShopifyOrder` present
- native `FulfillmentTask` present when operational status is displayed
- paid/captured
- not refunded
- not cancelled
- not subscription/multi-delivery
- no review queue / repair / replay ambiguity
- no status, payment, fulfillment, or delivery schedule mismatch
- Hub fallback remains available

The G43A fixture harness finds **2 native-first candidates** in the bounded evidence set:

1. `NV-MQHJR3V2` — active paid/captured one-time order with Customer App Order, native ShopifyOrder, and native FulfillmentTask present.
2. `NV-MPZNKGNT` — delivered/reconciled controlled one-time order with native/customer/Hub status parity.

Every other class remains Hub-primary, fallback-required, or review-held.

## 2. Scope and method

Audited source files and contracts:

- `src/pages/OrderHistory.jsx`
- `src/pages/OrderTracker.jsx`
- `src/pages/OrderConfirmation.jsx`
- `base44/functions/getCustomerAccountDashboardData/entry.ts`
- `base44/functions/getCustomerOrderDetail/entry.ts`
- `base44/functions/getCustomerOrdersWithHub/entry.ts`
- `base44/entities/Order.jsonc`
- `base44/entities/ShopifyOrder.jsonc`
- `base44/entities/FulfillmentTask.jsonc`
- `base44/entities/OrderSyncLog.jsonc`
- `base44/entities/SafeSyncParityLog.jsonc`
- `base44/entities/OrderReviewQueue.jsonc`
- G33C one-time mirror/task harnesses
- G35 refund parity/shadow harnesses
- G36 subscription/multi-delivery parity harnesses
- G39J/G39L admin order diagnostics/native-primary docs and harnesses
- G39D delivery route native-first docs and harness
- G27 native cutover readiness docs/harness

Method:

- Static source audit only.
- Local fixture harness only.
- No live Base44 reads.
- No Hub reads.
- No provider calls.
- No customer-facing response changes.
- No customer-visible diagnostics added.

The harness is:

- `scripts/migration/run-g43a-customer-order-history-tracker-parity-tests.mjs`

It models the customer-safe parity decision rules and validates fixture classes without calling live systems.

## 3. Current customer page dependency map

| Page / function | Current primary source | Hub fallback behavior | Native entities read | Merge/dedupe keys | Status/date/payment rules | Customer-visible fields | Write/provider/notification behavior | Current gap |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `OrderHistory.jsx` | `getCustomerAccountDashboardData` response `all_orders_raw` | No direct Hub read in current page path | Customer App `Order` only through the dashboard function | Dashboard dedupes by `order_number`, then Stripe PI, then entity id | Page filters paid/captured/refunded and hides test/abandoned/never-paid rows | order number, display name, created date, status badge, item images/titles, total, reorder button | Page can reorder into cart; no migration write. Dashboard function itself reads only. | Native `ShopifyOrder` / `FulfillmentTask` context is not used for history row source selection today. |
| `getCustomerAccountDashboardData` | Customer App identity-resolved `Order`, `Subscription`, account data | None in this function | `Order`, `Subscription`, profile/credits/points/notifications | `order_number` first; then Stripe PI; then id | `allOrdersForHistory` keeps paid/refunded/captured and hides test/abandoned/never-paid | Returns broad account payload plus `debug` metadata | Reads notifications count; no writes. | Customer payload currently includes debug-like metadata; future native-first patch should avoid adding more diagnostics to customer responses. |
| `OrderTracker.jsx` | `getCustomerOrderDetail` | Uses `hub_order` from detail only when CA Order not found or as returned context | It displays Customer App `Order`; hub-only fallback synthetic display row; `FulfillmentTask` rows from detail | URL order number or id; query supports Stripe session/PI for post-checkout | Current display status uses `order.status` or `hubOrder.production_status`; delivery date uses Customer App assigned/estimated date, then hub requested date | tracker stages, item list, total, ETA when on route, delivered proof/drop if returned | Calls `getDeliveryEta` only when order is on route; no writes. | Detail function only queries `FulfillmentTask` by `order_id`; native tasks linked by `base44_order_id`, `native_shopify_order_id`, or `order_number` may be missed. |
| `getCustomerOrderDetail` | Customer App `Order` by order number/id/Stripe ids | If CA Order not found, tries Hub-style `ShopifyOrder` by order number/base44 id | Customer App `Order`, `ShopifyOrder`, `FulfillmentTask`, `OrderSyncLog` | order number/id/Stripe ids; identity email check | Status timeline from Customer App order; delivery summary from Customer App order; hub fallback is coarse | Returns `order`, `hub_order`, `fulfillment_tasks`, status fields | Read-only. No provider call. No notifications. | Returns `resolved_identity_emails` and `debug_lookup_path`; future customer-native patch should keep diagnostics server/admin-only. |
| `getCustomerOrdersWithHub` | Hub-first merged operational order list per function comment | Hub query through `getOrderUpdatesForCustomerApp`; Hub wins on order number collision | Local `Order`, `FulfillmentTask`, CheckoutSession context | order number; Hub seeded first | Hub status mapped to Customer App labels; subscriptions expanded into occurrences | Merged orders with counts and source flags | Calls Hub read endpoint with secret. No mutation. | Not used by current `OrderHistory.jsx`; if reintroduced, response must be customer-sanitized and not hide Hub-only rows. |
| `OrderConfirmation.jsx` | Direct Customer App `Order.filter` by session/order number/path id | None | Customer App `Order` only | session id, order number, path id | Polls pending order after checkout; final link uses `order.order_number` or id | confirmation heading, order number, delivery card, links | No migration writes. Can show Google opt-in. | Tracker handoff is correct by order number, but confirmation does not prove native tracker parity. |

## 4. Customer-facing response contract to preserve

Future G43B/G43C work must preserve the existing customer contract unless explicitly approved.

Customer-safe display fields include:

- order number
- customer-safe display name already shown today
- created/order date
- lifecycle status label
- fulfillment type
- estimated/assigned delivery date
- delivery window label
- item titles, quantities, images, and prices already shown today
- total/subtotal/delivery fee already shown today
- delivered proof/drop fields only where already customer-facing and approved

Do not newly expose:

- internal native entity ids unless already customer-safe
- debug metadata
- fallback diagnostics
- source-of-truth labels
- mismatch categories
- raw Hub payloads
- raw Shopify payloads
- raw Stripe/payment payloads
- provider ids
- auth/secret values
- customer email, phone, or full address beyond the existing page contract

## 5. Parity classifications

G43A uses these classifications:

| Classification | Meaning | Customer behavior in G43A | Future native-first stance |
| --- | --- | --- | --- |
| `native_ready_one_time_active` | Clean active one-time order with Customer App Order, native ShopifyOrder, native FulfillmentTask, paid/captured, no mismatches | Unchanged | Eligible for G43B/G43C candidate set |
| `native_ready_one_time_completed` | Clean delivered/completed one-time order with reconciled native/customer/Hub statuses | Unchanged | Eligible for limited native-first display if completed status parity is proven |
| `native_born_one_time` | Native order exists, but tracker-critical task context is missing or incomplete | Unchanged | Hold until task context is complete |
| `historical_late_mirror` | Late/historical mirror exists and must not appear as new customer activity | Unchanged | Use native context only with history guard / original created date |
| `native_missing_hub_available` | Customer App/native source incomplete while Hub context exists | Unchanged | Hub fallback required |
| `hub_missing_native_available` | Native/customer context exists but Hub context missing | Unchanged | Review before customer cutover; fallback must remain available |
| `hub_only_valid_order` | Valid customer order exists only in Hub-derived data | Unchanged | Must remain visible through Hub fallback |
| `refund_payment_hub_source_of_truth` | Refund/payment reversal context | Unchanged | Hub/payment source of truth |
| `cancelled_payment_risk` | Cancelled, failed, unpaid, or not captured | Unchanged | Hub/payment source of truth or manual review |
| `subscription_multi_delivery_hub_source_of_truth` | Subscription or multi-delivery occurrence | Unchanged | Hub source of truth |
| `delivery_schedule_mismatch` | Native/customer/Hub delivery date mismatch | Unchanged | Hold for review |
| `status_mismatch` | Customer/native/Hub lifecycle status mismatch | Unchanged | Hold for review |
| `payment_mismatch` | Payment/financial status mismatch | Unchanged | Hub/payment source of truth |
| `fulfillment_mismatch` | Fulfillment/task status mismatch | Unchanged | Hold for review |
| `review_queue_hold` | Active `OrderReviewQueue` context | Unchanged | Manual review |
| `repair_replay_hold` | SafeSync/repair/replay ambiguity | Unchanged | Log-governed manual review |
| `unknown_manual_review_required` | Insufficient or ambiguous evidence | Unchanged | Manual review |

## 6. Exact bounded sample results

G43A’s local fixture harness covers the required bounded evidence set. It is not a live-row read; it is a no-write parity model for the future runtime rules.

| Sample | Evidence class | Customer App Order | Native ShopifyOrder | Native FulfillmentTask | Hub context | Classification | Native-primary eligible | Fallback/review result |
| --- | --- | ---: | ---: | ---: | ---: | --- | ---: | --- |
| `NV-MQHJR3V2` | active paid/captured one-time production pilot | yes | yes | yes | yes | `native_ready_one_time_active` | yes | Future limited native-first candidate |
| `NV-MPZNKGNT` | delivered/reconciled controlled order | yes | yes | yes | yes | `native_ready_one_time_completed` | yes | Future completed-status parity candidate |
| `NV-MP5SOQLJ` | historical/late one-time mirror | yes | yes | yes | yes | `historical_late_mirror` | no | Must not appear as newly created customer activity |
| `NV-MOVOAMIF` | known refund/payment-risk class from refund docs | yes | yes | yes | yes | `refund_payment_hub_source_of_truth` | no | Hub/payment source of truth |
| `NV-SUB-001` | representative subscription/multi-delivery fixture | yes | yes | yes | yes | `subscription_multi_delivery_hub_source_of_truth` | no | Hub source of truth |
| `NV-HUBONLY` | Hub-only valid order | no | no | no | yes | `hub_only_valid_order` | no | Must remain visible through Hub fallback |
| `NV-HUBCTX` | native/customer incomplete while Hub exists | no | yes | yes | yes | `native_missing_hub_available` | no | Hub fallback required |
| `NV-DATEMIS` | delivery schedule mismatch | yes | yes | yes | yes | `delivery_schedule_mismatch` | no | Review required |
| `NV-STATUSMIS` | status mismatch | yes | yes | yes | yes | `status_mismatch` | no | Review required |
| `NV-PAYMIS` | payment mismatch | yes | yes | yes | yes | `payment_mismatch` | no | Hub/payment source of truth |
| `NV-FULMIS` | fulfillment mismatch | yes | yes | yes | yes | `fulfillment_mismatch` | no | Review required |
| `NV-REVIEW` | active review queue hold | yes | yes | yes | yes | `review_queue_hold` | no | Manual review |
| `NV-REPAIR` | SafeSync repair/replay hold | yes | yes | yes | yes | `repair_replay_hold` | no | Log-governed manual review |

Harness summary:

```text
safe_native_first_subset_count: 2
fallback_required_count: 12
review_required_count: 12
hidden_valid_order_count: 0
writes_performed: false
provider_call_impact: false
notifications_sent: false
hub_mutation_performed: false
```

The representative subscription fixture is synthetic because no exact subscription/multi-delivery order number was available in the static source/docs searched during G43A. A future live preview should use an owner-approved exact subscription occurrence id/order number without fuzzy email/name matching.

## 7. Native-first eligibility rules

A future customer-facing native-first row may be eligible only when all are true:

- one-time order
- Customer App `Order` exists
- native `ShopifyOrder` exists
- native `FulfillmentTask` exists when operational status is displayed
- payment is paid/captured
- not refunded
- not cancelled
- not subscription/multi-delivery
- no active `OrderReviewQueue` blocker
- no repair/replay/SafeSync ambiguity
- no status mismatch
- no payment mismatch
- no fulfillment mismatch
- no delivery date/schedule mismatch
- no duplicate identity risk
- native delivery date is authoritative or matches Hub
- customer-facing status wording is safe
- Hub fallback remains available

If any field is uncertain:

- keep Hub-primary/fallback
- do not hide the order
- mark review required
- do not expose diagnostics to customers

## 8. Page-by-page gap list

### A. Customer order history

Current state:

- `OrderHistory.jsx` calls `getCustomerAccountDashboardData` and reads `all_orders_raw`.
- That dashboard function reads Customer App `Order` rows only for order history.
- It does not use native `ShopifyOrder` / `FulfillmentTask` context for source selection.
- It does not use `getCustomerOrdersWithHub`, even though that function remains Hub-aware and Hub-primary by design.

Gaps before native-first:

- Need a customer-safe parity layer that can add native context without changing displayed rows.
- Need dedupe rules across Customer App `Order`, native `ShopifyOrder`, native `FulfillmentTask`, and Hub order number.
- Need to keep Hub-only valid rows visible.
- Need to suppress or label historical late mirrors so they do not appear as newly created customer activity.
- Need to avoid exposing debug/source diagnostics in customer payload.
- Need pagination/sorting compatibility with current created-date order while preserving original historical dates.

### B. Order detail

Current state:

- `OrderTracker.jsx` detail data comes from `getCustomerOrderDetail`.
- Detail function looks up Customer App `Order` first, then Hub-style `ShopifyOrder` fallback if no Customer App Order is found.
- Detail returns `order`, `hub_order`, `fulfillment_tasks`, status timeline, delivery status, visible status, resolved identity emails, and debug lookup path.

Gaps before native-first:

- Future customer detail response should keep diagnostics server/admin-only.
- Refund/payment source of truth must remain Hub/payment-owned.
- Line item/total parity must be checked before native display wins.
- Native `FulfillmentTask` lookup should include `base44_order_id`, `native_shopify_order_id`, and `order_number`, not only `order_id`.
- Hub fallback should remain available for any missing or ambiguous native context.

### C. Order tracker

Current state:

- Tracker status stages are driven primarily by `order.status`; hub-only fallback maps `hubOrder.production_status` coarsely.
- ETA provider call (`getDeliveryEta`) occurs only when the displayed Customer App order is on route.
- Delivery proof/drop display comes from Customer App order delivery fields.

Gaps before native-first:

- Need explicit native status projection rules from `ShopifyOrder.production_status`, `FulfillmentTask.status`, `FulfillmentTask.delivery_status`, and Customer App `Order.status`.
- Need to avoid customer-facing status changes until status parity is clean.
- Need delivery schedule/status parity before replacing Hub state.
- Need customer-safe copy for native production states that do not exactly match current tracker stages.
- Need historical/late mirror handling so old orders do not jump to active tracker positions.
- Need delivered proof/drop policy before native delivered state is customer-primary.

### D. Order confirmation handoff

Current state:

- `OrderConfirmation.jsx` polls Customer App `Order` directly by session id, order number, or entity id.
- Final link routes to `/order-tracker/${order.order_number || order.id}`.
- View All Orders routes to `/account/orders`.

Gaps before native-first:

- Handoff route is correct for order-number-first tracking.
- It does not prove native tracker parity.
- It should not create duplicate order appearance if native-first history adds native context later.
- Post-checkout pending state must remain compatible with Hub/payment/webhook timing.

## 9. Recommended G43B/G43C scope

### G43B — limited native-first customer order history

Recommended scope if live preview confirms the same clean subset:

- Customer order history only.
- One-time paid/captured rows only.
- Native context can become primary only when Customer App Order + native ShopifyOrder + native FulfillmentTask parity is clean.
- Hub fallback for every other row.
- Hub-only valid orders remain visible.
- No customer-visible diagnostic metadata.
- No writes.
- No provider calls.
- No notifications.
- No refund/subscription source-of-truth change.

Do not include:

- subscriptions/multi-delivery
- refunds/cancellations/payment-risk rows
- repair/replay rows
- review queue rows
- broad tracker status changes

### G43C — limited native-first order tracker

Recommended scope after G43B or in a separately gated runtime patch:

- Exact reconciled one-time rows only.
- Read native `FulfillmentTask` by all safe identity keys: `order_id`, `base44_order_id`, `native_shopify_order_id`, and `order_number`.
- Native lifecycle projection only when status/date/payment/fulfillment parity is clean.
- Hub fallback for refund/subscription/mismatch/missing task cases.
- No customer-facing status update writes.
- No notifications or provider calls.

Do not recommend broad customer-facing native-first cutover.

## 10. Hard stops

Stop immediately if any future live preview shows:

- Hub-only valid customer orders would be hidden.
- Customer App/native/Hub statuses disagree.
- Native `FulfillmentTask` is missing for a row that displays operational status.
- Payment/refund state is not paid/captured and non-refunded.
- A refund, cancelled, failed, or partial refund context appears.
- A subscription/multi-delivery context appears.
- An `OrderReviewQueue` blocker exists.
- A SafeSync/repair/replay ambiguity exists.
- Delivery date/status mismatch appears.
- Customer-facing debug/fallback/source metadata would be exposed.
- Raw Hub/Stripe/Shopify/provider payloads would be returned.
- Any write/provider/notification/Hub mutation path is required.

## 11. No-write policy

G43A does not:

- mutate `Order`
- mutate `ShopifyOrder`
- mutate `FulfillmentTask`
- mutate Hub
- call Stripe
- call Shopify
- call providers
- send notifications
- run sync/retry/repair/replay
- create logs/queues
- hide Hub-only orders
- change refund/payment source-of-truth
- change subscription source-of-truth
- change customer-facing statuses
- publish Builder/Base44

## 12. Recommendation

Proceed with G43B only as a limited customer order history native-first patch after a live read-only preview confirms the same eligible subset and no Hub-only rows would be hidden.

Proceed with G43C only as a separate limited order tracker patch after native task lookup parity is hardened and exact one-time rows are clean.

Keep Hub fallback active. Keep refunds/payments and subscriptions/multi-delivery as Hub/payment source-of-truth. Do not suppress Hub writes or make broad customer-facing cutovers in this track.
