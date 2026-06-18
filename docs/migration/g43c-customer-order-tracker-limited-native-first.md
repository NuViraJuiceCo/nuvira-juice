# G43C — Customer OrderTracker Limited Native-First Patch

## 1. Executive summary

G43C adds a default-off, exact-allowlisted native operational enrichment path for the customer `OrderTracker` backend response.

The runtime target is:

```text
getCustomerOrderDetail -> OrderTracker.jsx
```

The patch keeps Customer App `Order` as the canonical customer-facing order record. Native `ShopifyOrder` and `FulfillmentTask` records may only enrich safe operational fields after strict identity, ownership, payment, fulfillment, and schedule checks pass.

No customer-facing tracker behavior changes until the feature controls are enabled after merge/publish/boundary verification.

## 2. Current tracker data path

`OrderTracker.jsx` builds a lookup payload from the route:

- `/order-tracker/:orderNumber`
- `/order-tracker/:orderId`
- optional Stripe session/payment identifiers for post-checkout recovery

It calls:

```text
base44.functions.invoke('getCustomerOrderDetail', lookupPayload)
```

`getCustomerOrderDetail` currently:

1. Authenticates the current user.
2. Resolves customer identity aliases through `UserProfile`.
3. Looks up Customer App `Order` by order number, order id, payment intent, or checkout session.
4. Verifies ownership for non-admin users.
5. Falls back to `ShopifyOrder` only when Customer App `Order` is missing.
6. Queries `FulfillmentTask` primarily by `order_id`.
7. Returns the existing tracker-compatible response.

## 3. Exact task lookup gap

Before G43C, `FulfillmentTask` lookup was too narrow:

```text
FulfillmentTask.filter({ order_id: resolvedOrderId })
```

That misses native tasks linked through newer migration fields such as:

- `base44_order_id`
- `native_shopify_order_id`
- `shopify_order_id`
- exact `order_number`
- exact `shopify_order_number`

G43C adds an internal exact task resolver that queries and dedupes those fields. It uses the task only when exactly one compatible task remains.

## 4. Feature controls

G43C is default-off.

| Control | Purpose |
| --- | --- |
| `ENABLE_CUSTOMER_ORDER_TRACKER_LIMITED_NATIVE_FIRST` | Enables the limited native tracker evaluator. Disabled by default. |
| `CUSTOMER_ORDER_TRACKER_LIMITED_NATIVE_FIRST_KILL_SWITCH` | Forces current behavior even if the enable flag is set. |
| `CUSTOMER_ORDER_TRACKER_LIMITED_NATIVE_FIRST_ORDER_ALLOWLIST` | Exact comma-separated order numbers eligible for evaluation. |

Initial intended allowlist after separate live approval:

- `NV-MQHJR3V2`
- `NV-MPZNKGNT`

## 5. Exact identity matching rules

### Customer App Order to native ShopifyOrder

Native `ShopifyOrder` may match only through:

1. `base44_order_id === Customer App Order.id`
2. `customer_app_order_id === Customer App Order.id`, if present
3. exact normalized `shopify_order_number`
4. exact normalized `order_number`

Normalization only removes a leading `#` and uppercases order numbers.

No fuzzy matching is allowed:

- no customer-name matching
- no phone matching
- no partial email matching
- no approximate amount matching
- no approximate date matching
- no display-label matching

### Native ShopifyOrder to FulfillmentTask

FulfillmentTask candidates are collected through:

1. `order_id === Customer App Order.id`
2. `base44_order_id === Customer App Order.id`
3. `native_shopify_order_id === native ShopifyOrder.id`
4. `shopify_order_id === native ShopifyOrder.id`
5. exact normalized `order_number`
6. exact normalized `shopify_order_number`

Candidates are deduped by task id. If zero or multiple compatible tasks remain, G43C preserves current behavior.

## 6. Ownership isolation

Ownership filtering occurs before native enrichment.

For non-admin users, the Customer App `Order.customer_email` must be included in the authenticated user's resolved identity set. The order allowlist is evaluated only after the owned Customer App Order is found and authorized.

The allowlist cannot introduce an order owned by another customer.

## 7. Limited native eligibility

An order is eligible only when all are true:

- authenticated customer owns the Customer App `Order`
- order number is exact-allowlisted
- Customer App `Order` exists
- native `ShopifyOrder` exists
- exactly one compatible native `FulfillmentTask` exists
- order is paid/captured
- not refunded
- not cancelled
- not subscription
- not multi-delivery
- no `OrderReviewQueue` blocker
- no repair/replay ambiguity in `OrderSyncLog`
- no blocking mismatch in `SafeSyncParityLog`
- no payment mismatch
- no fulfillment mismatch
- no delivery schedule mismatch
- native operational fields map to customer-safe tracker meanings

If any signal is missing or ambiguous, G43C preserves current tracker behavior.

## 8. Customer-safe enrichment rules

Eligible native context may enrich only existing customer tracker concepts:

- `production_status`
- `fulfillment_status`
- `delivery_status`
- `assigned_delivery_date`, only if the Customer App field is missing
- `estimated_delivery_date`, only if the Customer App field is missing
- `delivery_window_label`, only if the Customer App field is missing
- `status`, only if the Customer App status is missing and native status maps safely

