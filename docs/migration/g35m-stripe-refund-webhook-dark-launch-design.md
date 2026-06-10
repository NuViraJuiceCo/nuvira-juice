# G35M Stripe Refund Webhook Dark-Launch Shadow Design

## 1. Executive summary

G35M designs the next stage for real Stripe refund webhook dark-launch shadowing. It does not implement runtime webhook changes.

The future dark-launch shadow should observe real Stripe refund webhook events only after normal Stripe signature validation succeeds, normalize a safe event summary, and run the already-published read-only refund preview path:

```text
previewNativeOrderCutoverReadiness
preview_mode: STRIPE_REFUND_WEBHOOK_SHADOW_PREVIEW
```

The future shadow must not process refunds, call Stripe, call Shopify, call providers, mutate records, create logs or review queues by default, send notifications, alter Hub behavior, or change the production `stripeWebhook` response semantics.

Hub remains the refund source of truth. Native refund writes remain blocked.

## 2. Scope and non-goals

### In scope

- Customer App code audit of current Stripe webhook refund behavior.
- Design of a default-off dark-launch gate contract.
- Design of safe runtime integration with `stripeWebhook` for a future phase.
- Design of normalized event summary fields.
- Design of fail-closed safety behavior and no-write verification requirements.

### Out of scope

G35M does not:

- modify `stripeWebhook`
- modify Stripe webhook behavior
- process refunds
- call Stripe, Shopify, or providers
- mutate Customer App `Order`
- mutate native `ShopifyOrder`
- mutate native `FulfillmentTask`
- mutate `ProductionBatch`
- mutate `BatchComplianceLog`
- create `OrderReviewQueue`
- create `OrderSyncLog`
- create `CommandLog`
- create notifications or message logs
- send notifications
- run sync, retry, repair, or replay
- deduct or restore inventory
- create PurchaseOrders
- open gates
- disable Hub bridge
- publish Base44
- mutate live records

## 3. Current refund preview capabilities

G35M builds on the already-published read-only preview capabilities:

- `STRIPE_REFUND_WEBHOOK_SHADOW_PREVIEW` accepts normalized safe refund-like input only.
- Full refunds route to `NATIVE_REFUND_IMPACT`.
- Partial refunds route to `NATIVE_PARTIAL_REFUND_REVIEW_IMPACT`.
- Delivered and verified orders preserve `ProductionBatch` and `BatchComplianceLog` history in preview.
- Partial refunds produce a future `OrderReviewQueue` draft preview only; no queue row is created.
- Preview paths require no provider calls, no notifications, and no native writes.
- G35H/PATCH5 read consistency policy requires stable exact-ID preview data before any future prewrite dependency can be trusted.

## 4. Current Customer App Stripe webhook refund behavior audit

Audited Customer App files:

- `base44/functions/stripeWebhook/entry.ts`
- `base44/functions/syncRefundToHub/entry.ts`
- `base44/functions/previewNativeOrderCutoverReadiness/entry.ts`
- relevant refund/payment fields on `Order`, `ShopifyOrder`, `OrderSyncLog`, `CommandLog`, and `OrderReviewQueue`

### 4.1 Signature and error boundary

`stripeWebhook` currently reads the request body and `stripe-signature` header, then calls Stripe's webhook signature verification before routing events.

If signature verification fails:

- it returns `400`
- it logs only boundary metadata such as whether the secret/header exists
- it does not log the webhook secret or raw payload

The future dark-launch shadow must run only after this existing validation succeeds.

### 4.2 Currently handled payment/order event types

The current webhook has explicit handling for these important event types:

- `checkout.session.completed`
- `payment_intent.succeeded`
- `invoice.payment_succeeded`
- `invoice.paid`
- `invoice.payment_failed`
- `customer.subscription.deleted`
- `charge.refunded`
- `refund.updated`

Other event types fall through to the final safe `received:true` response.

### 4.3 Current `charge.refunded` behavior

`charge.refunded` is an active mutating path today.

Current behavior includes:

1. Normalizes `charge.payment_intent`.
2. Computes refund amount and full-vs-partial classification from `charge.amount_refunded` and `charge.amount`.
3. Retrieves Stripe PaymentIntent and invoice context to detect subscription refunds.
4. If subscription refund context is found:
   - reads Customer App `Subscription`
   - may update subscription status to `cancelled`
   - may adjust loyalty points
   - invokes Hub sync through `syncCustomerToHub`
   - creates `OrderSyncLog`
   - returns a subscription refund response
