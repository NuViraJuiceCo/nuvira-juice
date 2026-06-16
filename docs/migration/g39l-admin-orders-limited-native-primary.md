# G39L: Admin Orders Limited Native-Primary Runtime Patch

## 1. Purpose

G39L adds limited native-primary selection to `getAdminOrdersWithHub` for admin display only.

This is not a broad admin orders native-first cutover. The function keeps Hub-first/default behavior for every row that is not explicitly safe. Hub fallback remains active, customer-facing order surfaces remain unchanged, and `appendAdminHubOrderNote` remains untouched.

G39L is PR prep only. It should not be published until a separate closeout/publish phase audits and merges the PR.

## 2. G39J / G39K evidence

G39J made admin orders mismatch/fallback diagnostics live while preserving Hub-first behavior.

Carry-forward G39J live evidence:

| Field | Live result |
| --- | --- |
| `admin_orders_diagnostics_enabled` | `true` |
| `native_first_enabled` | `false` |
| `hub_first_enabled` | `true` |
| `hub_fallback_active` | `true` |
| `writes_performed` | `false` |
| `provider_call_impact` | `false` |
| `notifications_sent` | `false` |
| `hub_mutation_performed` | `false` |
| `append_admin_hub_order_note_touched` | `false` |
| Merged rows | 27 |
| Hub rows | 15 |
| Native ShopifyOrder rows | 10 |
| Native FulfillmentTask rows | 3 |
| Local Customer App Order rows | 17 |
| Mismatches | 4 |
| Review-required rows | 15 |

G39J mismatch categories:

- `fulfillment_mismatch:1`
- `status_mismatch:1`
- `delivery_schedule_mismatch:3`

G39K concluded:

- do not make all admin orders native-first
- only a limited safe one-time subset may become native-primary
- Hub fallback must remain active
- customer-facing surfaces must not change
- `appendAdminHubOrderNote` must remain out of scope

## 3. Why full native-first remains blocked

Full admin orders native-first remains blocked because live diagnostics show active mismatch and review classes.

Blocking categories include:

- status mismatch
- fulfillment mismatch
- delivery schedule mismatch
- payment/refund/cancel source-of-truth holds
- subscription/multi-delivery Hub source-of-truth holds
- repair/replay/manual-review holds
- Hub-only rows
- native-missing rows
- unknown or ambiguous identity

G39L therefore keeps Hub-primary behavior by default and only allows native-primary selection when a row satisfies every eligibility rule.

## 4. Eligibility rules

A row can become admin-native-primary only when all of the following are true:

- one-time order signal is present
- not POS/event
- not subscription
- not multi-delivery
- not refunded
- not cancelled
- not payment-not-ready
- not repair/replay/safeSync governed
- no manual-review source-of-truth hold
- no OrderReviewQueue blocker
- Customer App Order context exists
- native ShopifyOrder context exists
- native FulfillmentTask context exists
- payment is paid
- payment is captured
- `mismatch_fields` is empty
- `review_required:false`
- native task metadata is complete enough for admin display
- native candidate row exists

If any signal is missing or ambiguous, the row stays on its current Hub-primary/default path and receives `native_primary_eligible:false` plus blockers.

## 5. Hub-primary hold rules

Rows remain Hub-primary or manual-review governed when any of the following are true:

- refund-related
- cancelled
- payment pending, failed, or not captured
- subscription
- multi-delivery
- Hub-only
- native missing / Hub available
- native ShopifyOrder missing
- native FulfillmentTask missing where task context is required
- `mismatch_fields` not empty
- `review_required:true`
- repair/replay/safeSync context
- OrderReviewQueue blocker
- delivery schedule mismatch
- status mismatch
- fulfillment/payment/financial mismatch
- unknown/ambiguous source of truth

Hub-only rows remain visible. They are not hidden and are not converted into native rows.

## 6. Source-of-truth rules

G39L applies source-priority only for admin display.