G43C does not override:

- Customer App `Order.id`
- order number
- original `created_date`
- totals
- line items
- payment/refund status
- customer identity
- address fields
- cancellation/refund fields
- subscription fields

## 9. ProductionBatch/customer-status boundary

G43C does not read `ProductionBatch` and does not use ProductionBatch lifecycle state as a direct customer tracker source.

The G37 production lifecycle remains operational/internal until separate post-verify cascade and customer-status approvals are completed.

Internal statuses such as these must not directly appear in customer tracker progression:

- `planned`
- `in_production` when only sourced from ProductionBatch
- `completed_pending_verification`
- `verified_logged`
- `native mirror`
- `Hub fallback`
- compliance states

## 10. Fallback and hold rules

The existing tracker behavior remains authoritative for:

- nonallowlisted orders
- Hub-only valid orders
- missing native records
- duplicate native identity
- duplicate/conflicting task identity
- refunded orders
- cancelled orders
- subscriptions
- multi-delivery orders
- payment mismatches
- fulfillment mismatches
- delivery-date mismatches
- review queue holds
- repair/replay holds
- historical/late mirrors outside the allowlist

## 11. Sample expectations

### NV-MQHJR3V2

- Customer App `Order` remains canonical.
- Native `ShopifyOrder` and exact `FulfillmentTask` may enrich safe operational fields.
- Customer-facing state remains pre-production/preparation until approved customer-status cascades occur.
- ProductionBatch state does not directly advance tracker.

### NV-MPZNKGNT

- Only visible to its owning customer.
- Customer App `Order` remains canonical.
- Safe delivered/reconciled native context may be used.
- No duplicate native row appears.

### NV-MP5SOQLJ

- Not in the initial allowlist.
- Historical/late mirror behavior remains unchanged.

### Refunds, cancellations, subscriptions, multi-delivery

- Existing Hub/payment/subscription source-of-truth remains active.
- No native-first tracker cutover occurs.

## 12. Test coverage

Harness:

```text
scripts/migration/run-g43c-customer-order-tracker-limited-native-first-tests.mjs
```

Coverage includes:

1. Feature disabled preserves current response exactly.
2. Kill switch preserves current response.
3. Nonallowlisted orders preserve current response.
4. Ownership filtering before allowlist/native enrichment.
5. Cross-customer allowlisted order blocked.
6. Customer App Order canonical identity.
7. Original created date preservation.
8. Totals and line items unchanged.
9. Native ShopifyOrder exact matching by `base44_order_id`.
10. Native ShopifyOrder exact matching by normalized order number.
11. Multiple native ShopifyOrder matches fallback.
12. Task matching by `order_id`.
13. Task matching by `base44_order_id`.
14. Task matching by `native_shopify_order_id`.
15. Task matching by normalized order number.
16. Duplicate task candidates dedupe by id.
17. Conflicting task candidates fallback.
18. Missing task fallback.
19. Clean active one-time enrichment.
20. Clean delivered one-time enrichment.
21. Refund hold.
22. Cancelled hold.
23. Subscription hold.
24. Multi-delivery hold.
25. Payment mismatch hold.
26. Fulfillment mismatch hold.
27. Delivery schedule mismatch hold.
28. Review queue hold.
29. Repair/replay hold.
30. ProductionBatch not used as direct tracker source.
31. Internal production statuses not returned as customer status.
32. Response shape compatibility.
33. Tracker route identifier compatibility.
34. No G43C diagnostic fields added to the order object.
35. No new PII exposure added to enriched order keys.
36. No raw payload exposure added.
37. No writes.
38. No provider calls.
39. No notifications.
40. No Hub mutation.

## 13. No-write policy

G43C is a read-only customer tracker patch.

It does not:

- mutate `Order`
- mutate `ShopifyOrder`
- mutate `FulfillmentTask`
- mutate Hub records
- call Stripe
- call Shopify
- call providers
- send notifications
- run sync/repair/replay
- create logs or queues

## 14. Rollback / kill-switch behavior

To restore current behavior after future activation:

1. Set `CUSTOMER_ORDER_TRACKER_LIMITED_NATIVE_FIRST_KILL_SWITCH=true`.
2. Clear `ENABLE_CUSTOMER_ORDER_TRACKER_LIMITED_NATIVE_FIRST`.
3. Clear `CUSTOMER_ORDER_TRACKER_LIMITED_NATIVE_FIRST_ORDER_ALLOWLIST`.
4. Rerun authenticated tracker smoke.

Because the patch is read-only and default-off, rollback does not require record repair.

## 15. Future activation plan

After merge and scoped publish:

1. Publish only `getCustomerOrderDetail`.
2. Keep feature disabled.
3. Verify unauthenticated/customer-auth behavior.
4. Verify disabled tracker response for `NV-MQHJR3V2`.
5. Verify no writes.
6. Request separate `G43C-LIVE1` activation for the exact same allowlist only:
   - `NV-MQHJR3V2`
   - `NV-MPZNKGNT`

Do not broaden to refunds, subscriptions, historical late mirrors, or additional orders without separate audit and approval.