5. If one-time order context is found:
   - reads Customer App `Order` by `stripe_payment_intent_id`
   - skips if already refunded/cancelled by existing status checks
   - currently sets Customer App `Order.status` to `refunded`
   - sets `payment_status: refunded`
   - sets `financial_status: refunded`
   - sets refund metadata and `sync_status`
   - appends `status_history`
   - creates `OrderSyncLog`
   - invokes `syncRefundToHub`
   - may restore loyalty points for full refunds
   - invokes refund notification behavior through `sendOrderReceivedNotification`
6. If no order/subscription is found:
   - creates an `OrderSyncLog` error for manual review
   - returns `received:true`

This behavior is the live source-of-truth path today and is intentionally not changed in G35M.

### 4.4 Current partial refund behavior

The current `charge.refunded` one-time path detects partial refunds but still marks the Customer App `Order` as refunded and logs the event. This is a known parity/policy gap from G35A-G35L.

Approved future native policy is different:

- partial refunds route to manual review
- no automatic order cancellation
- no production or compliance mutation
- no notification by default
- no provider calls from preview

G35M does not patch the current live path. It only designs a future default-off shadow path to compare future behavior safely.

### 4.5 Current `refund.updated` behavior

`refund.updated` is explicitly handled.

Current behavior:

- reads `refund.payment_intent`
- looks up `Order` by `stripe_payment_intent_id`
- if refund status is `succeeded` and the order is not terminal, it can repair the Customer App `Order` to a terminal refunded state
- sets `status: refunded`, `payment_status: refunded`, `financial_status: refunded`, `do_not_recover:true`, and status history

This is also a mutating path and must not be changed by G35M.

### 4.6 Refund event types not explicitly handled today

From the Customer App code audit:

- `refund.created` is not explicitly handled by `stripeWebhook`.
- `charge.refund.updated` is not explicitly handled by `stripeWebhook`.

They fall through to the generic `received:true` response unless Stripe aliases or upstream event routing presents them differently.

G35L already supports these event types in read-only shadow preview input, but G35M does not wire them into live webhook routing.

### 4.7 Hub call paths

Current refund-related Hub behavior from Customer App code:

- subscription refund path invokes `syncCustomerToHub`
- one-time order refund path invokes `syncRefundToHub`
- `syncRefundToHub` delegates to `syncOrderToHub` with refund context

Hub remains the refund source of truth. G35M does not change Hub calls.

### 4.8 Notification behavior

Current webhook paths can invoke notifications:

- order confirmation / processed notifications in successful payment paths
- subscription payment failed notifications
- refund notification through `sendOrderReceivedNotification` in the current one-time `charge.refunded` path

The future dark-launch shadow must not send notifications and must not create notification/message rows.

## 5. Dark-launch gate contract

A future implementation should use default-off gates:

```text
ENABLE_STRIPE_REFUND_WEBHOOK_SHADOW_PREVIEW=false
STRIPE_REFUND_WEBHOOK_SHADOW_KILL_SWITCH=true
STRIPE_REFUND_WEBHOOK_SHADOW_ALLOWED_EVENT_TYPES=charge.refunded,refund.created,refund.updated,charge.refund.updated
STRIPE_REFUND_WEBHOOK_SHADOW_LOGGING_MODE=none
STRIPE_REFUND_WEBHOOK_SHADOW_ORDER_ALLOWLIST=
STRIPE_REFUND_WEBHOOK_SHADOW_EVENT_ALLOWLIST=
STRIPE_REFUND_WEBHOOK_SHADOW_SAMPLE_RATE=0
STRIPE_REFUND_WEBHOOK_SHADOW_POLICY=READ_ONLY_NO_MUTATION_NO_PROVIDER_CALLS
```

### Gate rules

- Disabled by default.
- Kill switch active by default.
- Sample rate `0` by default.
- No broad sampling.
- Exact event allowlist or exact order allowlist required for any pilot.
- Allowed event types must be explicit.
- Shadow policy must equal `READ_ONLY_NO_MUTATION_NO_PROVIDER_CALLS`.
- No native refund writes.
- No review queue writes.
- No notification sends.
- No provider calls.
- No Hub mutation.
- No raw payload storage.
- No provider IDs broadly printed in customer-facing UI.
- No auth headers or webhook signatures exposed.

### Gate evaluation order

Future code should evaluate gates in this order:

