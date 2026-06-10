# G35L Stripe Refund Webhook Shadow Preview

## 1. Executive summary

G35L adds a read-only Stripe refund webhook shadow preview mode to `previewNativeOrderCutoverReadiness`:

```text
STRIPE_REFUND_WEBHOOK_SHADOW_PREVIEW
```

The shadow preview accepts normalized, safe refund-like event fields and routes them into existing native refund impact preview logic. It does not modify the production `stripeWebhook` endpoint and does not acknowledge, alter, or replace real Stripe delivery behavior.

Hub remains the refund source of truth. Native refund writes remain blocked.

## 2. Current Customer App Stripe refund behavior audit

Customer App `stripeWebhook` currently contains live refund behavior outside this shadow path:

- `charge.refunded` is handled as an active webhook path.
- The handler retrieves Stripe PaymentIntent / invoice context to detect subscriptions.
- Subscription refund handling can update subscription state, loyalty points, `OrderSyncLog`, and Hub sync context.
- One-time order refund handling looks up `Order` by `stripe_payment_intent_id`.
- One-time full and partial refunds currently update Customer App `Order` fields including `status: refunded`, `payment_status: refunded`, `financial_status: refunded`, refund metadata, `sync_status`, and `status_history`.
- The one-time refund path creates `OrderSyncLog`, invokes `syncRefundToHub`, may restore loyalty points, and invokes a notification helper.
- `refund.updated` can repair an order into terminal refunded state.

Those live paths are intentionally not changed in G35L.

## 3. Hub refund behavior context

The earlier G35A/G35F audits remain the policy basis:

- Hub has the operational full refund cascade through `processStripeRefund` and Customer App refund event ingestion.
- Hub treats partial refunds as review events instead of automatic cancellation.
- Hub remains the refund source of truth until native preview, schema, idempotency, and owner-approved command behavior are fully proven.

The local Hub checkout available in this environment is a placeholder/read-only audit shell, so G35L does not claim a fresh Hub source-code audit beyond the already documented G35 policy findings.

## 4. Supported shadow input fields

The preview accepts only normalized fields:

- `preview_mode: STRIPE_REFUND_WEBHOOK_SHADOW_PREVIEW`
- `event_type`
- `stripe_event_id`
- `stripe_refund_id`
- `payment_intent_id`
- `charge_id`
- `order_number`
- `customer_app_order_id`
- `native_shopify_order_id`
- `native_fulfillment_task_id`
- `refund_type`
- `refund_amount`
- `refund_currency`
- `event_source`
- `request_id`

Supported event types:

- `charge.refunded`
- `refund.created`
- `refund.updated`
- `charge.refund.updated`

Supported event sources:

- `admin_shadow_preview`
- `synthetic_fixture`
- `stripe_webhook_shadow`

## 5. Unsupported raw payload policy

G35L does not accept or store:

- raw Stripe event payloads
- raw Shopify payloads
- raw provider payloads
- webhook signatures
- secrets or auth headers
- card details or payment method details
- customer PII payloads

Unsupported keys are rejected before preview execution.

## 6. Normalization behavior

The shadow preview normalizes:

- `event_type_supported`
- `normalized_refund_type`
- `normalized_refund_amount`
- `normalized_refund_currency`
- idempotency key source:
  - `stripe_event_id`
  - `stripe_refund_id`
  - `request_id` only for admin shadow preview fallback
- local order lookup strategy:
  - exact order number / Customer App Order id / native ShopifyOrder id
  - local `payment_intent_id` fields if present on existing records
  - local `charge_id` fields if present on existing records

No provider API is called to fill missing data. If an event cannot be linked locally, the preview returns unknown-order review classification.

## 7. Routing to existing previews

G35L routes normalized events as follows:

| Normalized refund type | Routed preview |
| --- | --- |
| `full` | `NATIVE_REFUND_IMPACT` |
| `partial` | `NATIVE_PARTIAL_REFUND_REVIEW_IMPACT` |
| `unknown` | review required / Hub source-of-truth hold |

Partial refunds require `refund_amount` and `refund_currency` for review-preview readiness.

## 8. Idempotency preview behavior

G35L reads only:

- `OrderSyncLog`
- `CommandLog`
- `OrderReviewQueue`
- `SafeSyncParityLog` indirectly through routed preview where applicable

It detects:

- duplicate `stripe_event_id`
- duplicate `stripe_refund_id`
- existing review queue context for the same refund/order

No logs or queue rows are created.

## 9. Policy behavior

G35L enforces:

- no provider calls
- no Stripe calls
- no Shopify calls
- no webhook signature verification requirement because this is not the live webhook endpoint
- no raw event storage
- no customer notification
- no Customer App `Order.status=refunded/cancelled/canceled` mutation
- refund-specific fields are preview-only
- delivered/fulfilled refunds route to manual review
- partial refunds route to review queue preview
- unknown order refunds route to manual review
- Hub remains refund source of truth

## 10. Expected shadow preview outcomes

| Scenario | Expected next action |
| --- | --- |
| full refund for delivered order | `shadow_preview_full_refund_manual_review_required` |
| partial refund with amount/currency | `shadow_preview_partial_refund_review_required` |
| partial refund missing amount | `missing_refund_amount_for_partial_preview` |
| unknown order | `unknown_order_refund_review_required` |
| unsupported event type | `unsupported_stripe_refund_event_type` |
| duplicate Stripe event/refund id | `duplicate_refund_event_detected` |

## 11. Hard stops before live webhook shadowing

Do not wire this into the production Stripe webhook path until separately approved.

Before any live webhook shadow or command phase:

1. Owner approval is explicit.
2. Production `stripeWebhook` behavior is not modified accidentally.
3. Raw payload storage policy is approved.
4. Idempotency policy is proven against real event ids without writes.
5. Hub source-of-truth handoff remains explicit.
6. Notification policy remains no-notification unless approved.
7. Provider-call policy remains no-provider-call for preview.
8. No native refund write command is introduced.

## 12. Recommended next phase

Recommended next phase:

- Close G35L after publish/smoke verification.
- Keep Hub refund source of truth.
- Plan real Stripe webhook dark-launch shadow only later, with explicit owner approval.
- Keep G35I/G35J write behavior held until a real partial refund event or owner-approved test review exists.
