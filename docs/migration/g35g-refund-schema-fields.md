# G35G Refund Schema Fields

## 1. Executive summary

G35G adds optional refund/payment-reversal fields to the Customer App schema so future native refund preview, review, and command work can use payment/refund-specific state instead of misusing customer lifecycle status.

This is a schema-only phase.

No runtime functions, UI, commands, gates, sync paths, provider integrations, notifications, or live data are changed by this PR.

Hub remains the refund source of truth until native refund parity is separately approved and proven.

## 2. Why `Order.status` is not changed

Customer App `Order.status` remains lifecycle/delivery-facing. G35G intentionally does **not** add any of these values to `Order.status`:

- `refunded`
- `cancelled`
- `canceled`

Refunds are financial/payment-reversal events. They may happen before production, after production, after delivery, or as partial refunds that should not change delivery lifecycle status. Storing refund state in `Order.status` would mix financial state with lifecycle state and could create customer-facing UI, notification, and fulfillment ambiguity.

Existing lifecycle statuses such as `scheduled_for_juicing`, `bottled_packed`, and `delivered` remain unchanged.

## 3. Entities changed

G35G changes only:

1. `base44/entities/Order.jsonc`
2. `base44/entities/ShopifyOrder.jsonc`

No other entity schema is changed.

## 4. Fields added to Customer App `Order`

All fields are optional. No default live values are introduced.

| Field | Type | Values / notes |
| --- | --- | --- |
| `refund_status` | string enum | `none`, `pending_review`, `partially_refunded`, `fully_refunded`, `review_required`, `ignored_duplicate` |
| `refund_type` | string enum | `full`, `partial`, `unknown` |
| `refund_amount` | number | Optional refund amount for review/audit. |
| `refund_currency` | string | Optional ISO currency code. |
| `refunded_at` | string | Optional ISO timestamp confirmed by the current source of truth. |
| `refund_source` | string enum | `stripe_webhook`, `admin`, `hub_mirror`, `manual_review` |
| `refund_event_id` | string | Optional provider or internal refund event id for idempotency/audit. |
| `stripe_refund_id` | string | Optional Stripe refund id when safely available from an approved source. |
| `refund_reason` | string | Optional safe reason or admin summary; no raw provider payloads. |
| `refund_review_required` | boolean | Optional manual-review marker. |
| `refund_review_status` | string enum | `none`, `pending`, `reviewed`, `resolved`, `rejected` |

Existing `payment_status`, `financial_status`, and `do_not_recover` remain in place. `do_not_recover` is not newly added to `Order` because it already exists.

## 5. Fields added to native `ShopifyOrder`

All fields are optional. No default live values are introduced.

| Field | Type | Values / notes |
| --- | --- | --- |
| `refund_status` | string enum | `none`, `pending_review`, `partially_refunded`, `fully_refunded`, `review_required`, `ignored_duplicate` |
| `refund_type` | string enum | `full`, `partial`, `unknown` |
| `refund_amount` | number | Optional refund amount for review/audit. |
| `refund_currency` | string | Optional ISO currency code. |
| `refunded_at` | string | Existing field retained and documented as optional refund timestamp. |
| `refund_source` | string enum | `stripe_webhook`, `admin`, `hub_mirror`, `manual_review` |
| `refund_event_id` | string | Optional provider or internal refund event id for idempotency/audit. |
| `stripe_refund_id` | string | Optional Stripe refund id when safely available from an approved source. |
| `refund_reason` | string | Optional safe reason or admin summary; no raw provider payloads. |
| `refund_review_required` | boolean | Optional manual-review marker. |
| `refund_review_status` | string enum | `none`, `pending`, `reviewed`, `resolved`, `rejected` |
| `do_not_recover` | boolean | Optional terminal suppression marker for refund/reversal review. |

Existing `payment_status`, `financial_status`, `production_status`, `fulfillment_status`, `stripe_event_id_applied`, `cancel_type`, and `excluded_from_production` remain unchanged.

## 6. Fields intentionally not added

### `OrderReviewQueue`

No G35G changes are needed. It already has:

- flexible `incident_type`
- safe `incoming_payload`
- `status`
- `idempotency_key`
- review metadata fields

Future partial refund review work can use these existing fields first.

### `OrderSyncLog`

No G35G changes are needed. It already has:

- `stripe_event_id`
- `event_type`
- `idempotency_key`
- `request_id`
- `status`
- `action`
- `reason`
- safe sync metadata

### `CommandLog`

No G35G changes are needed. It already has:

- `command_type`
- `status`
- `payload`
- `result`
- `idempotency_key`
- `request_id`
- `related_stripe_event_id`
- related order fields

### `ProductionBatch` and `BatchComplianceLog`

No refund-specific fields are added. Verified production and locked compliance history must remain preserved and must not become refund-mutable by schema implication.

### Notifications / message logs

No refund notification fields are added. Notifications remain held by default.

## 7. No live write behavior

G35G does not enable any writer.

These fields are schema capacity only. They do not imply:

- native refund processing
- Stripe refund creation
- Shopify API calls
- Customer App order mutation
- native ShopifyOrder mutation
- FulfillmentTask cancellation
- ProductionBatch source removal or recalculation
- BatchComplianceLog mutation
- OrderReviewQueue creation
- OrderSyncLog creation
- CommandLog creation
- notification send
- inventory reversal
- PurchaseOrder reversal
- Hub mutation

## 8. Future phases that may use these fields

Possible future phases:

1. G35H partial refund review queue preview.
2. G35I full refund pre-production preview hardening.
3. Future schema-aware refund preview updates that report these fields as available.
4. Future gated review queue command, if explicitly approved.
5. Future pre-production full refund command planning, only after additional owner approval and policy validation.

No future phase should assume these fields authorize live mutation.

## 9. Hard stops before native refund writes

Do not design or run native refund writes until all of the following are true:

- Hub remains source of truth or an explicit source-of-truth migration is approved.
- Refund preview is schema-aware and still read-only.
- Partial refund review policy is approved.
- Full refund pre-production policy is approved.
- Delivered/fulfilled/manual-review policy is approved.
- ProductionBatch and BatchComplianceLog preservation is enforced.
- Idempotency with `stripe_event_id`, `refund_event_id`, and request id is proven.
- Notifications remain explicitly held or receive separate approval.
- Provider calls remain blocked unless separately approved.
- Exact gates, allowlists, and CommandLog behavior are designed and tested.

## 10. Publish note

Because entity schemas changed, a clean Base44 publish will be required after merge if the schema fields need to be available live.

Publish must be blocked if unrelated Builder/runtime/schema/UI changes are pending.