1. Stripe signature validation already succeeded.
2. Event type is in `STRIPE_REFUND_WEBHOOK_SHADOW_ALLOWED_EVENT_TYPES`.
3. `ENABLE_STRIPE_REFUND_WEBHOOK_SHADOW_PREVIEW=true`.
4. `STRIPE_REFUND_WEBHOOK_SHADOW_KILL_SWITCH=false`.
5. Policy equals `READ_ONLY_NO_MUTATION_NO_PROVIDER_CALLS`.
6. Exact `stripe_event_id` allowlist passes, or exact order allowlist passes after local order lookup.
7. Sample rate is explicitly approved and non-zero only for a later broad dark-launch phase.
8. Logging mode is `none` unless a later phase approves safe redacted diagnostics.

If any gate fails, the shadow branch should skip silently or report safe internal metadata without changing normal webhook behavior.

## 6. Runtime integration strategy for a future phase

A future implementation should integrate with `stripeWebhook` as a non-blocking observer branch.

Required behavior:

- Existing Stripe webhook behavior remains unchanged.
- Existing valid webhook response semantics remain unchanged.
- Existing Hub refund behavior remains source of truth.
- Shadow branch runs only after normal Stripe signature validation succeeds.
- Shadow branch never blocks or delays the normal webhook response.
- Shadow branch failures are swallowed into safe diagnostics.
- Shadow branch must not throw raw stack traces to Stripe.
- Shadow branch must not update order/payment state.
- Shadow branch must not create logs unless logging mode explicitly permits a safe redacted diagnostic record in a later phase.
- Shadow branch must not store raw Stripe payload.
- Shadow branch must not use webhook signature/header values as preview input.

### Recommended future placement

The future shadow should be isolated from the current mutating refund logic. Recommended structure:

```text
construct Stripe event successfully
create base44 client
install staging side-effect guards if applicable
tryShadowPreview(event) fire-and-forget or bounded await with timeout
continue existing event routing unchanged
return existing webhook response unchanged
```

For refund event types, the shadow can run before or after the existing branch only if it does not alter the event object, response, or side effects. A bounded `Promise.race` timeout is recommended if the implementation awaits the preview for diagnostics.

### Timeout policy

Future shadow preview should have a short bounded timeout. If it times out:

- do not fail the Stripe webhook
- do not retry from inside webhook request handling
- do not create logs unless explicitly approved
- record only safe in-memory diagnostic output if available
- return the normal webhook response

## 7. Normalized event contract

Future shadow code should extract a minimal normalized event summary.

Example shape:

```json
{
  "preview_mode": "STRIPE_REFUND_WEBHOOK_SHADOW_PREVIEW",
  "event_type": "refund.created",
  "stripe_event_id": "evt_xxx",
  "stripe_refund_id": "re_xxx",
  "payment_intent_id": "pi_xxx",
  "charge_id": "ch_xxx",
  "refund_type": "partial",
  "source_refund_amount_minor": 500,
  "refund_amount": 5.0,
  "refund_currency": "USD",
  "amount_conversion": "stripe_minor_units_to_decimal",
  "event_source": "stripe_webhook_shadow",
  "raw_payload_included": false
}
```

### Field policy

Allowed normalized fields:

- `preview_mode`
- `event_type`
- `stripe_event_id`
- `stripe_refund_id`
- `payment_intent_id`
- `charge_id`
- `order_number` only if derivable from local records or safe Stripe metadata already used by existing code
- `customer_app_order_id` only if derived from local records
- `native_shopify_order_id` only if derived from local records
- `native_fulfillment_task_id` only if derived from local records
- `refund_type`
- `refund_amount`
- `refund_currency`
- `event_source: stripe_webhook_shadow`
- `request_id` derived from a safe shadow identifier

Forbidden fields:

- raw Stripe event payload
- raw Shopify payload
- raw provider payload
- webhook signature
- auth headers
- secret values
- card or payment method details
- customer PII payloads
- stack traces
- bulk order ids
- command/write flags
- notification payloads

### Amount units and conversion

Use cents/minor units only when the Stripe source object uses minor units, and document the conversion explicitly.

Recommended convention for the future shadow normalizer:

- Read Stripe source amount in minor units when the source field is a Stripe amount field.
- Convert to Customer App preview decimal amount before calling `STRIPE_REFUND_WEBHOOK_SHADOW_PREVIEW`.
- Include safe conversion metadata such as `amount_conversion: stripe_minor_units_to_decimal` in in-memory preview input/output if needed.
- Do not store raw event objects to preserve the original Stripe amount context.
- Do not print provider IDs broadly in customer-facing UI.
- Do not expose auth headers or webhook signatures.

