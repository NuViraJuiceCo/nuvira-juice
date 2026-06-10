# G35C — Refund Status Schema and Policy Plan

Status: docs-only planning
Date: 2026-06-09
Scope: refund/payment reversal status policy, schema-gap planning, and future native preview/command prerequisites

## 1. Executive summary

G35B proved that native refund impact can be previewed without processing refunds or mutating Customer App/native/Hub records. It also surfaced a blocking status-model gap: the Customer App `Order.status` enum is delivery/lifecycle-facing and does not support `refunded`, `cancelled`, or `canceled`, while several existing refund/cancel code paths still write or check those values.

Recommendation:

1. Keep Hub as the refund source of truth for now.
2. Do not add a live native refund command yet.
3. Do not use `Order.status` for refund/cancel state in new native refund work.
4. Treat Customer App `Order.status` as customer delivery lifecycle state.
5. Track refund state through payment/refund-specific fields and review/audit records:
   - existing `payment_status=refunded` and `financial_status=refunded`, where applicable;
   - existing `do_not_recover=true` for terminal suppression, where applicable;
   - future dedicated refund fields, if approved;
   - status history event entries only if they are proven not to trigger customer-facing status/notification side effects.
6. Patch G35B refund impact preview linkage for `ProductionBatch` and `BatchComplianceLog` before any schema patch or live command planning.

No runtime/schema changes are included in G35C.

## 2. G35B current findings carried forward

Live read-only refund impact preview for the fully reconciled native order showed:

- order found: true;
- Customer App Order present: true;
- native ShopifyOrder present: true;
- native FulfillmentTask present: true;
- lifecycle state: delivered;
- risk: `do_not_auto_cancel`;
- next action: `delivered_refund_manual_review_required`;
- provider calls: false;
- notifications held: true;
- Hub fallback required: true.

Schema compatibility findings:

| Surface | Finding | Policy implication |
| --- | --- | --- |
| Customer App `Order.status=refunded` | Unsupported | Blocks native refund writes that change `Order.status` to `refunded`. |
| Customer App `Order.status=cancelled` | Unsupported | Blocks native refund/cancel writes that change `Order.status` to `cancelled`. |
| Customer App `Order.status=canceled` | Unsupported | Do not introduce this value without explicit schema/UI policy. |
| Native `ShopifyOrder.payment_status=refunded` | Supported as string field | Can be previewed as native payment-state impact, but no live write yet. |
| Native `ShopifyOrder.production_status=canceled` | Supported enum value | Canonical spelling is `canceled` on native ShopifyOrder production state. |
| Native `FulfillmentTask.status=cancelled` | Supported enum value | Canonical future task spelling should be lowercase `cancelled`; legacy uppercase exists. |

G35B blockers carried forward:

- `customer_order_status_refund_value_unsupported`;
- `customer_order_cancelled_value_unsupported`;
- delivered/manual-review risk for already delivered orders.

G35B warnings carried forward:

- notifications held;
- provider calls disabled;
- inventory reversal not proposed;
- PurchaseOrder reversal not proposed;
- Hub fallback required.

## 3. Customer App `Order.status` schema gap

Current Customer App `Order.status` values are customer/order-lifecycle values:

- `order_received`
- `scheduled_for_juicing`
- `in_production`
- `bottled_packed`
- `out_for_delivery`
- `arriving_soon`
- `delivered`
- `ready_for_pickup`
- `picked_up`

The enum does not include:

- `refunded`
- `cancelled`
- `canceled`

Current Customer App Order payment fields do support refund state:

- `financial_status`: `pending`, `paid`, `refunded`, `failed`
- `payment_status`: `pending`, `paid`, `refunded`, `failed`

Other relevant fields:

- `do_not_recover`: terminal suppression for refunded/cancelled orders;
- `canceled_at`: ISO cancellation timestamp field;
- `status_history`: array of objects with string `status`, `timestamp`, and `message`.

Policy conclusion: `Order.status` should not be used as the primary refund/cancel status in new native refund work unless a future schema/UI policy intentionally expands the enum and tests all customer-facing side effects.

## 4. Current code paths that use unsupported Customer App statuses

Several existing Customer App functions still write or check `Order.status` values that are outside the current schema enum.

