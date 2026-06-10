# G35K Full Refund Pre-Production Preview Hardening

## 1. Executive summary

G35K hardens the read-only `NATIVE_REFUND_IMPACT` preview for full refunds before production begins.

The preview now separates lifecycle status from refund/payment state. It does not propose `Order.status=refunded`, `Order.status=cancelled`, or `Order.status=canceled`. Full refund preview uses refund-specific fields in preview output only.

Hub remains the refund source of truth. No native full refund command exists or is approved.

## 2. Scope

Runtime changed:

- `base44/functions/previewNativeOrderCutoverReadiness/entry.ts`

Validation added:

- `scripts/migration/run-g35k-full-refund-preproduction-preview-tests.mjs`

Fixture expectations updated:

- `docs/migration/fixtures/refund-impact/fixtures.json`

No schema changes are included in G35K.

## 3. Full refund lifecycle policy

Full refund preview remains read-only for every lifecycle stage.

| Lifecycle stage | Preview classification | Expected impact |
| --- | --- | --- |
| paid order before native ops | `native_refund_preview_ready_full_refund_pre_production` | refund-specific Customer App Order field impact only; no task or batch impact |
| native ShopifyOrder created, no task | `native_refund_preview_ready_full_refund_pre_production` | native payment/refund field impact; no task or batch impact |
| native FulfillmentTask pending, no batch | `full_refund_preview_ready_task_cancellation_impact` | task cancellation impact preview only, canonical `cancelled`, no write |
| ProductionBatch planned, not started | `full_refund_preview_ready_batch_recalculation_impact` | order source removal and planned-unit recalculation preview only, no write |
| production started | `production_started_manual_review_required` | manual review; no automatic cancellation |
| production completed | `production_completed_manual_review_required` | manual review; no automatic cancellation |
| production verified / compliance logged | `production_verified_manual_review_required` | preserve ProductionBatch and BatchComplianceLog history |
| delivered / fulfilled | `delivered_refund_manual_review_required` | do not auto-cancel; preserve production and compliance history |
| duplicate event | `duplicate_refund_event_detected` | idempotent skip/review; no write |
| unknown order | `unknown_order_review_required` | review queue impact preview only |
| already refunded / terminal | `already_refunded_or_terminal_review_required` | review required; no second automatic mutation |

## 4. Refund-specific field model

G35K continues the G35C/G35G policy:

- Customer App `Order.status` stays lifecycle/delivery-facing.
- Refund state lives in payment/refund-specific fields.
- Unsupported `Order.status` refund/cancel values are schema-policy notes, not preview blockers.

Previewed refund fields include:

- `refund_status`
- `refund_type`
- `refund_amount`
- `refund_currency`
- `refunded_at`
- `refund_source`
- `refund_event_id`
- `stripe_refund_id`
- `refund_reason`
- `refund_review_required`
- `refund_review_status`

G35K does not write these fields.

## 5. Early-state expected impacts

### Before native ops

Preview should report:

- `full_refund_preview_ready:true`
- no native order/task/batch impact
- Customer App refund field impact only
- provider calls false
- notifications held

### Native order only

Preview should report:

- native ShopifyOrder refund/payment field impact
- no task or batch impact
- no Customer App lifecycle status mutation

### Task pending

Preview should report:

- task cancellation impact with canonical value `cancelled`
- `would_cancel_task:false`
- no delivery/proof/drop mutation

### Batch planned

Preview should report:

- batch order-source removal and planned-unit recalculation preview only
- `would_remove_order_sources_now:false`
- `would_recalculate_planned_units_now:false`
- no compliance mutation

## 6. Held side effects

G35K does not:

- process refunds
- call Stripe
- call Shopify
- call providers
- mutate Customer App `Order`
- mutate native `ShopifyOrder`
- mutate native `FulfillmentTask`
- mutate `ProductionBatch`
- mutate `BatchComplianceLog`
- create `OrderReviewQueue`
- create `OrderSyncLog`
- create `CommandLog`
- send notifications
- run sync, retry, repair, or replay
- deduct or restore inventory
- create or update PurchaseOrders
- mutate Hub records

## 7. Hard stops before live refund writes

No native full refund write command should be planned until all of these are true:

1. Hub refund source-of-truth role is explicitly changed or a shadow/native handoff is approved.
2. Exact order IDs are supplied.
3. Fresh preview returns stable data.
4. Refund event idempotency is clean.
5. Lifecycle stage is explicitly approved for native write behavior.
6. Notification policy remains explicit.
7. Provider-call policy remains explicit.
8. ProductionBatch and BatchComplianceLog preservation policy is honored.
9. Owner approval is recorded for the exact order/event.

## 8. Recommended next phase

Recommended next phase:

- Keep Hub refund source of truth.
- Use G35K for read-only full refund impact preview validation.
- Plan Stripe refund webhook shadow preview only after owner approval.
- Do not plan a native full refund command yet.