Example:

```text
source_refund_amount_minor=500
refund_amount=5.00
refund_currency=USD
amount_conversion=stripe_minor_units_to_decimal
```

## 8. Preview routing design

Future shadow routing should match G35L exactly:

| Condition | Preview route / classification | Required behavior |
| --- | --- | --- |
| full refund | `NATIVE_REFUND_IMPACT` | no native write, no queue write, no provider call, no notification |
| partial refund | `NATIVE_PARTIAL_REFUND_REVIEW_IMPACT` | review queue draft preview only; no queue write |
| unknown refund type | `unknown_refund_review_required` | manual review classification only |
| unknown order | `unknown_order_refund_review_required` | no provider enrichment |
| duplicate `stripe_event_id` | `duplicate_refund_event_detected` | duplicate classification only |
| partial refund missing amount | `missing_refund_amount_for_partial_preview` | no review queue readiness |
| delivered/verified order | manual review | preserve production/compliance history |

Global routing rules:

- no native write
- no queue write
- no provider call
- no notification
- no Hub mutation
- no Customer App `Order.status=refunded/cancelled/canceled`

If refund type cannot be determined without provider calls:

- return `unknown_refund_review_required`
- do not call Stripe
- do not call Shopify
- do not create logs or queues

If order cannot be linked locally:

- return `unknown_order_refund_review_required`
- do not call Stripe to enrich
- do not call Shopify to enrich
- do not mutate Hub

For any future prewrite dependency:

- exact IDs are preferred over broad lookup
- `preview_data_stable:true` is required
- `read_consistency.stable:true` is required
- no read consistency blockers are allowed
- no command/write planning should proceed from inconclusive preview data

## 9. Idempotency and duplicate preview design

Future shadow preview may read only existing local records to classify duplicate context:

- `OrderSyncLog`
- `CommandLog`
- `OrderReviewQueue`
- `SafeSyncParityLog` if useful

Duplicate indicators:

- existing `stripe_event_id`
- existing `stripe_refund_id`
- existing partial refund review context for the same exact order/refund
- existing success command log for a later approved native command

Shadow preview must not create idempotency rows. If no safe idempotency record exists, it should report that idempotency is unproven, not create one.

## 10. Safe logging design

Initial future dark-launch should use:

```text
STRIPE_REFUND_WEBHOOK_SHADOW_LOGGING_MODE=none
```

Preferred initial behavior:

- no persistent logging
- console warning only for disabled/skipped shadow
- no `OrderSyncLog`, `CommandLog`, `OrderReviewQueue`, `Notification`, or `CustomerMessageDeliveryLog` creation

Future persistent logging, if approved later, should use a dedicated redacted entity, not `OrderSyncLog` or `CommandLog`, unless command/write behavior is actually being executed.

Proposed future entity name:

```text
RefundWebhookShadowLog
```

Safe fields only:

- `request_id`
- `stripe_event_id_hash` or redacted id
- `event_type`
- `refund_type`
- `refund_amount`
- `refund_currency`
- `order_number` if resolved
- `preview_classification`
- `blockers`
- `warnings`
- `read_consistency_stable`
- `writes_performed:false`
- `created_at`

Do not store:

- raw Stripe payload
- raw provider payload
- webhook signature
- auth headers
- secrets
- customer PII
- card/payment method details
- full stack traces

Allowed console diagnostics, if used:

- event type
- whether shadow gate skipped/runs
- redacted or hashed event id only
- preview next action
- writes performed false
- provider calls false

Forbidden diagnostics:

- raw payload
- webhook signature
- auth headers
- secrets
- payment method/card details
- raw customer PII
- full stack traces
- provider IDs in customer-facing UI

## 11. Failure behavior

Shadow failure must fail closed and non-blocking.

| Failure mode | Future behavior |
| --- | --- |
| gate disabled | skip shadow; existing webhook unchanged |
| kill switch active | skip shadow; existing webhook unchanged |
| unsupported event type | skip or safe unsupported classification; existing webhook unchanged |
| missing local order link | unknown-order review classification; no provider call |
| preview timeout | shadow inconclusive; existing webhook unchanged |
| preview throws | catch and suppress from Stripe response; safe diagnostic only |
| read consistency unstable | preview returns blocker/inconclusive; no write readiness |
| duplicate event detected | duplicate classification only; no log/queue write |

