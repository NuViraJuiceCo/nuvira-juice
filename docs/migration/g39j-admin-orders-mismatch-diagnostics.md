# G39J: Admin Orders Mismatch Diagnostics

## 1. Purpose

G39J adds diagnostics-only mismatch and fallback reporting to `getAdminOrdersWithHub`.

This is **not** an admin orders native-first cutover. The runtime keeps the existing Hub-first merge behavior and uses Customer App/native records only as current context or as rows when Hub has no matching order number.

The purpose is to make admin order mismatch classes visible enough to decide whether a later G39K can safely target a restricted native-first subset.

G39J does not change customer-facing order history or tracker behavior.

## 2. G39B / G39I evidence

G39B classified `admin_orders` as `ready_with_fallback_reporting`, medium risk.

Carry-forward G39B sample:

| Metric | Result |
| --- | --- |
| Native rows | 10 |
| Hub-context rows | 4 |
| Mismatches | 3 |
| Fallback-required rows | 1 |
| Recommendation | Diagnostics first, not native-first |

G39I audited the current `getAdminOrdersWithHub` behavior and found:

- current behavior is Hub-primary
- Hub rows seed the merged map first
- native rows are added only when Hub has no matching order number
- local Customer App rows are added only when Hub has no matching order number
- `/admin/orders` response shape must remain backward-compatible
- `appendAdminHubOrderNote` is a separate write-capable admin action and must remain out of scope

## 3. Current Hub-primary behavior preserved

G39J preserves the current merge order:

1. Read local Customer App `Order` rows.
2. Read native `FulfillmentTask` rows for subscription expansion and task context.
3. Read native `ShopifyOrder` rows for operational mirror context.
4. Read `OrderSyncLog` and `OrderReviewQueue` for read-only sync/review context.
5. Read `UserProfile` rows for current admin-visible labels/contact alias behavior.
6. Read Hub order updates where Hub config exists.
7. Expand Hub subscription/multi-delivery rows.
8. Seed merged rows with Hub rows first.
9. Add native rows only when no Hub row exists.
10. Add local Customer App rows only when no Hub row exists.
11. Attach additive diagnostics.

No primary source ordering is changed.

## 4. Diagnostic metadata contract

G39J adds additive top-level metadata:

- `admin_orders_diagnostics_enabled:true`
- `native_first_enabled:false`
- `hub_first_enabled:true`
- `hub_fallback_active:true`
- `writes_performed:false`
- `provider_call_impact:false`
- `notifications_sent:false`
- `hub_mutation_performed:false`
- `customer_facing_behavior_changed:false`
- `append_admin_hub_order_note_touched:false`
- `hub_row_count`
- `native_shopify_order_row_count`
- `native_fulfillment_task_row_count`
- `local_customer_app_order_row_count`
- `merged_row_count`
- `exact_match_count`
- `mismatch_count`
- `native_missing_hub_available_count`
- `hub_missing_native_available_count`
- `hub_only_count`
- `native_only_count`
- `fallback_required_count`
- `review_required_count`
- `mismatch_categories`
- `fallback_reasons`
- `source_of_truth_holds`

G39J adds additive per-row metadata where feasible:

- `data_source`
- `hub_primary`
- `native_context_available`
- `fallback_source`
- `fallback_reason`
- `mismatch_fields`
- `mismatch_categories`
- `review_required`
- `customer_facing_safe:false`
- `source_of_truth`
- `order_classification`
- `live_command_candidate:false`
- safe `warnings`

Existing top-level fields and order row fields are not removed or renamed.

## 5. Mismatch categories

The diagnostics classify conservative mismatch categories only. They do not change displayed order state.

| Category | Example fields | Runtime behavior |
| --- | --- | --- |
| `status_mismatch` | Hub/local status | report only; preserve current displayed behavior |
| `payment_mismatch` | payment status/captured | report only; Hub/payment source-of-truth hold |
| `fulfillment_mismatch` | fulfillment status | report only; no lifecycle command readiness |
| `production_mismatch` | production status | report only; no production command readiness |
| `delivery_schedule_mismatch` | assigned/estimated/task delivery date | report only; review/fallback metadata |
| `line_item_mismatch` | visible vs native/local line count | report only; review required |
| `financial_mismatch` | total/native total | report only; Hub/payment source-of-truth hold |

Unknown or incomplete evidence is treated as review/fallback context rather than truth inference.

