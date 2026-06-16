# G39K: Admin Orders Limited Native-Primary Plan

## 1. Executive summary

G39K defines the safe subset rules for a future limited native-primary admin orders patch.

This is a docs-only plan. It does not change `getAdminOrdersWithHub`, `AdminOrders.jsx`, customer-facing order surfaces, Hub writes, or `appendAdminHubOrderNote`.

G39J proved that admin orders diagnostics are live while preserving Hub-first behavior. The next step is not full native-first. The safe path is a restricted G39L runtime patch where only a narrow class of one-time, fully reconciled, no-mismatch rows can become native-primary for admin display. All refund, subscription, repair/replay, Hub-only, native-missing, payment-risk, and mismatch rows must remain Hub-primary or manual-review governed.

Recommended G39L scope:

- keep current Hub-first merge as default
- make only safe one-time reconciled rows admin-native-primary
- keep Hub fallback active
- preserve `/admin/orders` response shape
- keep `appendAdminHubOrderNote` untouched
- keep customer-facing surfaces held
- perform no writes, provider calls, notifications, sync, repair, replay, inventory deduction, or PurchaseOrder automation

## 2. G39J live diagnostics evidence

G39J is merged, published, and live.

| Field | Live result |
| --- | --- |
| Runtime function | `getAdminOrdersWithHub` |
| Classification | `admin_orders_mismatch_diagnostics_live` |
| `admin_orders_diagnostics_enabled` | `true` |
| `native_first_enabled` | `false` |
| `hub_first_enabled` | `true` |
| `hub_fallback_active` | `true` |
| `writes_performed` | `false` |
| `provider_call_impact` | `false` |
| `notifications_sent` | `false` |
| `hub_mutation_performed` | `false` |
| `append_admin_hub_order_note_touched` | `false` |
| Merged row count | 27 |
| Hub row count | 15 |
| Native ShopifyOrder row count | 10 |
| Native FulfillmentTask row count | 3 |
| Local Customer App Order row count | 17 |
| Mismatch count | 4 |
| Review-required count | 15 |

Live mismatch categories:

| Category | Count | Cutover impact |
| --- | ---: | --- |
| `fulfillment_mismatch` | 1 | blocks broad native-first |
| `status_mismatch` | 1 | blocks broad native-first |
| `delivery_schedule_mismatch` | 3 | blocks broad native-first unless exact native date authority is proven |

Live source-of-truth holds showed Hub/manual-review/payment contexts still matter:

- Hub source-of-truth rows remain active.
- Manual-review rows remain active.
- Payment-provider/Hub source-of-truth rows remain active.
- Native-only rows exist but are not automatically customer-facing safe.

The live result supports a limited subset plan only.

## 3. Why full native-first is not ready

Full native-first admin orders is not ready because G39J found active mismatch and review classes in the same high-traffic surface that drives admin operations.

Blocking facts:

- `mismatch_count:4` is non-zero.
- `review_required_count:15` is high relative to `merged_row_count:27`.
- Mismatch categories include status, fulfillment, and delivery schedule.
- Refund/cancel/payment-not-ready behavior remains Hub/payment-governed.
- Subscription and multi-delivery behavior remains Hub-governed.
- Repair/replay/safeSync rows remain manual-review/log-governed.
- Hub-only rows still exist.
- Some native rows are useful admin context but not customer-facing truth.
- `appendAdminHubOrderNote` remains a separate write-capable Hub action and must not be coupled to source-priority changes.

G39J diagnostics-only was the correct step because it exposed row-level source, mismatch, fallback, and review categories without changing operator-visible truth, write behavior, or customer-facing state.

## 4. Safe native-primary subset rules

A future G39L row may become admin-native-primary only when **all** rules below are true.

Required order class:

- order is one-time
- not subscription
- not multi-delivery
- not refunded
- not cancelled
- not payment-not-ready
- not repair/replay/safeSync governed
- not unknown/ambiguous identity

Required records:

- Customer App Order exists
- native ShopifyOrder exists
- native FulfillmentTask exists when the admin row displays operational task/status context
- no OrderReviewQueue blocker exists
- no native sync/review blocker exists

Required payment state:

- payment status is paid
- payment captured is true
- no refund/cancellation/payment hold exists
- no payment or financial mismatch exists

