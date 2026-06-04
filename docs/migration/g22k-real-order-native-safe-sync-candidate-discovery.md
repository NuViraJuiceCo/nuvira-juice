# Phase G22K: Real-order native safeSync candidate discovery

## Purpose

Identify one low-risk real-order candidate for the first native `safeSync` writer pilot after G22J.

This phase is read-only discovery and dry-run preflight only. It does not enable the native writer, does not open writer gates, does not send a live request to `executeNativeSafeSyncOrderUpdate`, and does not mutate a live order.

## Scope and safety boundary

Discovery used the current Base44 CLI authenticated read surface only.

No Stripe, Shopify, provider, notification, Hub sync, broad sync, repair, replay, refund, production, fulfillment, inventory, purchase-order, compliance, or customer-facing state action was called.

No raw provider payloads, full addresses, phone numbers, auth headers, secrets, payment method details, raw webhook bodies, or full customer emails were exported.

## Read-only scan summary

Generated: `2026-06-04T14:56:46.243Z`

| Entity | Read result | Count visible in current CLI read surface |
| --- | ---: | ---: |
| `Order` | OK | 0 |
| `ShopifyOrder` | OK | 7 |
| `OrderSyncLog` | OK | 0 |
| `CommandLog` | OK | 12 |
| `OrderReviewQueue` | OK | 4 |
| `SafeSyncParityLog` | OK | 1 |
| `FulfillmentTask` | OK | 1 |
| `ProductionBatch` | OK | 0 |

The current CLI read surface did not expose Customer App `Order` rows, so no create-from-Customer-App-order candidate was selected in this phase.

The scan evaluated visible native `ShopifyOrder` records for an update-style first pilot. Synthetic G22/G22I records, refunded/canceled records, subscription records, advanced production/fulfillment records, and records with review queue context were excluded.

## Recommended candidate

| Field | Value |
| --- | --- |
| Candidate type | Existing native `ShopifyOrder` update pilot |
| Order number | `1009` |
| Existing native `ShopifyOrder` id | `6a1879c55f79664af02d1daf` |
| Source channel | `online` |
| Fulfillment method | `delivery` |
| Payment status | `paid` |
| Production status | `new` |
| Fulfillment status | `null` |
| Order lock status | `null` / treated as unlocked by planner |
| Line item count | 3 |
| Address signal | present |
| Customer email | redacted as `am***@nuvisionarymedia.com` |
| Current visible sync/review/task context | no `OrderSyncLog`, `CommandLog`, `OrderReviewQueue`, `SafeSyncParityLog`, or `FulfillmentTask` found by order number in the current CLI read surface |

This candidate is not a subscription, refund, cancellation, advanced production state, delivery-status event, proof/drop event, repair/replay event, or provider/payment mutation.

## Excluded visible records

| Order | Reason |
| --- | --- |
| `NV-TEST-G22I-POS-20260604044012` | Synthetic/test record; already fulfilled POS synthetic case. |
| `NV-TEST-G22I-PAYMENT-20260604044012` | Synthetic/test record; review queue context. |
| `NV-TEST-G22I-LOCK-20260604044012` | Synthetic/test record; production-scheduled lock context; review queue context. |
| `NV-TEST-G22I-UPDATE-20260604044012` | Synthetic/test record; review queue context. |
| `NV-G22WTEST-20260604004452` | Synthetic/test record. |
| `NV-MPPU43TO` | Refunded/canceled state. |

## Dry-run preflight results

Three read-only planner shapes were checked.

### Full order-shaped payload

Result: passed, but too broad for a first real-order pilot.

| Field | Result |
| --- | --- |
| `success` | `true` |
| `dry_run` | `true` |
| `would_update_order` | `true` |
| `would_quarantine` | `false` |
| `would_reject` | `false` |
| `error_code` | `null` |
| Accepted field count | 23 |
| Rejected fields | none |

This payload would restate full customer/order/address/line-item fields. It is valid, but the first real pilot should use a narrower mutation.

### Metadata-only payload

Result: rejected by the quality guard, as expected.

| Field | Result |
| --- | --- |
| `success` | `true` |
| `dry_run` | `true` |
| `would_update_order` | `false` |
| `would_quarantine` | `true` |
| `would_reject` | `true` |
| `error_code` | `unknown_quality_would_overwrite_verified_order` |

This confirms the native planner will not accept a sparse update that lacks enough identity context.

### Recommended identity-preserving metadata payload

Result: passed and is the recommended first-pilot shape if owner later approves execution.

