# G35E — Refund Status Schema Proposal and Native Refund Field Contract

Status: docs-only proposal
Date: 2026-06-10
Scope: native refund/payment reversal schema planning and field contract

## 1. Executive summary

G35D proved that `NATIVE_REFUND_IMPACT` can now identify native production and compliance history for the delivered pilot order. The next blocker is the schema and field contract for refund state.

This proposal keeps Customer App `Order.status` as the customer/order lifecycle field and moves refund state into payment/refund-specific fields. It does not change schemas yet.

Recommended model:

- Do not add `refunded`, `cancelled`, or `canceled` to Customer App `Order.status` as the first refund migration step.
- Use `payment_status` / `financial_status` for high-level payment state.
- Add dedicated optional refund fields on Customer App `Order` in a later schema PR.
- Keep delivered/fulfilled orders delivered operationally; refunds after delivery require manual review.
- Keep ProductionBatch and BatchComplianceLog history immutable for refund automation.
- Keep Hub as refund source of truth until native preview, schema, fixtures, and policy are proven.

No schema, runtime, Base44 publish, or live data mutation is included in G35E.

## 2. Current refund-capable field audit

### 2.1 Customer App `Order`

Current lifecycle fields:

| Field | Current contract | Refund relevance |
| --- | --- | --- |
| `status` | Enum: `order_received`, `scheduled_for_juicing`, `in_production`, `bottled_packed`, `out_for_delivery`, `arriving_soon`, `delivered`, `ready_for_pickup`, `picked_up` | Lifecycle/customer-facing status only. `refunded`, `cancelled`, and `canceled` are unsupported. |
| `status_history` | Array of `{ status, timestamp, message }` with string status | Can record event-like notes later, but must not be treated as refund source of truth until notification/UI side effects are proven safe. |
| `production_status` | Enum includes `cancelled` | Legacy/order-level production projection. Not recommended as primary refund state. |
| `fulfillment_status` | Enum includes `cancelled` | Legacy/order-level fulfillment projection. Not recommended as primary refund state. |
| `delivery_status` | Enum: `not_ready`, `ready`, `in_transit`, `delivered` | Delivery projection. Should not be changed for delivered refund cases without manual review. |
| `stripe_payment_intent_id` | String | Provider reference already present; do not expose in read previews unless needed and safe. |
| `stripe_checkout_session_id` | String | Provider reference already present; do not expose in read previews unless needed and safe. |
| `payment_captured` | Boolean | Useful precondition and refund audit context. |
| `financial_status` | Enum: `pending`, `paid`, `refunded`, `failed` | Existing high-level refund-capable state. |
| `payment_status` | Enum: `pending`, `paid`, `refunded`, `failed` | Existing high-level refund-capable state. |
| `do_not_recover` | Boolean terminal suppression flag | Should be used only when an order must not re-enter production/delivery flows. Not a generic partial-refund marker. |
| `canceled_at` | String timestamp | Existing cancellation timestamp. Should be used only for actual cancellation policy, not every refund. |
| `deleted_at` | String timestamp | Not a refund field. |

Current gap:

- Customer App `Order.status=refunded` is unsupported.
- Customer App `Order.status=cancelled` is unsupported.
- Customer App `Order.status=canceled` is unsupported.
- Existing legacy code paths may still write/check unsupported statuses; new native refund work should not copy that pattern.

### 2.2 Native `ShopifyOrder`

