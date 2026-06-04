# G22L Owner-Confirmed Test Order Native SafeSync Pilot Result

Date: 2026-06-04

## Scope

G22L ran the first native safeSync writer pilot against a live record that Amar confirmed was a test order created by him.

This was not an ordinary customer-order pilot and does not broaden native writer eligibility.

| Item | Value |
| --- | --- |
| Order number | `1009` |
| Native `ShopifyOrder` id | `6a1879c55f79664af02d1daf` |
| Classification | owner-confirmed test order |
| Record type | live record, not a real customer order |
| Pilot type | existing native order update |
| Payload type | identity-preserving metadata update only |
| Request id | `g22l_native_safe_sync_test_order_1009_20260604153501` |

## Prerequisite Patch

Before the live pilot, the native writer did not have an actor/email allowlist gate. G22L required an exact actor/email allowlist, so a prerequisite patch was made.

PR: `https://github.com/NuViraJuiceCo/nuvira-juice/pull/327`

| Field | Value |
| --- | --- |
| Branch | `codex/g22l-safe-sync-writer-actor-allowlist` |
| Commit | `9b1571882d1dac8bfd071ff62b0c079a064b7697` |
| Merge commit | `70a78c0fbc1837f94ec8439bf172d70b9107a6d7` |
| Changed files | `base44/functions/executeNativeSafeSyncOrderUpdate/entry.ts`, `docs/migration/g22k-real-order-native-safe-sync-candidate-discovery.md` |
| Publish | Published from Base44 Builder Version History |

The patch added:

- `NATIVE_SAFE_SYNC_WRITER_ACTOR_EMAIL_ALLOWLIST`
- fallback alias `NATIVE_SAFE_SYNC_WRITER_ACTOR_ALLOWLIST`
- fail-closed actor gating before live writer execution

For the service-secret path used in this pilot, the resolved actor is `system`.

## Gate Configuration

Only secret names and non-secret gate values are recorded here. The temporary writer secret value was not printed, committed, logged, or documented.

### Preflight Dry-Run Gates

| Gate | Value |
| --- | --- |
| `ENABLE_NATIVE_SAFE_SYNC_WRITER` | `false` |
| `NATIVE_SAFE_SYNC_WRITER_KILL_SWITCH` | `true` |
| `NATIVE_SAFE_SYNC_WRITER_ALLOWED_SOURCES` | `customer_app` |
| `NATIVE_SAFE_SYNC_WRITER_ALLOWED_EVENTS` | `order.updated` |
| `NATIVE_SAFE_SYNC_WRITER_ORDER_ALLOWLIST` | `1009,6a1879c55f79664af02d1daf` |
| `NATIVE_SAFE_SYNC_WRITER_ACTOR_EMAIL_ALLOWLIST` | `system` |
| `NATIVE_SAFE_SYNC_WRITER_SECRET` | temporary random value, not recorded |

### Live Pilot Gates

| Gate | Value |
| --- | --- |
| `ENABLE_NATIVE_SAFE_SYNC_WRITER` | `true` |
| `NATIVE_SAFE_SYNC_WRITER_KILL_SWITCH` | `false` |
| `NATIVE_SAFE_SYNC_WRITER_ALLOWED_SOURCES` | `customer_app` |
| `NATIVE_SAFE_SYNC_WRITER_ALLOWED_EVENTS` | `order.updated` |
| `NATIVE_SAFE_SYNC_WRITER_ORDER_ALLOWLIST` | `1009,6a1879c55f79664af02d1daf` |
| `NATIVE_SAFE_SYNC_WRITER_ACTOR_EMAIL_ALLOWLIST` | `system` |
| `NATIVE_SAFE_SYNC_WRITER_SECRET` | temporary random value, not recorded |

### Closed Gates

The gates were closed immediately after the first writer call and duplicate idempotency check.

| Gate | Value |
| --- | --- |
| `ENABLE_NATIVE_SAFE_SYNC_WRITER` | `false` |
| `NATIVE_SAFE_SYNC_WRITER_KILL_SWITCH` | `true` |
| `NATIVE_SAFE_SYNC_WRITER_ORDER_ALLOWLIST` | `disabled` |
| `NATIVE_SAFE_SYNC_WRITER_ALLOWED_SOURCES` | `disabled` |
| `NATIVE_SAFE_SYNC_WRITER_ALLOWED_EVENTS` | `disabled` |
| `NATIVE_SAFE_SYNC_WRITER_ACTOR_EMAIL_ALLOWLIST` | `disabled` |
| `NATIVE_SAFE_SYNC_WRITER_SECRET` | `disabled` |

## Dry-Run Result

The exact order dry-run was run before enabling the live writer.

| Check | Result |
| --- | --- |
| `success` | `true` |
| `would_update_order` | `true` |
| `would_create_order` | `false` |
| `would_quarantine` | `false` |
| `would_reject` | `false` |
| `error_code` | `null` |
| rejected fields | none |
| `OrderReviewQueue` draft | none |
| `OrderSyncLog` draft action | `would_update` |
| `CommandLog` draft | present |

Accepted field names were limited to:

- `customer_email`
- `customer_name`
- `last_sync_at`
- `shopify_order_number`
- `stripe_event_id_applied`
- `sync_status`

The dry-run did not approve changes to:

- `line_items`
- `fulfillments`
- `payment_status`
- `production_status`
- `fulfillment_status`
- customer-facing delivery/status fields
- provider ids

## Before Snapshot

Counts for request id `g22l_native_safe_sync_test_order_1009_20260604153501` before the live writer call:

| Entity / log | Count |
| --- | ---: |
| `OrderSyncLog` | 0 |
| `CommandLog` | 0 |
| `OrderReviewQueue` for order | 0 |
| Customer App `Order` for order number | 0 |
| `FulfillmentTask` for order | 0 |
| `Notification` for request id | 0 |
| `CustomerMessageDeliveryLog` for request id | 0 |
| `SafeSyncParityLog` for request id | 0 |

## First Writer Result

Exactly one live native writer call was made.

| Field | Result |
| --- | --- |
| `success` | `true` |
| `skipped` | `false` |
| `action` | `updated` |
| `error_code` | `null` |
| `writes_performed` | `true` |
| `order_id` | `6a1879c55f79664af02d1daf` |
| `order_number` | `1009` |
| `provider_calls_performed` | `false` |
| `notifications_sent` | `false` |
| `hub_bridge_modified` | `false` |
| accepted field count | 6 |
| rejected fields | none |
| `would_quarantine` | `false` |
| `would_reject` | `false` |

## Duplicate Idempotency Result

The same request id was submitted a second time.

| Field | Result |
| --- | --- |
| `success` | `true` |
| `skipped` | `true` |
| `action` | `idempotent_skip` |
| `error_code` | `null` |
| `writes_performed` | `false` |
| existing log entity | `CommandLog` |
| existing log id | `6a219d52a9fb684ea8c031c0` |

No second mutation and no duplicate success log were created.

## After Snapshot

Counts after the first writer call and duplicate idempotency call:

| Entity / log | Count | Details |
| --- | ---: | --- |
| `OrderSyncLog` | 1 | id `6a219d51e1b369c1297205fc`, action `updated`, status `success` |
| `CommandLog` | 1 | id `6a219d52a9fb684ea8c031c0`, status `success`, actor `system` |
| `OrderReviewQueue` for order | 0 | none |
| Customer App `Order` for order number | 0 | none |
| `FulfillmentTask` for order | 0 | none |
| `Notification` for request id | 0 | none |
| `CustomerMessageDeliveryLog` for request id | 0 | none |
| `SafeSyncParityLog` for request id | 0 | none expected for writer pilot |

The `OrderSyncLog` and `CommandLog` accepted fields were exactly:

- `shopify_order_number`
- `customer_name`
- `customer_email`
- `sync_status`
- `last_sync_at`
- `stripe_event_id_applied`

Rejected fields were empty in both logs.

## Exact Field Delta

| Field | Before | After | Result |
| --- | --- | --- | --- |
| `sync_status` | `null` | `native_safe_sync_owner_test_pilot` | changed |
| `last_sync_at` | `null` | `2026-06-04T15:44:15.397Z` | changed |
| `stripe_event_id_applied` | `null` | request id | changed |
| `customer_name` | unchanged | unchanged | no material change |
| `customer_email` | unchanged | unchanged | no material change |
| `line_items` | unchanged | unchanged | passed |
| `payment_status` | `paid` | `paid` | passed |
| `production_status` | `new` | `new` | passed |
| `fulfillment_status` | `null` | `null` | passed |

### Watch Item: `fulfillments` Shape

The verification detected `fulfillments` as changed, even though:

- `fulfillments` was not in the accepted field list
- `fulfillments` was not in `OrderSyncLog.fields_updated`
- `fulfillments` was not in `CommandLog.payload_accepted_fields`
- the after-state is an empty array with `fulfillment_count:0`

This likely reflects Base44/entity normalization from absent/null to an empty array. It did not create a fulfillment task or customer-facing change. Still, this must be treated as a watch item and resolved or explicitly accepted before any ordinary real-customer native writer pilot.

## Side-Effect Verification

| Area | Result |
| --- | --- |
| Stripe call | none |
| Shopify call | none |
| provider call | none |
| customer notification | none |
| `Notification` record | none |
| `CustomerMessageDeliveryLog` record | none |
| Customer App `Order` mutation | none detected |
| `OrderReviewQueue` | none created |
| `FulfillmentTask` | none created |
| production mutation | none detected |
| inventory mutation | none detected |
| compliance mutation | none detected |
| Hub bridge disabled | no |
| Hub bridge modified by native writer | no |

The native writer path contains no provider `fetch()` path and reported `provider_calls_performed:false`.

## Gate Shutdown Verification

After the live writer and duplicate idempotency call, native writer gates were closed.

Disabled-boundary request result:

| Field | Result |
| --- | --- |
| `success` | `false` |
| `skipped` | `true` |
| `error_code` | `event_not_allowed` |

Closed-boundary request counts:

| Entity / log | Count |
| --- | ---: |
| `OrderSyncLog` | 0 |
| `CommandLog` | 0 |
| `OrderReviewQueue` | 0 |
| `Notification` | 0 |
| `CustomerMessageDeliveryLog` | 0 |

Native writer gates are closed again, and the native writer remains disabled for real orders.

## Recommendation

Close G22L as an owner-confirmed test-order native safeSync writer pilot with a watch item.

Do not proceed to an ordinary real-customer native writer pilot yet.

Recommended next phase:

`G22M` - audit and patch or explicitly document the `fulfillments` absent/null-to-empty-array normalization behavior before any broader pilot.

After G22M, the next safe step is either:

- run another owner-confirmed test-order pilot after the normalization behavior is resolved, or
- plan the first ordinary real-customer pilot only after explicit approval and all dry-run/gate conditions pass.

## Hard Boundaries Preserved

- Native writer was not broadly enabled.
- Native writer gates were exact-order, exact-source, exact-event, and exact-actor scoped.
- No real customer order was used.
- No customer-facing status was changed.
- No payment status was changed.
- No line items were changed.
- No provider ids were changed.
- No Stripe, Shopify, or provider call occurred.
- No notification was sent.
- Hub bridge remains fallback and was not disabled.