Required parity:

- `mismatch_fields` is empty
- `review_required:false`
- status fields match or native reconciliation is explicitly proven
- fulfillment, production, and delivery statuses are internally consistent
- delivery/schedule dates match, or an exact corrected native date has been separately proven authoritative
- line item count matches, or the accepted native mirror/task packet proves the native line item count
- total/financial fields do not conflict where they are shown

Required safety metadata:

- `customer_facing_safe:true` only for admin display context in G39L, not for customer-facing order history/tracker
- `provider_call_impact:false`
- `notifications_sent:false`
- `hub_mutation_performed:false`
- `writes_performed:false`

Candidate row classes:

| Candidate class | G39L eligibility |
| --- | --- |
| Completed one-time order fully reconciled through native flow | eligible if no mismatches and no review/payment/repair/subscription hold |
| One-time late mirror with native ShopifyOrder + FulfillmentTask | eligible only if mismatch count is zero and it is admin display context only |
| Native-born one-time order with complete native records | eligible if Hub has no conflict and payment/task/status parity is clean |

Rows must not become native-primary merely because native records exist.

## 5. Hub-primary hold rules

Rows must remain Hub-primary or manual-review governed when any rule below is true.

| Condition | Required classification |
| --- | --- |
| refunded or refund-related | `hub_payment_source_of_truth` |
| cancelled | `hub_payment_source_of_truth` or `hub_primary_required` |
| payment pending, failed, or not captured | `hub_payment_source_of_truth` |
| subscription or multi-delivery | `hub_subscription_source_of_truth` |
| Hub-only row | `hub_primary_required` |
| native missing / Hub available | `native_not_ready` |
| native ShopifyOrder missing | `native_not_ready` |
| native FulfillmentTask missing where task context is needed | `native_not_ready` |
| `mismatch_fields` not empty | `manual_review_required` |
| `review_required:true` | `manual_review_required` |
| safeSync/repair/replay context | `hub_repair_replay_source_of_truth` |
| OrderReviewQueue blocker | `manual_review_required` |
| delivery schedule mismatch not reconciled | `manual_review_required` |
| status mismatch not reconciled | `manual_review_required` |
| fulfillment/payment/financial mismatch | `manual_review_required` |
| customer-facing risk | `hub_primary_required` |
| unknown/ambiguous identity | `manual_review_required` |

Do not hide Hub-only rows. Do not convert Hub-only rows into native rows. Do not infer native truth from partial native context.

## 6. Source-of-truth by order class

| Order class | Source-of-truth policy |
| --- | --- |
| One-time active paid/captured | native primary only when native ShopifyOrder/FulfillmentTask parity is proven and no mismatches exist |
| One-time completed/reconciled | native primary may be safe for admin display if native delivered/status/payment parity is proven |
| Late/historical mirror | native can be primary for admin mirror fields only when no mismatches exist; not production lifecycle proof |
| Refund/cancel/payment-not-ready | Hub/payment source of truth remains |
| Subscription/multi-delivery | Hub source of truth remains |
| Repair/replay/safeSync | Hub/log/manual-review governed |
| Hub-only | Hub primary remains |
| Native-only | retained and classified carefully; not customer-facing truth by default |
| Unknown | Hub-primary/manual review |

Customer-facing order history/tracker behavior remains out of scope for G39L.

## 7. Future G39L runtime patch scope

G39L should be a narrow runtime patch to `getAdminOrdersWithHub` only.

Preferred G39L algorithm:

1. Preserve current reads and current Hub-first merge as the default path.
2. Decorate rows with the existing G39J diagnostics.
3. Evaluate each row against the safe native-primary subset rules.
4. If a row is eligible, choose the native row/context as the admin primary display row.
5. If a row is ineligible, preserve the current Hub-primary row.
6. Preserve Hub fallback for all rows.
7. Preserve existing `/admin/orders` response shape.
8. Add only safe, additive metadata.
9. Never write records.
10. Never call providers.
11. Never send notifications.
12. Never change customer-facing surfaces.
13. Never touch `appendAdminHubOrderNote`.

Future top-level additive metadata:

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
- `review_required_count`
- `customer_facing_behavior_changed:false`
- `writes_performed:false`
- `provider_call_impact:false`
- `notifications_sent:false`
- `hub_mutation_performed:false`
- `append_admin_hub_order_note_touched:false`