| Field | Current contract | Refund relevance |
| --- | --- | --- |
| `payment_status` | String | Supports `refunded` by convention; no enum blocker. |
| `financial_status` | String | Supports provider/native financial status by convention. |
| `fulfillment_status` | String | Can represent `cancelled` by convention, but should not be changed for delivered/fulfilled refund cases without manual review. |
| `shopify_fulfillment_status` | String | Provider parity/status context only. |
| `production_status` | Enum includes `canceled` and `refunded` | Canonical native production cancellation spelling is `canceled`. Do not use for delivered auto-cancel. |
| `order_status` | String | Loose status mirror; should not become the primary refund source of truth. |
| `sync_status` | String | Useful for migration/backfill state, not refund state source of truth. |
| Stripe ids (`stripe_customer_id`, `stripe_checkout_session_id`, `stripe_payment_intent_id`, `stripe_invoice_id`, `stripe_subscription_id`, `stripe_charge_id`) | Strings | Existing provider references. Future command logs must not store raw provider payloads. |
| `stripe_event_id_applied` | String | Existing event id slot, but not enough for complete refund state history by itself. |
| `audit_trail` | Array of objects | Safe future audit location if approved; no raw provider payloads. |
| `refunded_at` | String | Existing native refund timestamp. |
| `cancel_type` | String | Existing cancellation descriptor. |
| `excluded_from_production` | Boolean | Useful when refund/cancel should prevent production entry. Not relevant for delivered auto-cancel. |

### 2.3 Native `FulfillmentTask`

| Field | Current contract | Refund relevance |
| --- | --- | --- |
| `status` | Enum includes lowercase `cancelled` and legacy uppercase `Cancelled` | Canonical future machine value should be lowercase `cancelled`. Delivered tasks should not be auto-cancelled by refund preview/command. |
| `delivery_status` | String projection | Can represent cancellation by convention; should remain delivered for delivered refund cases unless manual review approves otherwise. |
| `production_status` | String projection | Context only. |
| `payment_status` | String copied from source order | Can carry high-level payment context, but task is not refund source of truth. |
| `sync_status` | String | Migration context. |
| `review_status` / `review_reason` | Strings | Useful for future manual-review states. |
| `command_log_id` | String | Latest approved operational mutation link. |
| `audit_trail` | Array of objects | Safe future task audit events only; no raw provider payloads. |

### 2.4 `ProductionBatch`

| Field | Current contract | Refund relevance |
| --- | --- | --- |
| `status` | Enum: `planned`, `ready_for_production`, `in_production`, `completed_pending_verification`, `verified_logged`, `archived` | Refund preview must classify risk by state. Verified history must be preserved. |
| `production_status` | Enum: `bottled`, `packed` | Context only. |
| `planned_units` / `actual_units` | Numbers | Future preview may show theoretical demand impact, but no automatic recalculation for verified/delivered refunds. |
| `production_date` | Date | Supporting linkage context only; never sole refund match key. |
| `is_locked` | Boolean | Locked batches require admin reason/audit for any edits. |
| `order_sources` | Array with order id/number/customer context/quantity/source | Existing demand source linkage. Do not remove automatically for late-lifecycle refunds. |
| `verified_by` / `verified_at` | Strings | Compliance/production history context. |
| `compliance_log_id` | String link to BatchComplianceLog | Primary compliance linkage. |
| `audit_trail` | Safe edit audit array | Future refund command must not append unless exact live write is approved. |
| `command_log_ids` | Array | Future command linkage only if live command is approved. |
| `inventory_deduction_status` / `inventory_deduction_log_id` | Strings | Inventory reversal only if deduction actually ran and reversal policy exists. |

### 2.5 `BatchComplianceLog`

| Field | Current contract | Refund relevance |
| --- | --- | --- |
| `batch_id` | String batch reference | Compliance linkage. |
| `source_production_batch_id` | String ProductionBatch link | Compliance linkage. |
| `locked` | Boolean, default true | Refund automation must preserve locked logs. |
| production/compliance measurements | pH, ingredients, quantity, staff, notes, verification fields | Compliance history. Must not be deleted, altered, or reversed by refund automation. |

### 2.6 `OrderReviewQueue`

| Field | Current contract | Refund relevance |
| --- | --- | --- |
| `incident_type` | String; description already includes `partial_refund_received` | Natural place for future partial refund/manual review incidents. |
| `status` | Enum: `pending`, `reviewing`, `resolved`, `rejected`, `archived` | Review lifecycle. |
| `incoming_payload` | Object; description forbids secrets/raw provider payloads/stack traces | If used later, store safe summaries only. |
| `recommended_action` / `issue_description` / `admin_notes` | Strings | Manual review workflow. |
| `idempotency_key` / occurrence timestamps | Strings/numbers | Prevent duplicate review entries. |

