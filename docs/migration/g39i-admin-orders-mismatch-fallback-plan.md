# G39I: Admin Orders Mismatch / Fallback Plan

## 1. Executive summary

G39I plans the next admin read burn-down target: `admin_orders` / `getAdminOrdersWithHub`.

Unlike the lower-risk admin read surfaces already moved native-first, admin orders is not ready for a broad native-first runtime patch. G39B classified admin orders as `ready_with_fallback_reporting`, medium risk, with sampled evidence of 10 native rows, 4 Hub-context rows, 3 mismatches, and 1 fallback-required row.

The safe G39J scope is therefore diagnostics-first:

- keep the current `getAdminOrdersWithHub` source/merge behavior
- do not make native primary yet
- add explicit admin-only mismatch/fallback metadata
- preserve Hub fallback and Hub source-of-truth classes
- use the diagnostics to decide whether a later G39K can safely make a restricted native-first subset primary

This phase is docs-only. No runtime behavior changes, no Base44 publish, no live commands, no provider calls, and no records are mutated.

## 2. G39B evidence

G39B added the read-only `ADMIN_NATIVE_FIRST_HUB_READ_PARITY` preview mode in `previewNativeOrderCutoverReadiness`.

Admin orders evidence carried forward:

| Field | Result |
| --- | --- |
| Surface | `admin_orders` |
| Runtime function | `getAdminOrdersWithHub` |
| Existing role | Hub-primary / merged with local and native context |
| Readiness | `ready_with_fallback_reporting` |
| Risk | medium |
| Sampled native rows | 10 |
| Sampled Hub-context rows | 4 |
| Mismatches | 3 |
| Fallback-required rows | 1 |
| Recommendation | Analyze mismatch/fallback contract before native-first patch |

G39B comparable fields for admin orders:

- `order_status`
- `payment_status`
- `payment_captured`
- `fulfillment_type`
- `fulfillment_status`
- `production_status`
- `delivery_status`
- `delivery_date`
- `line_item_count`
- `total_price`

G39B required native fields before admin orders can be considered safer:

- `order_number`
- `payment_status`
- `payment_captured`
- `fulfillment_type`
- `production_status`
- `delivery_status`

## 3. Current behavior audit

### Target function

`getAdminOrdersWithHub` is the active admin order list function.

No separate deployed `getAdminOrders` function was found in the Base44 functions directory. The `/admin/orders` page calls `getAdminOrdersWithHub` and also reads delivery fallback summaries from `getAdminDeliveryRouteSummary`.

### Current data sources

`getAdminOrdersWithHub` currently reads:

| Source | Entity / endpoint | Purpose |
| --- | --- | --- |
| Customer App Order | `Order.list('-created_date', 500)` | local order rows, payment/status/filtering context |
| Native task | `FulfillmentTask.list('-created_date', 500)` | local subscription expansion and native task context |
| Native Shopify mirror | `ShopifyOrder.list('-created_date', 500)` | native operational mirror rows/context |
| Native sync logs | `OrderSyncLog.list('-created_date', 500)` | native/Hub sync context only |
| Review queue | `OrderReviewQueue.list('-created_date', 500)` | unresolved review context only |
| User profile | `UserProfile.list('-created_date', 500)` | contact email alias, current admin-visible name/phone/address enrichment |
| Hub read | `getOrderUpdatesForCustomerApp?email=...` | Hub operational source and subscription fulfillment expansion |

The function does not create, update, delete, upsert, sync, repair, retry, notify, call Stripe, or call Shopify. It does perform Hub reads when Hub config exists.

### Current source priority

The current merge order is explicitly Hub-first:

1. Fetch local Customer App orders and filter superseded/cancelled/ghost pre-orders.
2. Fetch FulfillmentTasks for subscription expansion and native task context.
3. Fetch native ShopifyOrder rows for native operational context.
4. Fetch UserProfiles to resolve Hub query emails and existing admin-visible labels.
5. Query Hub for each customer email alias.
6. Expand Hub subscription/multi-delivery rows into fulfillment-level display records.
7. Filter cancelled Hub rows and locally-cancelled order numbers.
8. Expand local subscription orders via FulfillmentTask rows.
9. Map native ShopifyOrder rows into admin order shape.
10. Seed merged map with Hub rows first.
11. Add native rows only when no Hub row exists for the normalized order number.
12. Add local Customer App rows only when no Hub row exists for the normalized order number.
13. Attach Customer App, native mirror/task, Hub sync, and review queue context to the surviving row.
14. Sort by `created_date` descending.

