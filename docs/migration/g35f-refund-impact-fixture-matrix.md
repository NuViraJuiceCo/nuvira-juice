# G35F Refund Impact Fixture Matrix

## 1. Executive summary

G35F expands native refund impact coverage with a synthetic fixture matrix and a local read-only harness.

This phase does **not** change runtime code or schemas. It does not process refunds, call Stripe, call Shopify, call providers, mutate records, create logs or queues, send notifications, open gates, publish Base44, or change Hub behavior.

The goal is to prove that the current read-only `NATIVE_REFUND_IMPACT` preview is covered across refund lifecycle stages before any refund schema patch or native refund write command is considered.

Current result:

- Fixture count: 20 synthetic fixtures.
- Harness: `scripts/migration/run-g35f-refund-impact-fixtures.mjs`.
- Fixture file: `docs/migration/fixtures/refund-impact/fixtures.json`.
- Runtime code changed: no.
- Schema changed: no.
- Live data touched: no.

## 2. Existing refund coverage inventory

### Existing G35B harness

`run-g35b-native-refund-impact-preview-tests.mjs` covers the primary read-only refund preview path:

- Full refund before production.
- Partial refund review-only behavior.
- Duplicate Stripe event id detection.
- Unknown order review requirement.
- Delivered order manual review.
- Verified production/compliance history preservation.
- Inventory and PurchaseOrder reversal not proposed when those systems have not run.
- Unsupported `Order.status` refund/cancel values surfaced as blockers.
- Notifications held.
- Provider calls false.
- No writes.

### Existing G35D harness

`run-g35d-refund-batch-compliance-linkage-tests.mjs` covers refund preview linkage for ProductionBatch and BatchComplianceLog rows:

- Six linked verified ProductionBatch rows.
- Six linked locked BatchComplianceLog rows.
- Linkage through direct ids, order sources, deterministic native batch ids, task/native order ids, and safe product/date fallback for compliance only.
- No date-only false positives.
- No customer name/email fuzzy matching.
- No writes.

### Fixture gap before G35F

Before G35F there was no durable synthetic fixture matrix under `docs/migration/fixtures` for refund impact scenarios. The G35B/G35D harnesses had inline test objects, but no reusable fixture list for policy review or future parity expansion.

## 3. Fixture list

All fixtures are synthetic. They do not contain real customer PII, real Stripe payloads, raw Hub/Shopify/provider payloads, auth values, secrets, phone numbers, addresses, or real payment ids.

| Fixture | Coverage | Expected classification |
| --- | --- | --- |
| `full_refund_before_native_ops` | Paid Customer App order before native ops. | Low risk preview, blocked by current status schema gap. |
| `full_refund_after_native_order_created` | Native ShopifyOrder exists, no task/batch. | Low risk preview, native payment/refund impact visible, blocked by schema gap. |
| `full_refund_after_task_created` | FulfillmentTask exists before batches. | Review required; task cancellation impact preview only; no task mutation. |
| `full_refund_after_production_batches_planned` | Planned batches exist. | Review required; batch source-removal/recalculation preview only; no write. |
| `full_refund_after_production_started` | Batches in progress. | High-risk manual review; no batch mutation. |
| `full_refund_after_production_completed_pending_verification` | Production complete, not verified. | High-risk manual review; no batch mutation. |
| `full_refund_after_verified_logged` | Verified batches and locked compliance log. | Manual review; preserve production/compliance history. |
| `full_refund_after_task_packed_order_bottled` | Task packed, order bottled. | Review required; no automatic cancellation. |
| `full_refund_after_delivered` | Delivered/fulfilled with verified history. | `do_not_auto_cancel`; delivered refund manual review required. |
| `partial_refund_any_stage` | Partial refund. | Review queue recommendation only; no task/order/batch mutation. |
| `duplicate_refund_event` | Same synthetic Stripe event already logged. | Duplicate/skip preview; future command should skip idempotently. |
| `unknown_order_refund` | No matching Customer App/native order. | Unknown order review required. |
| `missing_stripe_event_id` | Matching order but no Stripe event id. | Preview allowed; future command requires stronger idempotency policy. |
| `missing_order_identity` | Refund event has no usable order id/number. | Unknown order review required. |
| `subscription_refund` | Subscription-like order. | Unsupported subscription refund; review required. |
| `multi_delivery_refund` | Multi-delivery fulfillment mode. | Unsupported by one-time refund policy; review required. |
| `cancelled_or_already_refunded_order` | Already-refunded payment state. | No automatic mutation; schema gap remains surfaced. |
| `schema_gap_customer_order_status_refunded` | Explicit schema gap fixture. | `Order.status=refunded/cancelled` unsupported. |
| `verified_batches_with_locked_compliance_logs` | Multiple verified batches/logs. | Compliance history preserved; no deletion/update. |
| `inventory_po_not_run` | Inventory deduction and PO automation absent. | No inventory reversal and no PO reversal proposed. |

## 4. Lifecycle coverage table

| Lifecycle state | Covered by fixtures | Policy result |
| --- | ---: | --- |
| `before_native_ops` | yes | Preview only; no write command until schema/idempotency policy exists. |
| `native_order_created_only` | yes | Preview native payment/refund impact; no mutation. |
| `task_scheduled_or_packed` | yes | Review required; task cancellation preview only. |
| `production_batches_planned` | yes | Batch source-removal/recalculation preview only; no write. |
| `production_started` | yes | High-risk manual review. |
| `production_completed` | yes | High-risk manual review. |
| `production_verified` | yes | Preserve verified production and compliance history. |
| `task_packed` / bottled | yes | Manual review; no automatic cancellation. |
| `delivered` | yes | `do_not_auto_cancel`; delivered refund manual review required. |
| subscription/multi-delivery | yes | Unsupported by one-time preview; review required. |
| unknown order | yes | Review required. |
| duplicate event | yes | Duplicate/skip preview. |