### 2.7 `OrderSyncLog`

| Field | Current contract | Refund relevance |
| --- | --- | --- |
| `status` | Enum includes `success`, `error`, `recovery`, `pending`, `deduped`, `skipped`, `queued_for_review`, `rejected` | Useful for future refund event audit, duplicate detection, and review status. |
| `triggered_by` | Enum includes `stripe_webhook`, `stripe_webhook_preorder`, `recovery_function`, `manual`, `cron_poll` | Existing source classification. |
| `sync_source` / `event_type` | Strings | Can describe `refund.created`, `charge.refunded`, or internal preview/command labels in future. |
| `stripe_event_id` | String | Primary provider-event idempotency key when present. |
| `action` / `reason` | Strings | Safe action summary. |
| `fields_updated` / `fields_rejected` | Arrays | Useful for future audit summaries only. |
| `idempotency_key` / `request_id` / `correlation_id` | Strings | Duplicate protection and traceability. |

### 2.8 `CommandLog`

| Field | Current contract | Refund relevance |
| --- | --- | --- |
| `command_type` / `command_source` | Strings | Future refund command classification if approved. |
| `status` | Enum: `pending`, `running`, `success`, `skipped`, `rejected`, `failed` | Idempotent command state. |
| `payload` | Object; safe metadata only | Must not store raw provider payloads, auth headers, or full records. |
| `result` | Object; safe result metadata only | Suitable for counts, before/after status labels, and no-write flags. |
| `idempotency_key` / `request_id` | Strings | Required for any future live command. |
| `related_stripe_event_id` | String | Direct refund-event linkage. |
| `related_order_id` / `related_order_number` | Strings | Safe target linkage. |

### 2.9 `SafeSyncParityLog`

| Field | Current contract | Refund relevance |
| --- | --- | --- |
| `event_type` / `bridge_action` / `hub_result_status` | Strings | Useful for future read-only Hub/native refund parity comparisons. |
| `native_parity_status` | Enum: `match`, `acceptable_difference`, `mismatch`, `unsupported`, `blocked`, `needs_manual_review` | Good fit for refund parity dry-run outcomes. |
| `accepted_fields_summary` / `rejected_fields_summary` | Arrays of field names only | Good for safe refund parity summaries. |
| `redaction_applied` / `native_writer_enabled` | Safety fields | Must remain redacted and writer-disabled for preview parity logs. |

### 2.10 `Notification` and `CustomerMessageDeliveryLog`

| Entity | Current refund relevance |
| --- | --- |
| `Notification` | Has `notification_subtype` string and `idempotency_key`. No refund-specific subtype is required for G35E because notifications remain held by default. |
| `CustomerMessageDeliveryLog` | `message_type` enum includes `refund`. Future refund notification flows could log here, but refund notifications remain disabled/held unless separately approved. |

## 3. Unsupported or risky current values

| Value/path | Current support | G35E policy |
| --- | --- | --- |
| Customer App `Order.status=refunded` | Unsupported | Do not use in new native refund work. |
| Customer App `Order.status=cancelled` | Unsupported | Do not use in new native refund work. |
| Customer App `Order.status=canceled` | Unsupported | Do not use in new native refund work. |
| Native `ShopifyOrder.payment_status=refunded` | Supported as string | Allowed in preview/field contract; live writes still require later approval. |
| Native `ShopifyOrder.production_status=canceled` | Supported enum | Canonical cancellation spelling for native ShopifyOrder production state. |
| Native `FulfillmentTask.status=cancelled` | Supported enum | Canonical task cancellation spelling, but delivered tasks should not be auto-cancelled. |
| `CustomerMessageDeliveryLog.message_type=refund` | Supported enum | Notifications/messages remain held; this is not approval to send refund messages. |

## 4. Proposed refund state model

### 4.1 Principles