### Current dedupe / merge keys

Current dedupe uses normalized `order_number` as the primary row key:

- strips leading `#`
- trims whitespace
- lowercases

Native context can also attach by:

- `native_shopify_order_id`
- `native_base44_order_id` / Customer App order id
- normalized order number

FulfillmentTask context can attach by:

- Customer App order id
- native ShopifyOrder id
- order number / Shopify order number

### Current response shape

Top-level response currently includes:

- `success`
- `total`
- `local_count`
- `hub_count`
- `native_shopify_order_count`
- `orders`

Rows can include, depending on source:

- `id`
- `order_number`
- `customer_email`
- `customer_name`
- `status`
- `payment_status`
- `financial_status`
- `total`
- `subtotal`
- `delivery_fee`
- `fulfillment_type`
- `delivery_address`
- `contact_phone`
- `estimated_delivery_date`
- `created_date`
- `items`
- `notes`
- `is_hub_order`
- `hub_order_id`
- `hub_fulfillment_number`
- `hub_customer_email`
- `hub_operational_status`
- `hub_fulfillment_status`
- `hub_sync_summary`
- `production_date`
- `assigned_delivery_date`
- `delivery_window_label`
- `delivered_at`
- `delivered_by`
- `delivery_photo_url`
- `delivery_drop_location`
- `source_channel`
- `stripe_subscription_id`
- `hub_updated_date`
- `has_customer_app_order`
- `customer_app_order_id`
- `customer_app_order_status`
- `customer_app_payment_status`
- `customer_app_payment_captured`
- `customer_app_fulfillment_type`
- `customer_app_estimated_delivery_date`
- `customer_app_line_item_count`
- `has_native_order`
- `is_native_order`
- `native_shopify_order_id`
- `native_base44_order_id`
- `native_order_number`
- `native_payment_status`
- `native_production_status`
- `native_fulfillment_status`
- `native_sync_status`
- `native_review_status`
- `native_source_channel`
- `native_source_type`
- `native_order_type`
- `native_order_lock_status`
- `native_line_item_count`
- `native_total`
- `native_fulfillment_task_summary`
- `has_native_task`
- `native_task_incomplete_metadata`
- `native_task_missing_metadata_fields`
- `native_latest_sync_log`
- `native_review_queue_summary`
- `admin_context_guidance`
- `admin_context_badges`

### Admin UI consumers

`src/pages/AdminOrders.jsx` consumes the current shape directly.

Important UI dependencies:

- `OrderCard` renders `order_number`, `status`, `fulfillment_type`, badges, customer label, `customer_email`, delivery date, item summary, and `total`.
- Expanded order detail renders customer name, email, phone, address, items, notes, Hub context, native context, fulfillment tasks, timeline, and frozen Customer App workflow controls.
- `AdminOrderSourceDiagnostics` displays `local_count`, `hub_count`, `native_shopify_order_count`, and delivery fallback counts.
- `/admin/orders` also calls `getAdminDeliveryRouteSummary` for native delivery fallback rows and merges them client-side only when the primary admin orders query lacks a matching order number.
- The UI refreshes `admin-orders` after delivery/production actions elsewhere, but G39I/G39J must not add order writes.

### Existing write-capable UI adjacent to admin orders

`AdminOrders.jsx` includes `InternalHubNoteComposer`, which calls `appendAdminHubOrderNote` for Hub rows. This is a separate append-only admin Hub note action and is not part of `getAdminOrdersWithHub`.

Future G39J must not touch this write path. It must not add note writes, order writes, sync writes, repair writes, notification writes, or provider calls.

### Customer-facing surfaces

Customer-facing order history/tracker functions are out of scope for G39I/G39J. They must not inherit admin-order source-of-truth decisions without separate parity proof.

## 4. Mismatch categories

G39J should classify mismatches without deciding business truth from a single row comparison.