| Area | Current behavior | G35C policy finding |
| --- | --- | --- |
| `stripeWebhook` refund handling | Checks `status === refunded/cancelled`; writes `status=refunded` on refund paths; writes `status=cancelled` on some failed/abandoned checkout paths. | Existing behavior needs a future compatibility/refactor plan before native refund writes are generalized. |
| `processManualRefund` | Checks `status=refunded/cancelled`; writes `status=refunded` plus payment/financial refunded. | Do not copy this pattern into new native command design without schema policy. |
| `cancelAbandonedCheckouts` | Writes `status=cancelled` and `do_not_recover=true`. | Treat as existing cleanup behavior needing later schema alignment. |
| `repairR2RefundedDuplicatesCA` | Uses `status=cancelled`, `payment_status=refunded`, and delivery/fulfillment cancellation fields. | Keep repair behavior out of generalized native refund path. |
| `syncOrderToHub` | Allows refund sync based on `payment_status=refunded` or `status=refunded`; blocks `do_not_recover`. | Prefer payment/do-not-recover checks over unsupported status checks in future native policy. |
| `processMay30NativeOrderOps` | Uses native mirror fields such as payment refunded, production canceled, fulfillment cancelled, order_status refunded, excluded flags, and can create cancelled fulfillment structures. | Treat as historical/native ops path, not sufficient for broad refund command generalization. |
| `shopifyWebhookReceiver` | Writes native mirror refund/cancel states, including production `canceled` and fulfillment `cancelled`. | Native mirror states are schema-compatible, but provider/webhook parity remains separate from Customer App status policy. |
| `previewNativeOrderCutoverReadiness` G35B | Correctly previews unsupported `Order.status=refunded` as a schema blocker. | Preserve preview behavior and patch batch/compliance linkage next. |

This document does not patch those paths. It records the gap and recommends staged remediation.

## 5. Refund state policy options

### Option A — Add Customer App `Order.status` values

Add values such as:

- `refunded`
- `cancelled` or `canceled`

Pros:

- Direct parity with some legacy code paths.
- Easier for existing refund/cancel checks to pass schema validation.

Cons:

- `Order.status` is currently customer lifecycle/delivery-facing.
- New statuses could affect customer order history, tracking UI, admin filters, notification mappings, and status history behavior.
- The spelling choice (`cancelled` vs `canceled`) could drift across entities.
- Delivered order refunds would become ambiguous: the order was delivered operationally, but payment was later refunded.

G35C recommendation: do not choose Option A as the first schema move.

### Option B — Keep refund state out of `Order.status`

Use existing payment and terminal-suppression fields:

- `payment_status=refunded`
- `financial_status=refunded`
- `do_not_recover=true` when the order should not re-enter operations
- `canceled_at` only for true cancellation events, not every refund
- status history event entry only after notification/UI side effects are verified safe

Pros:

- Preserves `Order.status` as customer lifecycle state.
- Avoids showing confusing customer-facing lifecycle transitions.
- Fits delivered-order refunds better: an order can remain `delivered` while payment state becomes refunded/reviewed.

Cons:

- Existing code paths that check `Order.status=refunded/cancelled` need later cleanup.
- UI may need payment/refund display logic instead of relying on lifecycle status.

G35C recommendation: use this as the immediate policy direction.

### Option C — Add dedicated refund fields

Possible future optional Customer App fields:

- `refund_status`: `none`, `pending_review`, `partial_refunded`, `fully_refunded`, `failed`, `provider_disputed`
- `refund_type`: `full`, `partial`, `unknown`
- `refund_amount`
- `refund_currency`
- `refunded_at`
- `refund_source`: `stripe_webhook`, `admin`, `hub`, `manual`
- `refund_event_id`
- `refund_review_required`
- `refund_reason`
- `refund_notes_safe`

Pros:

- Cleanly separates payment reversal from customer lifecycle.
- Supports partial refunds and delivered-order refunds without distorting delivery status.
- Easier to display in admin UI without changing customer-facing order tracker semantics.

Cons:

- Requires a schema PR and UI/read-model follow-up.
- Requires fixtures and backward-compatibility migration checks.

G35C recommendation: combine Option B now with Option C as a later schema proposal.

### Option D — Keep Hub source of truth and mirror read-only status

Pros:

- Safest short-term posture.
- Avoids native write risks while schema and lifecycle policy are unresolved.
- Keeps existing operations intact.

Cons:

- Delays full Hub retirement.
- Requires clear admin context so operators know native refund writes are held.

G35C recommendation: keep this as current operating mode until G35D/G35E/G35F prove parity.

## 6. Recommended status model

Recommended model for future native refund work:

1. Customer App `Order.status` remains delivery/customer-lifecycle state.
   - Examples: `scheduled_for_juicing`, `in_production`, `delivered`, `picked_up`.
   - Do not write `refunded`, `cancelled`, or `canceled` to this field in new native refund commands.

2. Refund/payment state lives outside `Order.status`.
   - Use existing `payment_status` and `financial_status` where possible.
   - Add dedicated refund fields in a future schema proposal if approved.

3. Operational suppression is explicit.
   - Use `do_not_recover=true` only for terminal orders that must not re-enter production/delivery flows.
   - Do not use it as a generic partial-refund marker.

4. Status history is an event log, not the source of truth.
   - A future command may append a safe refund event only after notification/UI side effects are proven disabled.
   - Do not append status history from previews.