## 12. Test matrix for future implementation

A future G35N/G35O implementation should include local harness coverage for:

1. Gate disabled returns normal webhook behavior; shadow skipped.
2. Kill switch active skips shadow.
3. Unsupported event type skipped.
4. Allowed full refund event runs shadow preview only.
5. Allowed partial refund event runs shadow review preview only.
6. Unknown order returns review-required preview only.
7. Duplicate event id returns duplicate classification.
8. Shadow preview failure does not alter webhook response.
9. Shadow timeout does not alter webhook response.
10. No raw payload persisted.
11. No provider calls.
12. No notifications.
13. No record mutations.
14. `charge.refunded` full refund normalizes and routes to G35L full shadow preview.
15. `refund.created` partial refund normalizes and routes to G35L partial review preview.
16. `refund.updated` succeeded normalizes without invoking current repair behavior from shadow.
17. `charge.refund.updated` normalizes if Stripe sends it.
18. Missing amount for partial refund returns `missing_refund_amount_for_partial_preview`.
19. Duplicate `stripe_refund_id` returns duplicate classification.
20. Delivered order full refund preserves batch/compliance history in preview.
21. Delivered order partial refund returns review queue draft preview only.
22. No logs/queues created while logging mode is `none`.
23. No order/task/batch/compliance/inventory/PO/Hub mutation.

## 13. Future rollout sequence

Recommended sequence:

### G35N — dark-launch shadow design-to-harness bridge

- Add a local harness that simulates future `stripeWebhook` shadow gate evaluation.
- No runtime webhook change.
- Validate normalized event extraction from synthetic safe event summaries.

### G35O — default-off `stripeWebhook` shadow wiring PR

Only after owner approval:

- Add default-off gate checks to `stripeWebhook`.
- Keep kill switch active.
- Logging mode remains `none`.
- Require exact event/order allowlist.
- Run shadow preview non-blocking and fail-closed.
- Do not create records.
- Do not change existing webhook response.

### G35P — exact-event dark-launch pilot

Only after G35O is published and owner approves an exact event/order:

- Enable shadow for one exact event or one exact order.
- Keep sample rate `0`.
- No broad rollout.
- No writes.
- Verify live preview result and no-write state.

### G35Q or later — safe diagnostic logging proposal

Only if needed:

- Propose safe redacted diagnostic record schema/contract.
- Separate approval required because any logging creates records.

## 14. Risk and hard stops before real webhook dark-launch

Hard stops:

1. Any need to store raw Stripe payload.
2. Any need to bypass Stripe signature verification.
3. Any shadow path that can fail the live webhook.
4. Any broad event sampling.
5. Any review queue write.
6. Any Customer App/native order mutation.
7. Any notification send.
8. Any provider call.
9. Any Hub mutation.
10. Any use of `Order.status=refunded/cancelled/canceled`.
11. Any attempt to make Customer App refund source of truth before parity is approved.
12. Any creation of `OrderSyncLog`, `CommandLog`, or `OrderReviewQueue` as part of shadow-only observation.
13. Any exposure of auth headers, webhook signatures, secrets, raw provider payloads, customer PII, or card/payment method details.

Do not wire shadow into `stripeWebhook` until all are true:

1. Owner approval is explicit.
2. Gates are default-off and kill switch is active by default.
3. Exact event/order allowlist policy is accepted.
4. No raw payload storage policy is accepted.
5. Shadow path cannot change existing webhook response semantics.
6. Shadow path cannot call Stripe/Shopify/providers.
7. Shadow path cannot call Hub or mutate Hub records.
8. Shadow path cannot create logs, review queues, notifications, or messages while logging mode is `none`.
9. Shadow path cannot mutate Customer App order/task/batch/compliance records.
10. Timeout and exception behavior are tested to be non-blocking.
11. G35L preview remains stable for known exact-id orders.
12. Hub refund source-of-truth policy remains explicit.

## 15. Recommendation

Close G35M as docs/design only.

Keep Hub as refund source of truth. Keep G35J held until there is a real partial refund event or explicit owner-approved test review with exact IDs and fresh stable G35H/G35L preview.

Recommended next phase:

```text
G35N — default-off Stripe refund webhook shadow implementation, no persistent logging, exact event/order allowlist only
```

Alternative: hold until a real refund event is expected.

Do not implement runtime `stripeWebhook` shadow wiring until a separate owner-approved phase.