| Category | Example fields | Native eventually wins? | Hub remains source of truth? | Review required? | Notes |
| --- | --- | --- | --- | --- | --- |
| Status mismatch | `status`, `order_status` | only for proven native-born/reconciled one-time rows | yes for subscriptions/refunds/repair cases | yes until class known | Do not change customer-facing status from this. |
| Payment status mismatch | `payment_status`, `financial_status` | no broad approval | yes | yes | Payment/refund source remains Hub/payment pipeline. |
| Payment captured mismatch | `payment_captured` | only when Customer App checkout record is authoritative and paid/captured | yes for ambiguous rows | yes | Do not fulfill payment-not-ready rows. |
| Fulfillment status mismatch | `fulfillment_status`, native task status | only after task parity is proven | yes where Hub has delivery lifecycle context | yes | Delivery/pack/bottle status has operational impact. |
| Production status mismatch | `production_status`, native batch/task state | only after exact production lifecycle proof | yes for historical/Hub-only/subscription rows | yes | Missing ProductionBatch is not command readiness. |
| Delivery status mismatch | `delivery_status`, task status | only after native delivery parity is proven | yes where proof/drop/route is Hub-owned | yes | Do not hide Hub delivery completion/proof context. |
| Delivery date mismatch | `delivery_date`, `scheduled_date`, `assigned_delivery_date` | native can win only where schedule correction parity is proven | yes for Hub-only/subscription rows | yes | Stale Hub date suppression must be explicit. |
| Line item count mismatch | `line_item_count`, items length | maybe, only if native line items are complete | keep fallback until item mapping proven | yes | Subscription fulfillment expansion can change count semantics. |
| Total/financial mismatch | `total_price`, `total`, `subtotal`, fees | no broad approval | yes | yes | Totals touch payment/refund semantics. |
| Native missing / Hub available | absent native mirror/task | no | yes | maybe | Hub fallback row must remain visible. |
| Hub missing / native available | native-only mirror/order | yes for admin visibility if safe | fallback not needed | maybe | Does not imply customer-facing cutover. |
| Historical late mirror | historical/native backfill row | admin mirror fields can be native primary | Hub may remain context | yes for lifecycle | Must not imply live lifecycle repeatability. |
| Refunded/cancelled/payment-not-ready | refund/cancel/payment fields | no | yes | yes | Native-first not approved. |
| Subscription/multi-delivery | parent/occurrence rows | no | yes | yes | Hub source of truth remains. |
| SafeSync / repair / replay | `OrderSyncLog`, `SafeSyncParityLog`, review queue | no | yes | yes | Logs remain authoritative until dedicated parity exists. |
| Hub dedupe-only context | Hub row fetched via contact/auth alias | no source flip | yes | no if matched | Keep dedupe stable. |
| Native mirror-only context | native mirror without Hub row | limited admin visibility | no Hub row | yes if active/order-critical | Good candidate for diagnostics, not broad cutover. |

## 5. Admin orders row contract

A future native-first or diagnostics patch must preserve the existing admin order row contract. Additive metadata is allowed; field removal/rename is not.

### Existing/admin-safe fields to preserve

- `order_number`
- `customer_app_order_id`
- `native_shopify_order_id`
- `native_fulfillment_task_id` through task summary where present
- `hub_order_id` where currently shown for Hub rows
- `status`
- `payment_status`
- `financial_status`
- `payment_captured` / `customer_app_payment_captured`
- `fulfillment_type`
- `fulfillment_status`
- `native_fulfillment_status`
- `production_status`
- `native_production_status`
- `delivery_status`
- `order_type`
- `source_channel`
- `source_type`
- `line_item_count` / item list length
- `total` / `subtotal` / `delivery_fee` where already admin-visible
- `delivery_date` / `estimated_delivery_date`
- `production_date`
- `scheduled_date` through task summaries where present
- `assigned_delivery_date`
- `created_date`
- `hub_sync_summary`
- `native_latest_sync_log`
- `native_review_queue_summary`
- `admin_context_guidance`
- `admin_context_badges`
- `data_source` / fallback metadata if added
- `warnings` / `blockers` if added

### Current limited admin/customer context

The current admin orders page already displays customer labels, email, phone, and delivery address in an admin-only context. A future patch must not expand that contract, and read previews should continue to withhold raw provider/payment/proof payloads.

### Do not newly expose

- customer email beyond the current admin orders contract
- phone beyond the current admin orders contract
- full address beyond the current admin orders contract
- raw Hub payload
- raw Shopify payload
- raw Stripe/payment payload
- secrets/auth values
- raw proof/drop payload
- provider IDs beyond safe existing admin identifiers