5. Standardize cancellation spelling by entity, not globally:
   - Customer App Order: avoid cancellation in `Order.status`; `canceled_at` already exists.
   - Native ShopifyOrder production state: `canceled` because the enum supports that spelling.
   - Native FulfillmentTask state: `cancelled` because the task enum supports that spelling.
   - Review/log text may use human-readable spelling, but machine fields must follow the entity contract.

## 7. Lifecycle-stage refund policy

| Stage | Allowed automatic action now | Review required | Customer App Order impact | Native ShopifyOrder impact | FulfillmentTask impact | ProductionBatch / compliance impact | Inventory / PO impact | Notification impact | Hub/source-of-truth posture | Native command posture |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1. Before native ops | None from Customer App native write path | Yes until preview parity improves | Preview payment/refund impact only | Not applicable or preview mirror impact | Not applicable | None | None | Held | Hub remains source of truth | No live command yet |
| 2. Native order created only | None | Case-by-case | Keep lifecycle status; preview payment/refund fields | Preview `payment_status=refunded`, optional future production exclusion | None | None | None | Held | Hub source of truth | Future command possible only after schema and idempotency policy |
| 3. Native FulfillmentTask created | None | Yes | Keep lifecycle status; preview refund fields | Preview refund/cancel impact | Preview task cancellation only | None unless batches exist | None | Held | Hub source of truth | No command until task cancellation policy is proven |
| 4. ProductionBatch planned | None | Yes | Keep lifecycle status; payment/refund preview | Preview refund/cancel impact | Preview cancellation/hold impact | Preview order-source removal/replanned demand only; no writes | No inventory/PO reversal | Held | Hub source of truth | No command until batch linkage and recalculation previews are proven |
| 5. Production in progress | None | Yes, high risk | Manual/admin review | Manual/admin review | Manual/admin review | Do not delete in-progress history; preview hold/manual action | No reversal unless inventory was actually deducted | Held | Hub source of truth | Manual only |
| 6. Production completed pending verification | None | Yes, high risk | Manual/admin review | Manual/admin review | Manual/admin review | Preserve batch history; no automatic recalculation | No automatic reversal | Held | Hub source of truth | Manual only |
| 7. Verified logged / compliance logs exist | None | Yes, high risk | Manual/admin review | Manual/admin review | Manual/admin review | Compliance logs are audit history; never delete or alter for refund automation | No automatic reversal | Held | Hub source of truth | Manual only |
| 8. FulfillmentTask packed | None | Yes | Manual/admin review | Manual/admin review | Do not auto-cancel packed task | Preserve batch/compliance history | No automatic reversal | Held | Hub source of truth | Manual only |
| 9. Native ShopifyOrder bottled | None | Yes | Manual/admin review | Do not auto-revert bottled state | Do not auto-cancel without review | Preserve production history | No automatic reversal | Held | Hub source of truth | Manual only |
| 10. Delivered / fulfilled | None | Yes, mandatory | Keep delivered lifecycle; preview refund state separately | Do not auto-cancel fulfilled historical state | Do not auto-cancel delivered task | Preserve all batch/compliance history | No automatic reversal unless previous deduction/PO exists and reversal policy exists | Held | Hub source of truth | Do not auto-cancel |
| 11. Historical fulfilled | None | Yes | Usually admin-only historical context | Keep historical fulfilled mirror | Usually no task mutation | Preserve historical context | None | Held | Hub source of truth | Do not auto-cancel |
| 12. Subscription / multi-delivery | None | Yes | Out of one-time native scope | Out of one-time native scope | Occurrence-level policy required | Occurrence-level policy required | No automatic reversal | Held | Hub/source system | Unsupported for native one-time refund command |
| 13. Partial refund | None | Yes | Keep lifecycle status; preview refund fields | No cancellation by default | No cancellation by default | No batch mutation by default | No inventory/PO reversal | Held | Hub source of truth | Future review-queue preview first |
| 14. Duplicate refund event | None | No mutation; review if conflict | No duplicate change | No duplicate change | No duplicate change | No duplicate change | No duplicate reversal | Held | Existing event/log is source | Future command should idempotently skip |
| 15. Unknown order refund | None | Yes | Not applicable | Not applicable | Not applicable | Not applicable | None | Held | Hub/provider review | Queue/review only after approved preview |

## 8. Partial refund policy

Partial refunds must not automatically cancel orders, tasks, production batches, or compliance records.

Future partial refund behavior should be preview-first and review-led:

- proposed incident type: `partial_refund_received`;
- recommended action: manual review;
- no task cancellation by default;
- no ProductionBatch mutation by default;
- no BatchComplianceLog mutation ever;
- no inventory reversal unless inventory deduction had actually run and a reversal policy exists;
- no PurchaseOrder reversal unless PO automation had actually run and a reversal policy exists;
- notifications held by default;
- no Hub mutation from Customer App until separately approved.