1. Separate lifecycle from refund/payment reversal.
2. Preserve operational truth.
   - A delivered order remains delivered operationally even if later refunded.
3. Preserve compliance history.
   - Verified batches and locked compliance logs are immutable historical records for refund automation.
4. Prefer explicit review over automatic mutation for late lifecycle and partial refunds.
5. Keep provider event ids out of public/customer-facing surfaces.
6. Keep Hub source of truth until native refund preview, schema, fixtures, and policy are complete.

### 4.2 Customer App `Order` proposed optional fields

These fields are proposed for a future schema PR. They are not implemented in G35E.

| Field | Type | Proposed values / shape | Purpose | Notes |
| --- | --- | --- | --- | --- |
| `refund_status` | string enum | `none`, `pending_review`, `not_refunded`, `partial_refunded`, `fully_refunded`, `refund_failed`, `refund_reversed`, `provider_disputed` | Primary refund state separate from lifecycle status. | Default should be `none` or absent for existing orders. |
| `refund_type` | string enum | `none`, `full`, `partial`, `unknown` | Classifies event/order refund scope. | `partial` always review-required initially. |
| `refund_amount` | number | Decimal currency amount | Total refunded amount known to native system. | Do not infer if missing. |
| `refund_currency` | string | ISO-like lowercase code, e.g. `usd` | Currency for amount. | Default to existing order currency if present; otherwise require explicit value. |
| `refunded_at` | string | ISO timestamp | Timestamp of effective full refund or latest refund event. | For partial refunds, consider `last_refund_event_at` too. |
| `refund_source` | string enum | `stripe_webhook`, `admin_preview`, `admin_command`, `hub_mirror`, `manual`, `test_fixture` | Source that produced the refund state. | Provider-origin handling remains later phase. |
| `refund_event_id` | string | Provider/internal event id | Idempotency and traceability. | For Stripe, use Stripe event id when available. |
| `stripe_refund_id` | string | Stripe refund id | Provider refund object reference. | Store id only, not raw refund payload. |
| `refund_reason` | string | Safe reason label/text | Admin/provider reason summary. | No raw provider payload. |
| `refund_review_required` | boolean | true/false | Flags manual review requirement. | True for partial, delivered, verified, unknown, subscription, multi-delivery. |
| `refund_review_status` | string enum | `not_required`, `pending`, `reviewing`, `resolved`, `rejected`, `archived` | Mirrors review lifecycle when tied to OrderReviewQueue. | Should not replace OrderReviewQueue. |
| `refund_notes` | string | Safe admin-only notes | Manual review context. | No secrets, raw payloads, provider dumps, addresses, or PII beyond safe admin context. |
| `refund_last_event_at` | string | ISO timestamp | Latest refund event observed. | Useful for partial/multiple refunds. |
| `refund_total_amount` | number | Decimal currency amount | Cumulative refunded total. | Can equal `refund_amount` if only one event exists. |
| `refund_event_count` | number | Integer | Count of processed/deduped refund events. | Optional; useful for duplicate review. |
| `refund_command_log_id` | string | CommandLog id | Link to approved native command if one exists later. | Not used by previews. |
| `refund_order_sync_log_id` | string | OrderSyncLog id | Link to refund event audit if one exists later. | Not used by previews. |

Field intentionally not proposed:

- `Order.status=refunded`
- `Order.status=cancelled`
- `Order.status=canceled`

### 4.3 Native `ShopifyOrder` proposed optional fields

Native ShopifyOrder already has many refund-capable fields. Proposed additions are for clarity and idempotency, not customer-facing status.

| Field | Type | Purpose |
| --- | --- | --- |
| `refund_status` | string enum aligned with Order | Native mirror refund state. |
| `refund_type` | string enum | Full/partial/unknown. |
| `refund_amount` | number | Latest or total amount according to field naming. Prefer `refund_total_amount` for cumulative. |
| `refund_currency` | string | Refund currency. |
| `refund_event_id` | string | Provider event id. Complements `stripe_event_id_applied`. |
| `stripe_refund_id` | string | Stripe refund object id, id only. |
| `refund_review_required` | boolean | Manual review classification. |
| `refund_review_status` | string enum | Native mirror review status. |
| `refund_command_log_id` | string | Future live command audit link. |
| `refund_order_sync_log_id` | string | Future event audit link. |