| Field | Result |
| --- | --- |
| `success` | `true` |
| `dry_run` | `true` |
| `would_create_order` | `false` |
| `would_update_order` | `true` |
| `would_quarantine` | `false` |
| `would_reject` | `false` |
| `action` | `would_update` |
| `error_code` | `null` |
| `OrderReviewQueue` draft | none |

Accepted field names:

- `shopify_order_number`
- `customer_name`
- `customer_email`
- `sync_status`
- `last_sync_at`
- `stripe_event_id_applied`

Rejected fields: none.

Expected `OrderSyncLog` draft summary:

| Field | Value |
| --- | --- |
| `action` | `updated` |
| `reason` | `source:customer_app, lock:unlocked` |
| `fields_updated` | `shopify_order_number`, `customer_name`, `customer_email`, `sync_status`, `last_sync_at`, `stripe_event_id_applied` |
| `fields_rejected` | none |
| `success` | `true` |
| `error_code` | `null` |

## Proposed execution payload shape

If owner explicitly approves this exact order later, use the identity-preserving metadata payload only:

```json
{
  "source": "customer_app",
  "event_type": "order.updated",
  "incoming_payload": {
    "shopify_order_number": "1009",
    "customer_name": "<existing value from record>",
    "customer_email": "<existing value from record>",
    "sync_status": "native_safe_sync_real_pilot_candidate",
    "last_sync_at": "<current ISO timestamp>"
  }
}
```

Do not store or print the full `customer_name` or `customer_email` outside the in-memory request. The pilot output should report only order id/order number, field names, record ids, status, and side-effect verification.

## Required gates for a future approved pilot

This document does not approve execution. If the exact order is approved later, the writer gates must be restricted to this one order:

```text
ENABLE_NATIVE_SAFE_SYNC_WRITER=true
NATIVE_SAFE_SYNC_WRITER_KILL_SWITCH=false
NATIVE_SAFE_SYNC_WRITER_ALLOWED_SOURCES=customer_app
NATIVE_SAFE_SYNC_WRITER_ALLOWED_EVENTS=order.updated
NATIVE_SAFE_SYNC_WRITER_ORDER_ALLOWLIST=1009,6a1879c55f79664af02d1daf
NATIVE_SAFE_SYNC_WRITER_SECRET=<temporary service secret>
```

After the first call and duplicate idempotency call:

```text
ENABLE_NATIVE_SAFE_SYNC_WRITER=false
NATIVE_SAFE_SYNC_WRITER_KILL_SWITCH=true
NATIVE_SAFE_SYNC_WRITER_ORDER_ALLOWLIST=disabled
NATIVE_SAFE_SYNC_WRITER_ALLOWED_SOURCES=disabled
NATIVE_SAFE_SYNC_WRITER_ALLOWED_EVENTS=disabled
NATIVE_SAFE_SYNC_WRITER_SECRET=disabled
```

## Expected future pilot behavior

First call, if approved:

- native writer returns `success:true`
- action is `updated`
- `writes_performed:true`
- exact `ShopifyOrder` id `6a1879c55f79664af02d1daf` is updated only for accepted fields
- one native `OrderSyncLog` is created
- one native `CommandLog` is created
- no `OrderReviewQueue`
- no provider calls
- no notifications
- no Hub bridge modification
- no production, fulfillment, inventory, purchase order, compliance, refund, repair, or replay side effect

Duplicate call with the same idempotency key:

- returns `idempotent_skip`
- `writes_performed:false`
- no duplicate order mutation
- no duplicate success log

## Hard stops before execution

Stop before any real writer execution if:

- owner does not explicitly approve order `1009` / `6a1879c55f79664af02d1daf`
- the order status changes to refund/cancel/payment-provider related
- the order becomes subscription-related
- production/fulfillment advances beyond the current low-risk state
- a valid preflight no longer matches the expected identity-preserving metadata result
- a Stripe, Shopify, provider, notification, broad sync, repair, replay, refund, inventory, purchase order, production, fulfillment, or compliance action would be required
- the exact order allowlist cannot be enforced
- Base44 runtime/publish state is ambiguous

## Recommendation

Proceed next to owner approval for a one-order pilot only if order `1009` / `6a1879c55f79664af02d1daf` is acceptable.

Recommended next phase:

- `G22L` - one-order native safeSync writer pilot for order `1009`, identity-preserving metadata update only, with exact writer gates and immediate gate shutdown.

Do not execute `G22L` without explicit approval of this exact order and payload shape.