Future per-row additive metadata:

- `admin_primary_source`: `native`, `hub`, or `local_customer_app`
- `native_primary_eligible:true/false`
- `native_primary_reason`
- `native_primary_blockers`
- `source_of_truth`
- `mismatch_fields`
- `review_required`
- `customer_facing_safe`
- `write_path_not_in_scope:true`

G39L should not change:

- customer-facing order functions
- Hub note behavior
- refund behavior
- subscription behavior
- payment source-of-truth behavior
- Hub writes
- row fields consumed by `AdminOrders.jsx`

## 8. Future test plan

Future harness:

`scripts/migration/run-g39l-admin-orders-limited-native-primary-tests.mjs`

Required test cases:

1. Safe one-time reconciled native row becomes admin primary.
2. Safe one-time native-born row becomes admin primary.
3. Row with status mismatch remains Hub-primary.
4. Row with payment mismatch remains Hub-primary.
5. Row with delivery schedule mismatch remains Hub-primary.
6. Refunded row remains Hub-primary/payment source-of-truth.
7. Cancelled row remains Hub-primary.
8. Subscription row remains Hub-primary.
9. Multi-delivery row remains Hub-primary.
10. Repair/replay row remains Hub-primary/manual review.
11. Hub-only row remains Hub-primary.
12. Native-only row is retained but classified carefully.
13. Native missing / Hub available remains Hub-primary.
14. `appendAdminHubOrderNote` remains untouched.
15. Response shape remains backward-compatible.
16. No customer email/phone is newly exposed.
17. No raw Hub/Shopify/Stripe/provider payloads are returned.
18. `writes_performed:false`.
19. `provider_call_impact:false`.
20. `notifications_sent:false`.
21. `hub_mutation_performed:false`.
22. No logs/queues are created.
23. `customer_facing_behavior_changed:false`.

Regression harnesses:

- G39J diagnostics harness
- G39B parity harness
- G39D delivery route harness
- G39F production planning harness
- G39H calendar harness
- G33C mirror/task harnesses
- G35 refund harnesses
- G36 subscription harnesses
- G27 cutover harness
- scoped ESLint
- `npm run build`

## 9. Risk assessment

Low-risk aspects:

- limited subset only
- admin-only display behavior
- Hub fallback retained
- G39J diagnostics already live
- no write behavior required

Medium-risk aspects:

- admin orders is high-traffic
- response shape is used by several admin flows
- status, fulfillment, and delivery schedule mismatches exist
- review-required count is high
- native-only rows may be admin-useful but not customer-facing truth

High-risk / hard stops:

- full native-first admin orders
- changing customer-facing order history/tracker
- disabling Hub fallback
- suppressing Hub writes
- treating refunds as native-authoritative
- treating subscriptions as native-authoritative
- hiding Hub-only rows
- exposing new PII or raw payloads
- triggering `appendAdminHubOrderNote`
- mutating records
- creating logs/queues
- provider calls
- notifications
- sync/repair/replay

## 10. Hard stops

Do not proceed with G39L if the implementation requires any of the following:

- customer-facing order history or tracker changes
- write-path changes
- Hub write suppression
- Hub fallback removal
- refund/cancel/payment source-of-truth changes
- subscription/multi-delivery source-of-truth changes
- hiding active Hub-only rows
- exposing raw Hub/Shopify/Stripe/provider payloads
- exposing new customer email/phone/address fields beyond the current admin contract
- changing `appendAdminHubOrderNote`
- inventory deduction
- PurchaseOrder automation
- notifications
- provider calls
- broad native-first behavior

## 11. Recommendation

Proceed to G39L only as a limited native-primary runtime patch for safe one-time rows where diagnostics show:

- no mismatches
- `review_required:false`
- Customer App Order exists
- native ShopifyOrder exists
- native FulfillmentTask exists when task context is displayed
- payment/capture state is clean
- no refund/cancel/subscription/repair context exists
- no OrderReviewQueue blocker exists
- Hub fallback remains available

If G39L cannot identify enough safe rows without broad assumptions, do not patch source priority. Instead keep diagnostics-only behavior or add a stricter preview mode before runtime source-priority changes.