Existing fields to preserve/use:

- `payment_status=refunded` for high-level payment state when approved.
- `financial_status=refunded` for provider/native financial state when approved.
- `production_status=canceled` only for pre-production/full-cancel cases where policy allows cancellation.
- `refunded_at` for effective refund timestamp.
- `excluded_from_production=true` only for orders that must not enter production.

### 4.4 Native `FulfillmentTask` proposed optional fields

Do not make FulfillmentTask the source of refund truth. It can carry review and audit context.

| Field | Type | Purpose |
| --- | --- | --- |
| `refund_status` | string enum | Optional task-level projection for operational filtering. |
| `refund_review_required` | boolean | Flags task needs admin review due to refund. |
| `refund_review_status` | string enum | Review state. |
| `refund_reason` | string | Safe reason. |
| `refund_command_log_id` | string | Future command link. |

Policy:

- Do not auto-cancel delivered tasks.
- Use `status=cancelled` only for future pre-production/pre-delivery full cancellation when policy and command are approved.
- Keep `delivery_status=delivered` for delivered refund cases unless a manual correction explicitly changes it.

### 4.5 Production and compliance entities

No refund fields are recommended for `BatchComplianceLog`.

For `ProductionBatch`, avoid refund-specific schema unless future inventory/demand reversal policy requires it. Existing `audit_trail`, `command_log_ids`, and `order_sources` are enough for preview and tightly approved manual corrections.

If a future schema proposal adds batch-level refund context, it should be limited to safe, non-mutating linkage fields such as:

- `refund_review_required`
- `refund_review_status`
- `refund_command_log_ids`

Do not add fields that imply compliance deletion/reversal.

## 5. Proposed enum/value contracts

### 5.1 `refund_status`

Recommended enum:

| Value | Meaning |
| --- | --- |
| `none` | No refund state known or not applicable. |
| `pending_review` | Refund event requires review before native mutation. |
| `not_refunded` | Explicitly checked and not refunded. Optional; may be unnecessary if `none` is enough. |
| `partial_refunded` | Partial refund confirmed. Review remains required unless policy later changes. |
| `fully_refunded` | Full refund confirmed. Operational lifecycle state remains separate. |
| `refund_failed` | Refund attempt/event failed. |
| `refund_reversed` | Refund reversal/charge reinstatement event, if supported later. |
| `provider_disputed` | Dispute/chargeback-style provider event requiring separate policy. |

Recommendation: start with `none`, `pending_review`, `partial_refunded`, `fully_refunded`, and `refund_failed`. Hold `refund_reversed` and `provider_disputed` unless the provider event model is explicitly scoped.

### 5.2 `refund_type`

Recommended enum:

- `none`
- `full`
- `partial`
- `unknown`

### 5.3 `refund_source`

Recommended enum:

- `stripe_webhook`
- `admin_preview`
- `admin_command`
- `hub_mirror`
- `manual`
- `test_fixture`

Live commands should not accept `test_fixture`.

### 5.4 `refund_review_status`

Recommended enum aligned with `OrderReviewQueue.status`:

- `not_required`
- `pending`
- `reviewing`
- `resolved`
- `rejected`
- `archived`

## 6. Entity-specific write policy for future commands

This is a future contract only. No writes are approved by G35E.

