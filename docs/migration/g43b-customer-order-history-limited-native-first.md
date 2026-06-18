# G43B: Customer order history limited native-first

## 1. Executive summary

G43B adds a default-off, exact-allowlisted limited native operational enrichment path to `getCustomerAccountDashboardData` for customer order history rows.

This is not a broad customer-facing native-first cutover. The Customer App `Order` remains the canonical customer-facing row. The patch only enriches existing `all_orders_raw` rows with safe operational fields from native `ShopifyOrder` / `FulfillmentTask` context when a row passes strict eligibility checks.

Current behavior is preserved unless all of these are true:

- `ENABLE_CUSTOMER_ORDER_HISTORY_LIMITED_NATIVE_FIRST` is enabled.
- `CUSTOMER_ORDER_HISTORY_LIMITED_NATIVE_FIRST_KILL_SWITCH` is not active.
- The order number is included in `CUSTOMER_ORDER_HISTORY_LIMITED_NATIVE_FIRST_ORDER_ALLOWLIST`.
- Exact native context exists and passes eligibility.

Initial intended allowlist:

- `NV-MQHJR3V2`
- `NV-MPZNKGNT`

G43B does not change `OrderHistory.jsx`, `OrderTracker.jsx`, `getCustomerOrderDetail`, order confirmation, schemas, provider integrations, notifications, Hub writes, or customer-facing routes.

## 2. Current OrderHistory data path

`src/pages/OrderHistory.jsx` currently calls:

```text
getCustomerAccountDashboardData -> all_orders_raw
```

The page does not currently use `getCustomerOrdersWithHub`.

`getCustomerAccountDashboardData` builds `all_orders_raw` from identity-resolved Customer App `Order` rows. It filters out test, abandoned, and never-paid rows, then returns the Customer App order rows to the customer account page.

G43B keeps that row source and patches only the narrow `all_orders_raw` assembly path.

## 3. Why `getCustomerAccountDashboardData` is the target

G43A found:

- `OrderHistory.jsx` uses `getCustomerAccountDashboardData`.
- `OrderHistory.jsx` reads `res.data?.all_orders_raw || []`.
- `getCustomerOrdersWithHub` exists but is not the current customer order history page path.
- `OrderTracker.jsx` uses `getCustomerOrderDetail`; tracker changes are deferred to G43C.

Therefore G43B targets `getCustomerAccountDashboardData` only.

## 4. Gate / kill-switch behavior

Runtime controls:

| Control | Purpose |
| --- | --- |
| `ENABLE_CUSTOMER_ORDER_HISTORY_LIMITED_NATIVE_FIRST` | Enables the limited native enrichment evaluator. Disabled by default. |
| `CUSTOMER_ORDER_HISTORY_LIMITED_NATIVE_FIRST_KILL_SWITCH` | Forces current behavior even if enable is set. |
| `CUSTOMER_ORDER_HISTORY_LIMITED_NATIVE_FIRST_ORDER_ALLOWLIST` | Exact comma-separated order numbers eligible for evaluation. |

Behavior:

- Disabled: returns the existing `all_orders_raw` behavior.
- Kill switch active: returns the existing `all_orders_raw` behavior.
- Empty allowlist: returns the existing `all_orders_raw` behavior.
- Nonallowlisted order: returned unchanged.
- Allowlisted but ineligible order: returned unchanged.
- Allowlisted and eligible order: returned as the same Customer App `Order` row with safe operational fields enriched.

No admin actor gate is used because this is a customer-authenticated read surface, not an admin command. Safety is provided by exact order allowlisting plus strict eligibility.

## 5. Exact native matching rules

Customer App `Order` to native `ShopifyOrder` uses exact keys only:

- `ShopifyOrder.base44_order_id === Order.id`
- `ShopifyOrder.customer_app_order_id === Order.id` if present
- normalized `ShopifyOrder.shopify_order_number === Order.order_number`

Native `ShopifyOrder` to `FulfillmentTask` uses exact keys only:

- `FulfillmentTask.native_shopify_order_id === ShopifyOrder.id`
- `FulfillmentTask.shopify_order_id === ShopifyOrder.id`
- `FulfillmentTask.base44_order_id === Order.id`
- normalized `FulfillmentTask.order_number === Order.order_number`

No fuzzy matching is allowed:

- no customer name matching
- no phone matching
- no partial email matching
- no display label matching
- no approximate date matching

If multiple native matches remain after exact filtering, the row is ineligible and the current customer behavior is preserved.

## 6. Strict eligibility rules

A row is eligible only when all are true:

- Customer App `Order` exists.
- Order number is exact-allowlisted.
- Exactly one matching native `ShopifyOrder` exists.
- Exactly one matching native `FulfillmentTask` exists.
- The order is one-time.
- Payment is paid/captured.
- Native payment context is paid or absent.
- The row is not refunded.
- The row is not cancelled/failed.
- The row is not subscription.
- The row is not multi-delivery.
- The row is not historical/late mirror/backfill.
- No open `OrderReviewQueue` row exists for the order.
- No repair/replay/retry/recovery signal exists in `OrderSyncLog`.
- No blocking/mismatch/manual-review signal exists in `SafeSyncParityLog`.
- Customer and native status projections match.
- Customer and native payment projections match.
- Customer and native fulfillment projections match when both are present.
- Customer and native delivery dates match when both are present.

If any signal is missing or ambiguous, the row is returned unchanged.

## 7. Customer-safe output rules

For an eligible row, G43B preserves the Customer App row and enriches only these safe operational fields when present:

- `production_status`
- `fulfillment_status`
- `delivery_status`
- `delivery_window_label` only when the Customer App row is missing it
- `status` only when the Customer App row is missing it and native status maps safely

G43B preserves:

- Customer App Order id
- order number
- original Customer App `created_date`
- original sort order
- total
- subtotal
- delivery fee
- line items
- item images/titles/prices/quantities
- existing account order history routes
- customer-visible chronology

G43B does not return customer-visible diagnostic metadata such as:

- `native_primary_eligible`
- `mismatch_fields`
- `fallback_reason`
- `source_of_truth`
- `review_required`
- native ids not already part of the customer-safe contract
- Hub diagnostics
- raw payloads

## 8. Historical mirror safeguard

Historical/late mirrors are explicitly ineligible.

This protects rows such as `NV-MP5SOQLJ`, where native records may have been created later than the original customer order. Even if a historical mirror is accidentally allowlisted, G43B returns the existing Customer App row unchanged and preserves the original customer-facing chronology.

Native mirror creation dates must never make historical customer activity look new.

## 9. Fallback rules

G43B returns the current row unchanged when any of these are true:

- feature disabled
- kill switch active
- order not allowlisted
- native `ShopifyOrder` missing
- native `FulfillmentTask` missing
- duplicate native identity
- payment mismatch
- status mismatch
- fulfillment mismatch
- delivery date mismatch
- refunded/payment-risk context
- cancelled context
- subscription context
- multi-delivery context
- historical/late mirror context
- open review queue blocker
- repair/replay ambiguity

Rows are not hidden. Duplicates are not added. Hub/payment/subscription fallback remains active.

## 10. Non-order dashboard preservation

`getCustomerAccountDashboardData` also returns profile, subscription, credit, loyalty, and notification fields.

G43B does not alter:

- identity resolution
- `customer_profile`
- `active_subscriptions`
- `all_subscriptions`
- `subscription_count`
- `current_ritual`
- credits
- loyalty points
- notification unread count
- dashboard counts unrelated to order history

The patch is limited to `all_orders_raw` after the existing order-history filter has run.

## 11. Test coverage

Added harness:

```text
scripts/migration/run-g43b-customer-order-history-limited-native-first-tests.mjs
```

The harness loads the actual `getCustomerAccountDashboardData` function in a local VM with fake Base44 entity adapters. It does not call live Base44, Hub, Stripe, Shopify, providers, or notification systems.

Covered cases:

1. Feature disabled preserves current response exactly.
2. Kill switch preserves current response.
3. Nonallowlisted order preserves current response.
4. Clean active one-time order receives safe native operational enrichment.
5. Clean delivered one-time order receives safe native delivered context.
6. Customer App Order remains canonical returned row.
7. Customer-facing created date remains original Customer App date.
8. Native mirror creation date never makes historical order appear new.
9. Native ShopifyOrder missing preserves fallback.
10. FulfillmentTask missing preserves fallback.
11. Duplicate native identity preserves fallback.
12. Payment mismatch preserves fallback.
13. Status mismatch preserves fallback.
14. Fulfillment mismatch preserves fallback.
15. Delivery date mismatch preserves fallback.
16. Refund remains Hub/payment source-of-truth.
17. Cancelled order preserves current behavior.
18. Subscription remains Hub source-of-truth.
19. Multi-delivery remains Hub source-of-truth.
20. Review queue blocker preserves fallback.
21. Repair/replay ambiguity preserves fallback.
22. Hub-only/current valid order remains visible through current path equivalent.
23. No valid order is hidden.
24. No duplicate order is returned.
25. Pagination and sorting remain compatible.
26. Order totals and line items remain unchanged.
27. Existing links/routes remain compatible.
28. No customer-visible diagnostic metadata.
29. No new PII exposure.
30. No raw payload exposure.
31. No writes.
32. No provider calls.
33. No notifications.
34. No Hub mutation.
35. Non-order dashboard fields remain unchanged.

## 12. No-write policy

G43B does not:

- mutate `Order`
- mutate `ShopifyOrder`
- mutate `FulfillmentTask`
- mutate Hub
- call Stripe
- call Shopify
- call providers
- send notifications
- run sync/repair/replay
- create logs/queues
- hide valid orders
- change refund/payment source-of-truth
- change subscription source-of-truth
- change customer-facing order tracker behavior
- publish Base44 during PR prep

## 13. Rollback / kill-switch

Rollback options:

1. Set `CUSTOMER_ORDER_HISTORY_LIMITED_NATIVE_FIRST_KILL_SWITCH=true`.
2. Clear `ENABLE_CUSTOMER_ORDER_HISTORY_LIMITED_NATIVE_FIRST`.
3. Clear `CUSTOMER_ORDER_HISTORY_LIMITED_NATIVE_FIRST_ORDER_ALLOWLIST`.
4. Revert the runtime patch if needed.

Because the path is read-only and default-off, rollback does not require data repair.

## 14. G43C dependency

G43B intentionally does not change tracker behavior.

G43C should separately patch `getCustomerOrderDetail` / `OrderTracker` so native task lookup can use exact:

- `base44_order_id`
- `native_shopify_order_id`
- `shopify_order_id`
- `order_number`

G43C should keep the same principles:

- exact allowlisting
- Hub fallback active
- no refund/subscription cutover
- no customer-visible diagnostics
- no notifications/providers/Hub mutation

## 15. Recommendation

Close/merge/publish G43B only after audit. Publish only `getCustomerAccountDashboardData`.

After publish, keep the feature disabled for boundary verification. Then enable only exact allowlisted order numbers after a separate approval and smoke `/account/orders` with the customer-safe response contract verified.
