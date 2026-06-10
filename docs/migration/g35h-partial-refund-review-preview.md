# G35H Partial Refund Review Queue Preview

## 1. Executive summary

G35H adds a read-only partial refund review queue preview to `previewNativeOrderCutoverReadiness`.

New preview mode:

```text
NATIVE_PARTIAL_REFUND_REVIEW_IMPACT
```

The preview shows the safe `OrderReviewQueue` draft that a future command could create for a partial refund review, but it does not create the row and does not mutate any entity.

Hub remains the refund source of truth. Native refund writes remain blocked.

## 2. Scope

Changed runtime:

- `base44/functions/previewNativeOrderCutoverReadiness/entry.ts`

Added validation:

- `scripts/migration/run-g35h-partial-refund-review-preview-tests.mjs`

No schema changes are included in G35H.

## 3. Inputs

Supported request body fields:

- `preview_mode: NATIVE_PARTIAL_REFUND_REVIEW_IMPACT`
- `order_number` optional
- `customer_app_order_id` optional
- `native_shopify_order_id` optional
- `stripe_event_id` optional
- `stripe_refund_id` optional
- `refund_type: partial` required
- `refund_amount` required
- `refund_currency` optional
- `refund_reason` optional
- `event_source` optional: `admin_preview`, `stripe_webhook_shadow`, or `test_fixture`
- `request_id` optional

The preview requires either order identity or refund event identity.

## 4. Read-only behavior

G35H reads only:

- Customer App `Order`
- native `ShopifyOrder`
- native `FulfillmentTask`
- `ProductionBatch`
- `BatchComplianceLog`
- `OrderReviewQueue`
- `OrderSyncLog`
- `CommandLog`
- `SafeSyncParityLog`

G35H does not:

- process refunds
- call Stripe
- call Shopify
- call providers
- update Customer App `Order`
- update native `ShopifyOrder`
- update native `FulfillmentTask`
- update `ProductionBatch`
- update `BatchComplianceLog`
- create `OrderReviewQueue`
- create `OrderSyncLog`
- create `CommandLog`
- send notifications
- create notification or message rows
- run sync, retry, repair, or replay
- deduct or restore inventory
- create PurchaseOrders
- open gates
- mutate Hub records

## 5. Partial refund policy

Partial refunds are review-only.

The preview never proposes automatic cancellation of:

- Customer App `Order`
- native `ShopifyOrder`
- native `FulfillmentTask`
- `ProductionBatch`
- `BatchComplianceLog`

The preview always keeps:

- notifications held
- provider calls false
- inventory reversal not proposed
- PurchaseOrder reversal not proposed
- Hub fallback required

Delivered orders still route to review. Verified production and locked compliance history remain preserved.

## 6. Schema policy behavior

G35G added optional refund/payment-reversal fields. G35H uses those fields in preview only:

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

G35H does not use or propose:

- `Order.status=refunded`
- `Order.status=cancelled`
- `Order.status=canceled`

Unsupported lifecycle `Order.status` refund/cancel values are returned as `status_schema_policy_notes`, not blockers, in partial refund review mode.

Expected notes:

- `customer_order_status_refund_value_unsupported_policy_note`
- `customer_order_cancelled_value_unsupported_policy_note`
- `customer_order_status_lifecycle_facing`
- `refund_state_uses_payment_refund_fields`

## 7. Proposed OrderReviewQueue draft

The preview returns a safe draft under `proposed_order_review_queue_impact.safe_queue_draft`.

Draft fields include:

- `incident_type`
- `order_number`
- `customer_app_order_id`
- `native_shopify_order_id`
- `refund_amount`
- `refund_currency`
- `refund_type: partial`
- `stripe_event_id`
- `stripe_refund_id`
- `review_reason`
- `priority`
- `status: pending`
- `source: native_refund_impact_preview`
- `raw_payload_included:false`
- `customer_pii_included:false`

The draft is summary-only. It does not include raw Stripe, Shopify, Hub, provider, auth, payment, address, phone, or customer payloads.

## 8. Duplicate/idempotency behavior

G35H checks:

- `OrderSyncLog`
- `CommandLog`
- `OrderReviewQueue`

If a duplicate Stripe event is detected:

```text
next_action: duplicate_refund_event_detected
```

If an existing partial refund review is detected:

```text
next_action: duplicate_partial_refund_review_already_exists
```

In both cases, no new review queue draft is recommended for a future command.

## 9. Missing data behavior

If `refund_amount` is missing or invalid:

```text
success:false
blockers:[refund_amount_required_for_partial_refund_review]
next_action: provide_refund_amount_for_review_preview
```

If `refund_type` is not `partial`:

```text
success:false
blockers:[refund_type_must_be_partial_for_partial_refund_review_preview]
next_action: use_native_refund_impact_preview_for_non_partial_refund
```

If the order is unknown but refund event/order identity is present:

```text
next_action: unknown_order_review_required
```

## 10. Expected NV-MPZNKGNT behavior after publish

A partial refund dry-run preview for `NV-MPZNKGNT` with a fake preview-only amount should return:

- `success:true`
- `dry_run:true`
- `writes_performed:false`
- `refund_type: partial`
- review queue draft present
- delivered/manual review required
- no automatic cancellation
- `production_batch_count:6`
- `batch_compliance_log_count:6`
- production/compliance history preserved
- notifications held
- provider calls false
- Hub fallback required

## 11. Future phases

Recommended next phases after G35H:

1. G35H closeout and publish verification.
2. G35I gated partial refund review queue command planning, if owner approves creating review queue rows natively.
3. Full refund pre-production preview hardening.
4. Continued Hub refund source-of-truth until native refund writes are explicitly approved.