Required future partial-refund inputs:

- refund amount;
- original order total;
- currency;
- refund reason, if available;
- provider event id, if available;
- affected item-level data, if available;
- safe order identity.

If item-level refund data is missing, review is required.

## 9. Duplicate and idempotency policy

Future preview/command logic should use provider event id as the primary idempotency key when present.

Rules:

- `stripe_event_id` should be treated as the event idempotency key when supplied.
- Existing `OrderSyncLog` or `CommandLog` entries with the same event id should cause duplicate preview status.
- A prior successful command log should cause a future live command to skip without duplicate writes.
- Failed prior logs are not success.
- No duplicate OrderReviewQueue entries should be created for the same event/order/incident combination.
- No duplicate cancellation, refund status update, status history append, notification, inventory reversal, PO reversal, or Hub sync should occur.
- Previews must never call Stripe, Shopify, payment providers, or Hub mutation endpoints.

## 10. ProductionBatch / BatchComplianceLog linkage caveat

G35B preview returned `production_batch_count:0` for the delivered native pilot order even though independent no-write verification confirmed:

- `ProductionBatch` count: 6;
- `ProductionBatch` status: `verified_logged`;
- `BatchComplianceLog` count: 6.

This was safe in G35B because the feature is read-only and the preview also classified the delivered order as manual review/no automatic cancellation. It is not acceptable for future live refund command planning.

Required future patch before any refund write command planning:

- refund impact preview must link `ProductionBatch` rows by all safe available keys:
  - order number;
  - Customer App Order id;
  - native ShopifyOrder id;
  - `order_sources`, if present;
  - `source_order_number`, if present;
  - `source_order_id`, if present;
  - explicit batch ids, if supplied;
- refund impact preview must detect `BatchComplianceLog` rows linked to those batches;
- verified/logged batches and locked compliance logs must be classified as compliance history;
- preview must not propose deleting or altering compliance history;
- delivered-order refund preview should show production/compliance impact as historical/manual-review/no-auto-mutation, not as absent production context.

Recommended next phase: G35D should patch refund impact preview production/compliance linkage before schema proposal work proceeds.

## 11. Proposed future phases

Recommended sequence:

1. **G35D — Patch refund impact preview ProductionBatch/BatchComplianceLog linkage**
   - Read-only runtime patch.
   - No refund writes.
   - Proves production/compliance risk classification with accurate native batch context.

2. **G35E — Refund status schema proposal**
   - Schema/policy proposal for dedicated refund fields or explicit decision to keep payment fields only.
   - No live refund command.

3. **G35F — Refund fixtures and harness expansion**
   - Pre-production, planned, in-progress, completed, verified, packed, bottled, delivered, historical, partial, duplicate, and unknown-order cases.
   - No provider calls.

4. **G35G — Partial refund review-queue preview**
   - Preview-only proposal for future `OrderReviewQueue` entries.
   - No live queue writes.

5. **G35H — Full refund preview for pre-production one-time orders**
   - Preview-only; only after schema/status policy and batch linkage are proven.
   - No live refund command.

Alternate sequence:

- G35E schema proposal first only if status schema blocks useful read-only preview improvements. Current assessment is that G35D should come first because production/compliance linkage affects risk classification for every later refund policy decision.

## 12. Hard stops before native refund writes

Do not design or run a native live refund command until all of the following are satisfied:

- Customer App `Order.status` policy is approved.
- Any needed refund-specific schema fields are approved and tested.
- G35B/G35D refund impact preview correctly links ProductionBatch and BatchComplianceLog rows.
- Partial refund policy is explicit and review-led.
- Delivered/fulfilled refund policy remains manual review/no automatic cancellation.
- Duplicate/idempotency behavior is proven with event ids and request ids.
- Notification policy remains `NO_NOTIFICATION` unless explicitly changed.
- Provider call boundary is explicit: native preview/command must not call Stripe/Shopify/providers unless a future provider phase is separately approved.
- Inventory reversal policy exists, and only applies if inventory deduction had actually run.
- PurchaseOrder reversal policy exists, and only applies if PO automation had actually run.
- BatchComplianceLog history deletion/modification remains prohibited.
- Hub fallback/source-of-truth role is explicitly defined for refund events.
- Owner approval exists for exact order/event scope before any live mutation.

## 13. G35C conclusion

Refund migration should stay in preview/planning mode. The native system has enough structure to preview refund impact safely, but it does not yet have a coherent Customer App refund status model or accurate enough production/compliance linkage to support live native refund writes.

Recommended next action: proceed to G35D, a read-only patch to refund impact preview ProductionBatch/BatchComplianceLog linkage. Keep Hub as refund source of truth until G35D/G35E/G35F are complete and explicitly approved.