## 6. Source-of-truth rules by order class

| Order class | Source-of-truth decision | Native-first eligibility | Required fallback/review |
| --- | --- | --- | --- |
| One-time active paid/captured | Native can become primary only after mirror/task parity is proven or the order is native-born. | possible later, not broad G39J | Hub fallback and mismatch reporting required. |
| One-time completed/delivered | Native can be admin-primary if delivered/status/payment fields are reconciled. | possible restricted subset | Delivery/proof/drop fallback remains if Hub-only. |
| Late/historical mirrors | Native can be primary for admin mirror fields. | admin-only only | Must not trigger production lifecycle assumptions. |
| Refunded/cancelled/payment-not-ready | Hub/payment/refund source remains active. | no | Review/Hub source-of-truth. |
| Subscriptions/multi-delivery | Hub source of truth remains active. | no | Parent/occurrence identity remains high risk. |
| POS/event rows | Must remain separated from app delivery lifecycle. | maybe admin-only, if POS native row is complete | Do not route into production/delivery candidate flow. |
| Repair/replay/safeSync exceptions | Hub/source logs remain authoritative. | no | Manual review/fallback. |
| Unknown/ambiguous | Hub fallback or manual review. | no | Do not infer. |

## 7. Native-first strategy options

### Option A — Native-first with Hub fallback row enrichment

Native Customer App Order / ShopifyOrder / FulfillmentTask rows become primary; Hub fills missing/incomplete display fields.

- Risk: medium/high for admin orders.
- Value: high.
- Blocker: G39B found mismatches; refunds/subscriptions/repair remain Hub-dependent.
- Recommendation: not first.

### Option B — Native-first only for proven one-time orders

Only one-time paid/captured rows with native-born or proven mirror/task parity become native-primary. Hub fallback remains for all other rows.

- Risk: lower.
- Value: meaningful for the eventual one-time order cutover.
- Blocker: needs diagnostics to identify safe class boundaries.
- Recommendation: possible G39K after G39J diagnostics.

### Option C — Native-first for completed/historical mirrors only

Native mirror rows can be admin-primary for completed/historical records like prior controlled mirrors.

- Risk: low.
- Value: limited because it does not prove active operations.
- Blocker: can mislead if treated as lifecycle proof.
- Recommendation: use only as explicit historical/admin context.

### Option D — Hub-primary with better mismatch reporting

Keep current source behavior and add explicit mismatch/fallback diagnostics.

- Risk: lowest.
- Value: high for decision-making.
- Blocker: requires runtime metadata patch but no source flip.
- Recommendation: preferred G39J.

### Option E — Full admin orders native-first

Make all admin order rows native-primary.

- Risk: high.
- Value: high but premature.
- Blocker: refunds, subscriptions, repair/replay, payment status, and Hub-only rows remain unsafe.
- Recommendation: do not do this now.

## 8. Recommended G39J scope

Preferred G39J:

- Patch `getAdminOrdersWithHub` to add admin-only mismatch/fallback reporting.
- Keep the existing Hub-first merge/source behavior.
- Keep Hub fallback active.
- Do not make native primary yet.
- Do not change `AdminOrders.jsx` unless it can safely display additive diagnostics without altering order behavior.
- Return top-level diagnostics and per-row metadata only.
- Use G39J output to decide whether G39K can safely target Option B: native-first only for proven one-time rows.

G39J should not:

- flip all admin orders native-first
- change customer-facing order history/tracker behavior
- suppress Hub writes
- disable Hub fallback
- hide Hub-only rows
- alter payment/refund/subscription semantics
- change or remove the append-only Hub note action

## 9. Future mismatch/fallback metadata contract

### Top-level metadata

Future G39J should add safe additive fields:

- `admin_orders_diagnostics_enabled:true`
- `native_first_enabled:false`
- `native_row_count`
- `hub_fallback_row_count`
- `fallback_required`
- `fallback_reasons`
- `mismatch_count`
- `mismatch_categories`
- `native_missing_count`
- `hub_only_count`
- `native_only_count`
- `customer_facing_hold:true`
- `writes_performed:false`
- `provider_call_impact:false`
- `notifications_sent:false`
- `hub_mutation_performed:false`

### Per-row metadata

Future G39J should add safe additive row fields where applicable:

- `data_source`
  - `customer_app_native`
  - `native_with_hub_fallback_context`
  - `hub_fallback`
  - `hub_source_of_truth`