## 5. Current schema blockers confirmed

G35F confirms the G35E policy remains active:

- Customer App `Order.status=refunded` is unsupported.
- Customer App `Order.status=cancelled` / `canceled` is unsupported.
- Native refund work should use payment/refund-specific state instead of lifecycle status.
- The current preview reports schema gaps rather than silently proposing unsupported `Order.status` mutations.

Because of these schema blockers, many full refund fixtures return `schema_gap_blocks_native_refund_command` as `next_action`. Lifecycle-specific blockers and warnings are still asserted separately.

## 6. Policy blockers confirmed

The fixture matrix confirms these policy blockers remain intentional:

- Delivered/fulfilled refunds require manual review.
- Partial refunds require review and should not auto-cancel orders, tasks, or batches.
- Subscription and multi-delivery refunds are unsupported by the one-time refund preview policy.
- Unknown order refunds require review.
- Duplicate refund events should dedupe/skip if prior success-like audit exists.
- Missing Stripe event id is not safe for a future write command without stronger idempotency.
- Notifications remain held.
- Provider calls remain false.
- Hub remains refund source of truth.

## 7. Production and compliance history policy

For verified batches and locked compliance logs, fixtures assert:

- `ProductionBatch` deletion is not proposed.
- `ProductionBatch` recalculation is not proposed for verified/compliance history.
- `order_sources` removal is not proposed for verified/compliance history.
- `BatchComplianceLog` deletion/update is not proposed.
- Compliance history is preserved.
- Manual review is required.

This matches G35D live preview behavior for the proven delivered native order lifecycle.

## 8. Inventory and PurchaseOrder policy

G35F confirms that refund impact preview does not propose inventory or PurchaseOrder reversal when those systems have not run.

Expected current behavior:

- `inventory_deducted_or_restored:false`
- `purchase_order_created_or_updated:false`
- `inventory_reversal_not_proposed`
- `purchase_order_reversal_not_proposed`

Inventory and PurchaseOrder reversal policies should not be designed until native inventory deduction and PO automation have their own approved source-of-truth, audit, and reversal contracts.

## 9. Known Hub parity questions

These cases should be compared against Hub behavior later, but not copied into native writes yet:

1. Whether Hub fully cancels a task for full refund before production.
2. Whether Hub removes planned order sources before production starts.
3. Whether Hub recalculates planned units for planned batches.
4. How Hub queues partial refund review entries.
5. How Hub handles duplicate Stripe refund events across retry windows.
6. How Hub treats refunds after production has started, completed, verified, packed, bottled, or delivered.
7. How Hub handles subscription or multi-delivery refunds.

Hub remains the refund source of truth until native preview, schema, fixture, and policy parity are stronger.

## 10. No-write guarantees

The G35F harness verifies:

- `dry_run:true`
- `writes_performed:false`
- no entity `create`, `update`, or `delete` call is made in the synthetic store
- `provider_call_impact:false`
- Stripe calls false
- Shopify calls false
- notifications held
- no notification/message rows
- no OrderReviewQueue creation
- no OrderSyncLog creation
- no CommandLog creation
- no ProductionBatch mutation
- no BatchComplianceLog mutation
- no inventory or PurchaseOrder action

The fixture file itself is synthetic and contains no real customer PII, raw provider payloads, auth values, or secrets.

## 11. Harness result

Local result at G35F PR prep:

```json
{
  "success": true,
  "fixture_count": 20,
  "passed": 20,
  "failed": 0,
  "writes_performed": false,
  "provider_call_impact": false,
  "notifications_held": true
}
```

Classification summary from the harness:

| Classification | Count |
| --- | ---: |
| `before_native_ops / low_risk_preview_only / schema_gap_blocks_native_refund_command` | 1 |
| `before_native_ops / low_risk_preview_only / unknown_order_review_required` | 2 |
| `delivered / do_not_auto_cancel / delivered_refund_manual_review_required` | 1 |
| `native_order_created_only / low_risk_preview_only / duplicate_refund_event_detected` | 1 |
| `native_order_created_only / low_risk_preview_only / schema_gap_blocks_native_refund_command` | 4 |
| `native_order_created_only / low_risk_preview_only / unsupported_subscription_refund` | 1 |
| `production_batches_planned / review_required / partial_refund_review_required` | 1 |
| `production_batches_planned / review_required / schema_gap_blocks_native_refund_command` | 2 |
| `production_completed / high_risk_manual_only / schema_gap_blocks_native_refund_command` | 1 |
| `production_started / high_risk_manual_only / schema_gap_blocks_native_refund_command` | 1 |
| `production_verified / high_risk_manual_only / schema_gap_blocks_native_refund_command` | 2 |
| `task_packed / review_required / schema_gap_blocks_native_refund_command` | 1 |
| `task_scheduled_or_packed / review_required / schema_gap_blocks_native_refund_command` | 1 |
| `task_scheduled_or_packed / review_required / unsupported_subscription_refund` | 1 |

## 12. Runtime patch assessment

No runtime patch is needed for G35F.

The fixture harness passed against the existing read-only `NATIVE_REFUND_IMPACT` implementation. No Base44 publish is needed because G35F changes only fixtures, local harness, and docs.

## 13. Recommended next phase

Recommended next phase:

1. G35G refund schema-only PR, if owner wants to add dedicated refund fields next; or
2. G35G partial refund review queue preview, if review-flow modeling should come before schema work.

Continue to keep Hub as refund source of truth. Do not design or run a native refund write command yet.