| Order class | G39L behavior |
| --- | --- |
| Safe one-time active paid/captured | native-primary only when native ShopifyOrder/FulfillmentTask parity is clean |
| Safe one-time completed/reconciled | native-primary only when status/payment/task parity is clean |
| Safe late/historical mirror | native-primary only for admin mirror fields; not production lifecycle proof |
| Refund/cancel/payment-not-ready | Hub/payment source of truth |
| Subscription/multi-delivery | Hub source of truth |
| Repair/replay/safeSync | Hub/log/manual-review governed |
| Unknown/ambiguous | Hub-primary/manual review |

Customer-facing order history/tracker behavior remains unchanged.

## 7. Metadata contract

G39L preserves G39J diagnostics and adds safe, additive limited-native-primary metadata.

Top-level metadata:

- `limited_native_primary_enabled:true`
- `native_first_enabled:false`
- `hub_first_enabled:true`
- `hub_fallback_active:true`
- `native_primary_row_count`
- `hub_primary_row_count`
- `native_primary_eligible_count`
- `native_primary_ineligible_count`
- `native_primary_ineligible_reasons`
- `mismatch_count`
- `mismatch_categories`
- `review_required_count`
- `customer_facing_behavior_changed:false`
- `append_admin_hub_order_note_touched:false`
- `writes_performed:false`
- `provider_call_impact:false`
- `notifications_sent:false`
- `hub_mutation_performed:false`

Per-row metadata:

- `admin_primary_source`
- `native_primary_eligible`
- `native_primary_reason`
- `native_primary_blockers`
- `source_of_truth`
- `mismatch_fields`
- `review_required`
- `customer_facing_safe`
- `write_path_not_in_scope:true`
- `order_classification`

Existing response fields remain backward-compatible.

## 8. `appendAdminHubOrderNote` out of scope

G39L does not modify:

- `appendAdminHubOrderNote`
- `AdminOrders.jsx` Hub note action
- Hub note request shape
- Hub note permissions
- Hub note write behavior

Tests assert the patch reports `append_admin_hub_order_note_touched:false`.

## 9. Test coverage

Added harness:

`node scripts/migration/run-g39l-admin-orders-limited-native-primary-tests.mjs`

Fixture cases covered:

1. Safe one-time reconciled native row becomes admin primary.
2. Safe one-time native-born row becomes admin primary.
3. Hub-primary default remains for ambiguous row.
4. Row with status mismatch remains Hub-primary.
5. Row with payment mismatch remains Hub-primary.
6. Row with delivery schedule mismatch remains Hub-primary.
7. Refunded row remains Hub-primary/payment source-of-truth.
8. Cancelled row remains Hub-primary.
9. Subscription row remains Hub-primary.
10. Multi-delivery row remains Hub-primary.
11. Repair/replay row remains Hub-primary/manual review.
12. Hub-only row remains Hub-primary.
13. Native-only row is retained and classified carefully.
14. Native missing / Hub available remains Hub-primary.
15. `appendAdminHubOrderNote` remains untouched.
16. Response shape remains backward-compatible.
17. No customer email/phone is newly exposed.
18. No raw Hub/Shopify/Stripe/provider payloads are returned.
19. `writes_performed:false`.
20. `provider_call_impact:false`.
21. `notifications_sent:false`.
22. `hub_mutation_performed:false`.
23. No logs/queues are created.
24. `customer_facing_behavior_changed:false`.
25. G39J diagnostics metadata remains present.

Regression checks include G39J, G39B, G39D, G39F, G39H, G33, G35, G36, and G27 harnesses where relevant.

## 10. No-write policy

G39L remains read-only aggregation.

It does not:

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

If G39L causes admin order display issues after publish:

1. Revert the `getAdminOrdersWithHub` G39L patch.
2. Publish only `getAdminOrdersWithHub`.
3. No data repair should be required because the patch is read-only.
4. Hub fallback remains active throughout rollback.
5. `appendAdminHubOrderNote` should not require rollback because it was not changed.

## 12. Next phase recommendation

After PR audit and merge, run a separate G39L closeout/publish phase:

1. publish only `getAdminOrdersWithHub`
2. verify live source markers
3. boundary verify GET/unauth/admin-auth behavior
4. run a safe live admin orders call and inspect only metadata/counts
5. smoke `/admin/orders`
6. perform no-write verification

If live eligibility selects too many rows or exposes unexpected blockers, hold before further admin orders cutover.