- `fallback_source`
- `fallback_reason`
- `mismatch_fields`
- `native_primary:false` for G39J unless a row is already native-only under current behavior
- `hub_fallback_used:true/false`
- `review_required:true/false`
- `customer_facing_safe:false` for ambiguous/mismatched rows
- `warnings`

Response shape must remain backward-compatible.

## 10. Future G39J test plan

Future harness:

`scripts/migration/run-g39j-admin-orders-native-first-mismatch-tests.mjs`

Planned tests:

1. Native and Hub rows match -> current primary preserved, diagnostic says match.
2. Native missing, Hub available -> Hub fallback retained.
3. Hub missing, native available -> native-only row retained.
4. Status mismatch -> `mismatch_fields` includes `status` / `order_status`.
5. Payment mismatch -> Hub/payment source-of-truth hold.
6. Payment captured mismatch -> review/fallback metadata.
7. Delivery date mismatch -> fallback/review metadata.
8. Line item mismatch -> mismatch metadata, no item write recommendation.
9. Total mismatch -> payment/financial hold.
10. Late mirror order -> admin native context allowed, not production candidate.
11. Refunded order -> Hub/payment source-of-truth.
12. Cancelled/payment-not-ready order -> Hub/payment source-of-truth or pending tab only.
13. Subscription order -> Hub source-of-truth.
14. Repair/replay row -> manual review/fallback.
15. Hub-only active row remains visible.
16. Duplicate Hub/native row dedupes exactly as today.
17. Response shape remains backward-compatible.
18. No customer email/phone newly exposed beyond current admin contract.
19. No raw Hub/Shopify/Stripe/payment/proof payloads.
20. `writes_performed:false`.
21. `provider_call_impact:false`.
22. `notifications_sent:false`.
23. `hub_mutation_performed:false`.
24. No logs/queues created.
25. Append-only Hub note path is untouched.

Regression harnesses:

- G39B parity harness
- G39D delivery route harness
- G39F production planning harness
- G39H calendar harness
- G33C mirror/task harnesses
- G35 refund harnesses if payment/refund classification is touched
- G36 subscription harnesses if subscription classification is touched
- G27 cutover harness if shared preview logic is touched
- scoped ESLint
- `npm run build`

## 11. Risk assessment

### Low-risk

- Admin-only diagnostics.
- Read-only metadata.
- No source priority flip.
- Hub fallback stays active.

### Medium-risk

- Admin orders is high-traffic and high-visibility.
- Rows combine Customer App Order, native ShopifyOrder, FulfillmentTask, Hub, refund, subscription, repair, and delivery/proof context.
- G39B found mismatches.
- Multiple UI panels consume the row shape.
- Current UI displays admin-only customer contact/address context, so future changes must not expand exposure.

### High-risk / hard stops

- Customer-facing order history/tracker changes.
- Disabling Hub fallback.
- Suppressing Hub writes.
- Treating refunds as native-authoritative.
- Treating subscriptions as native-authoritative.
- Hiding Hub-only orders.
- Exposing raw payloads or expanding PII exposure.
- Changing payment/refund status semantics.
- Mutating records.
- Calling providers.
- Sending notifications.
- Creating logs/queues.
- Running sync/repair/replay.

## 12. Hard stops

Stop before runtime patch if G39J would require any of these:

- changing customer-facing order history/tracker behavior
- changing `AdminOrders.jsx` action/write behavior
- disabling Hub fallback
- suppressing Hub writes
- hiding Hub-only rows
- changing payment/refund authority
- changing subscription/multi-delivery authority
- changing append-only Hub note semantics
- exposing raw Hub/Shopify/Stripe/payment/proof payloads
- adding record writes, logs, queues, sync, repair, replay, provider calls, notifications, inventory deduction, or PurchaseOrders

## 13. Recommendation

Proceed to G39J as a narrow diagnostics-only runtime patch:

- target `getAdminOrdersWithHub`
- preserve current Hub-first merge/source behavior
- add explicit mismatch/fallback metadata
- keep response fields backward-compatible
- keep Hub fallback active
- keep `native_first_enabled:false`
- keep customer-facing surfaces held
- use results to decide whether G39K can safely implement Option B for proven one-time native/reconciled rows

Do not proceed directly to full native-first admin orders.