## 6. Source-of-truth rules

G39J encodes diagnostics-only source-of-truth holds:

| Order class | Diagnostic source of truth |
| --- | --- |
| One-time active paid/captured | candidate for later native subset only after parity proof |
| One-time complete | candidate for later native subset only if reconciled |
| Historical/late mirror | admin-native context only; not a live lifecycle candidate |
| Refunded/cancelled/payment-not-ready | Hub/payment source of truth |
| Subscription/multi-delivery | Hub source of truth |
| Repair/replay/safeSync | manual review / log-governed |
| Hub-only | Hub primary retained |
| Native-only | retained under current behavior; customer-facing hold |
| Unknown | manual review / Hub fallback |

The diagnostics explicitly keep `native_first_enabled:false`.

## 7. Response compatibility

The `/admin/orders` response remains backward-compatible.

Preserved top-level fields include:

- `success`
- `total`
- `local_count`
- `hub_count`
- `native_shopify_order_count`
- `orders`

Preserved behavior includes:

- current row ordering logic
- current filters/search compatibility
- current Hub-first row selection
- current admin-visible labels/contact context
- current Hub note UI contract
- current customer-facing behavior

G39J does not add customer email, phone, full address, raw Hub payloads, raw Shopify payloads, raw Stripe/payment payloads, raw proof/drop payloads, or secrets beyond the current admin orders contract.

## 8. `appendAdminHubOrderNote` out of scope

`appendAdminHubOrderNote` remains untouched.

G39J does not:

- create Hub notes
- update Hub orders
- trigger the note composer
- change note permissions
- alter Hub note button behavior

Admin note behavior should remain exactly as it was before G39J.

## 9. Test coverage

Fixture harness:

`node scripts/migration/run-g39j-admin-orders-mismatch-diagnostics-tests.mjs`

Covered cases:

1. Hub row primary behavior is preserved.
2. Native row appends only when no Hub row exists.
3. Local Customer App row appends only when no Hub row exists.
4. Native/Hub exact match count is returned.
5. Status mismatch reports status diagnostics.
6. Payment mismatch creates Hub/payment source-of-truth hold.
7. Delivery date mismatch returns fallback/review metadata.
8. Historical/late mirror is not a live command candidate.
9. Refunded/cancelled row remains Hub/payment source-of-truth.
10. Subscription/multi-delivery row remains Hub source-of-truth.
11. Repair/replay row receives manual review metadata.
12. Native-only row is retained and classified.
13. Hub-only row is retained and classified.
14. Response shape remains backward-compatible.
15. `appendAdminHubOrderNote` remains untouched.
16. No customer email/phone is newly exposed.
17. No raw Hub/Shopify/Stripe/provider payloads are returned.
18. `writes_performed:false`.
19. `provider_call_impact:false`.
20. `notifications_sent:false`.
21. `hub_mutation_performed:false`.
22. Top-level diagnostics contract is returned.
23. No logs/queues are created.

Regression checks include the G39B parity harness and prior native-first admin read harnesses for delivery route, production planning, and calendar events.

## 10. No-write policy

G39J remains read-only aggregation.

It must not:

- mutate Customer App `Order`
- mutate native `ShopifyOrder`
- mutate native `FulfillmentTask`
- mutate Hub records
- create `OrderSyncLog`
- create `CommandLog`
- create `OrderReviewQueue`
- create notifications or message logs
- call Stripe
- call Shopify
- call providers
- send notifications
- run sync/retry/repair/replay
- deduct inventory
- create PurchaseOrders

## 11. Rollback plan

If live diagnostics cause admin orders issues:

1. Revert the `getAdminOrdersWithHub` G39J runtime patch.
2. Publish only `getAdminOrdersWithHub`.
3. No data repair should be required because G39J is read-only.
4. Hub remains active throughout rollback.
5. `appendAdminHubOrderNote` should not need rollback because it was not changed.

## 12. Next phase recommendation

Use live G39J diagnostics to plan G39K.

Recommended G39K options:

1. **Preferred:** limited native-first subset plan for rows where one-time native/local/Hub fields match and no payment/refund/subscription/repair hold exists.
2. **Alternative:** keep Hub-primary and add a small admin diagnostics panel if operators need visibility before source priority changes.
3. **Hold:** if live mismatch categories show payment/refund/subscription/repair risk is too broad.

Do not proceed to full admin orders native-first until diagnostics show a narrow safe subset.