| Entity | Future pre-production full refund | Future partial refund | Future delivered/verified refund |
| --- | --- | --- | --- |
| Customer App `Order` | May update payment/refund fields after schema approval; do not change lifecycle `status` to refunded/cancelled. | Set review-required refund fields or recommend review; no automatic lifecycle change. | Manual review only; keep lifecycle delivered/picked-up state. |
| Native `ShopifyOrder` | May update payment/refund fields and production exclusion/cancellation only if still before production and command approved. | Review-only. | Manual review only; preserve fulfilled/bottled history. |
| Native `FulfillmentTask` | May cancel only if not delivered/packed and command/policy approved. | Review-only. | Do not auto-cancel delivered task. |
| `ProductionBatch` | If planned only, future preview may propose demand adjustment; no live write until separate command. | No automatic mutation. | Preserve history; no source removal/recalculation/archive. |
| `BatchComplianceLog` | No mutation. | No mutation. | No mutation. |
| `OrderReviewQueue` | Optional future write for review cases only after command approval. | Recommended future path. | Recommended future path. |
| `OrderSyncLog` | Optional future audit write after command approval. | Optional audit/review write after approval. | Optional audit/review write after approval. |
| `CommandLog` | Required for any future live command. | Required for any future live command. | Required for any future live command. |
| Notifications/messages | Held by default. | Held by default. | Held by default. |

## 7. Idempotency and audit contract

Future native refund commands must require:

- `request_id`
- `refund_event_id` or `stripe_event_id` when provider-originated
- `refund_type`
- `refund_amount` for partial refunds and amount-aware full refunds
- `refund_currency`
- exact order identifiers
- explicit confirmation phrase
- `notification_policy=NO_NOTIFICATION` unless a later notification phase changes policy

Idempotency rules:

- Stripe/provider event id is the provider idempotency key when present.
- `request_id` is the command idempotency key for admin commands.
- Existing successful `CommandLog` with same request id must skip.
- Existing successful `OrderSyncLog` or `CommandLog` with same refund event id must skip or review, depending state.
- Failed prior logs are not success.
- No duplicate review queue rows.
- No duplicate status history append.
- No duplicate notifications/messages.
- No provider calls from preview.

CommandLog safe payload/result should contain only:

- command type/source
- target ids/order number
- refund type/status labels
- amount/currency if needed
- event id presence or safe id string if approved
- before/after field labels
- counts
- blockers/warnings
- writes performed flags
- no raw provider payloads
- no auth headers
- no full records

## 8. Status history policy

Do not use `status_history` as the source of refund truth.

Future status history append may be allowed only if all are true:

- schema/policy approves the event shape;
- notification side effects are proven disabled;
- customer-facing UI impact is understood;
- owner explicitly approves status history append for the exact command class.

Recommended event shape if later approved:

```json
{
  "status": "refund_event",
  "timestamp": "<ISO timestamp>",
  "message": "Refund event recorded for admin review."
}
```

Do not use `status: refunded` unless schema/UI policy later approves it.

## 9. Review queue policy

Partial refunds and late-lifecycle refunds should route to review before any native mutation.

Recommended future `OrderReviewQueue` incident types:

- `partial_refund_received`
- `full_refund_late_lifecycle_review`
- `refund_received_unknown_order`
- `refund_duplicate_event_review`
- `refund_schema_gap_review`
- `subscription_refund_unsupported`
- `multi_delivery_refund_unsupported`

Review queue payload must remain safe summary-only. Do not store raw Stripe events, raw Shopify payloads, full addresses, phone numbers, auth headers, stack traces, or provider dumps.

## 10. Notification and customer messaging policy

Refund notifications remain held by default.

Existing schema can represent refund message logs through `CustomerMessageDeliveryLog.message_type=refund`, but that is not approval to send messages.

Before refund notifications are enabled, require:

- customer-facing copy approval;
- exact event/subtype mapping;
- idempotency key contract;
- opt-in/eligibility policy;
- preview showing notification impact;
- explicit owner approval;
- no provider/payment mutation coupling.

## 11. Migration/backfill considerations

For existing orders:

- Do not backfill refund fields broadly until schema is approved and a read-only migration preview exists.
- Legacy orders with `payment_status=refunded` should be previewed before any new `refund_status` is populated.
- Existing unsupported `Order.status=refunded/cancelled` code paths should be audited and patched separately.
- Delivered historical orders should preserve delivered/fulfilled lifecycle status and represent refund state separately.

Suggested future backfill preview:

- `previewNativeRefundFieldBackfill`
- Reads existing Customer App Order, native ShopifyOrder, OrderSyncLog, CommandLog, Hub context if safe.
- Returns proposed refund fields and blockers.
- Writes nothing.

## 12. Proposed schema patch scope for a future G35F/G35E2

Recommended first schema patch, if approved:

### `Order.jsonc`

Add optional fields:

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
- `refund_notes`
- `refund_last_event_at`
- `refund_total_amount`
- `refund_event_count`
- `refund_command_log_id`
- `refund_order_sync_log_id`

Do not modify `Order.status` enum in the first schema patch.

### `ShopifyOrder.jsonc`

Optional additions:

- `refund_status`
- `refund_type`
- `refund_amount`
- `refund_currency`
- `refund_event_id`
- `stripe_refund_id`
- `refund_review_required`
- `refund_review_status`
- `refund_command_log_id`
- `refund_order_sync_log_id`

Keep existing:

- `refunded_at`
- `payment_status`
- `financial_status`
- `stripe_event_id_applied`
- `audit_trail`

### `FulfillmentTask.jsonc`

Optional additions only if operational filtering needs them:

- `refund_status`
- `refund_review_required`
- `refund_review_status`
- `refund_reason`
- `refund_command_log_id`

Recommendation: add these only after `Order` / `ShopifyOrder` refund fields are accepted.

### Entities not recommended for schema changes in first patch

- `ProductionBatch`
- `BatchComplianceLog`
- `Notification`
- `CustomerMessageDeliveryLog`
- `OrderReviewQueue`
- `OrderSyncLog`
- `CommandLog`
- `SafeSyncParityLog`

These already have enough structure for preview/review/audit planning.

## 13. Future preview and test requirements before schema writes

Before schema changes are implemented, add/confirm fixtures for:

1. Full refund before native ops.
2. Full refund after native order creation only.
3. Full refund after FulfillmentTask creation.
4. Full refund after ProductionBatch planned.
5. Full refund after production started.
6. Full refund after production completed.
7. Full refund after verified_logged with locked compliance logs.
8. Full refund after packed/bottled.
9. Full refund after delivered.
10. Partial refund before production.
11. Partial refund after delivered.
12. Duplicate refund event id.
13. Unknown order refund.
14. Subscription/multi-delivery refund.
15. Existing `payment_status=refunded` without dedicated refund fields.
16. Legacy unsupported `Order.status=refunded/cancelled` record if such records exist.

## 14. Hard stops before native refund writes

Do not build or run a native refund write command until:

- refund field schema is approved and deployed;
- `NATIVE_REFUND_IMPACT` fixtures cover all lifecycle stages above;
- partial refund review policy is implemented as preview first;
- idempotency policy is implemented and tested;
- delivered/verified refund policy remains manual review/no auto-cancel;
- notification policy remains held or is separately approved;
- provider call boundary is explicit;
- inventory reversal policy exists only if inventory deduction has actually run;
- PurchaseOrder reversal policy exists only if PO automation has actually run;
- BatchComplianceLog mutation remains prohibited;
- Hub source-of-truth role is explicitly changed or retained;
- owner gives exact approval for any live command scope.

## 15. Recommended next phases

Recommended sequence after G35E:

1. **G35F — refund fixtures/harness expansion**
   - Broaden tests around lifecycle stages and proposed schema fields.
   - No schema/runtime live writes.
2. **G35G — refund schema patch PR**
   - Add approved optional refund fields to `Order` and possibly `ShopifyOrder`.
   - No live refund command.
3. **G35H — partial refund review queue preview**
   - Preview future review queue entry only.
   - No queue writes.
4. **G35I — pre-production full refund native preview refinement**
   - Still read-only.
5. **Later only: gated native refund command planning**
   - Only after schema, preview, fixtures, idempotency, and owner approval.

G35E recommendation: proceed to G35F fixture expansion before changing schemas, unless owner wants the optional `Order` refund fields introduced first as a no-write schema-only PR.
