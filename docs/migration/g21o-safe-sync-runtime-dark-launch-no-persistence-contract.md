# Phase G21O: safeSync Runtime Dark-Launch No-Persistence Contract

## Purpose

Define the first runtime dark-launch shape for native Customer App `safeSyncOrderUpdate` without enabling native writes or persistent parity logging.

This phase is contract-only. It does not modify runtime code, publish Builder, sample more real data, create logs, or mutate records.

## Current Readiness

| Gate | Status | Evidence |
| --- | --- | --- |
| Synthetic native safeSync fixtures | Passing | `24/24` fixture runner passed. |
| Synthetic comparator negative | Passing | `1/1` synthetic negative produced `blocker`. |
| Redacted real exported samples | Passing | `6/6` exported sample runner passed. |
| Comparator policy | Documented | G21N policy merged. |
| Native writer | Disabled | No native `safeSyncOrderUpdate` writer exists or is enabled. |
| Persistent parity logging | Not approved | G21N recommends no-persistence first. |

## First Runtime Dark-Launch Scope

The first runtime dark launch should instrument only the Customer App bridge path that already sends paid Customer App orders to Hub:

```text
base44/functions/syncOrderToHub/entry.ts
```

Initial included source:

```text
customer_app
```

Initial included event:

```text
order.created
```

Initial excluded sources/events:

- `order.refunded`
- Stripe refund webhook paths
- Shopify webhook/provider paths
- repair/retry/replay/backfill/manual recovery paths
- subscription cancellation/downgrade/destructive update paths
- customer-facing delivery status events
- delivered/out-for-delivery/proof/drop/unable-to-deliver paths
- notifications
- production, fulfillment, inventory, purchase order, compliance, credits, or bag-return flows

## Bridge Insertion Point

Future implementation should run the native planner/comparator only after the Hub response is received and normalized, because comparison needs the actual Hub action summary.

Recommended insertion point in `syncOrderToHub`:

1. Existing code builds `payload`.
2. Existing code calls Hub `receiveCustomerAppEvent`.
3. Existing code parses `hubResponse`.
4. Existing code normalizes:
   - `hubAction`
   - `hubOrderId`
   - `matchedHubOrderId`
   - `logStatus`
   - `logLabel`
5. **New no-persistence dark-launch comparison runs here.**
6. Existing `OrderSyncLog.create` behavior remains unchanged.
7. Existing response behavior remains unchanged unless explicit safe debug return is enabled for a manual sampled request.

The comparison must never run before the existing Hub call in a way that could block or alter Hub writes.

## Runtime Data Mapping

The native planner expects a safeSync-like incoming payload, not the outer Customer App event wrapper. For this first bridge path, map:

```text
payload.order -> native incoming_payload
source -> customer_app
idempotency_key -> stable event key if available, otherwise deterministic sampled bridge key
```

Field mapping should preserve only the same operational fields already being sent to Hub:

- `shopify_order_number`
- customer identity fields already in `payload.order`
- address fields already in `payload.order`
- `line_items`
- `subtotal`
- `total_price`
- `fulfillment_method`
- date/window fields
- `payment_status`
- Stripe id fields already in `payload.order`
- `order_type`
- `fulfillment_mode`
- `production_status`
- `sync_status` if present

The dark-launch code must not add new source data, hydrate from Stripe/Shopify, read additional records, or inspect browser/client state.

## Hub Result Summary Contract

The comparator should receive a safe Hub summary, not raw `hubResponse`.

Hub summary shape:

```json
{
  "action": "created",
  "status": "success",
  "hub_order_id_present": true,
  "matched_hub_order_id_present": false,
  "fields_updated": [],
  "fields_rejected": [],
  "error_code": null,
  "order_sync_log_draft": {
    "action": "created",
    "success": true,
    "fields_updated": [],
    "fields_rejected": [],
    "error_code": null
  },
  "order_review_queue_draft": null
}
```

Important limitation: the current Hub bridge response does not include full accepted/rejected field lists. For runtime no-persistence smoke, the implementation should compare action/log/queue/error/idempotency first and classify field-list absence as `redaction_limitation` or `needs_manual_review` rather than pretending Hub field-level parity is proven.

Full field-level runtime parity requires either:

- a future Hub dry-run/write-plan response, or
- a dedicated safe summary extension from Hub, or
- a persistent offline sample path with manually approved Hub-equivalent field summaries.

## Native Planner Contract

The native planner call remains dry-run only:

```json
{
  "mode": "dry_run",
  "source": "customer_app",
  "idempotency_key": "safe_key",
  "incoming_payload": {},
  "starting_order": null
}
```

The first runtime dark launch must not read existing native `ShopifyOrder` records. Therefore:

- create-path comparisons can use `starting_order:null`
- update/idempotency comparisons that require existing state should be classified as `needs_manual_review` unless a safe starting state is explicitly supplied by the current bridge context
- duplicate/dedupe parity remains better covered by exported samples until runtime has a safe state source

## Feature Flags

Required future flags:

| Flag | Required Default | Purpose |
| --- | --- | --- |
| `ENABLE_NATIVE_SAFE_SYNC_DARK_LAUNCH` | absent/false | Master gate. If not exactly `true`, no comparison runs. |
| `NATIVE_SAFE_SYNC_DARK_LAUNCH_SAMPLE_RATE` | `0` | Decimal 0-1. First publish should default to `0` unless an explicit pilot value is approved. |
| `NATIVE_SAFE_SYNC_DARK_LAUNCH_ALLOWED_SOURCES` | empty | Comma-separated sources. First approved value should be `customer_app`. |
| `NATIVE_SAFE_SYNC_DARK_LAUNCH_ALLOWED_EVENTS` | empty | Comma-separated events. First approved value should be `order.created`. |
| `NATIVE_SAFE_SYNC_DARK_LAUNCH_LOGGING_MODE` | `none` | Must be `none` for G21P. Entity/file logging remains forbidden. |
| `NATIVE_SAFE_SYNC_DARK_LAUNCH_RETURN_DEBUG` | absent/false | If true and the request is manual/admin sampled, include safe comparison summary in response. |
| `NATIVE_SAFE_SYNC_DARK_LAUNCH_KILL_SWITCH` | absent/false | If exactly `true`, dark launch must not run even when other flags are enabled. |

Any missing, malformed, or out-of-range config should fail closed and skip the dark-launch comparison without changing normal Hub sync behavior.

## Sampling Policy

First implementation should use deterministic sampling:

1. Build a stable sample key from `order.id`, `order.order_number`, or an available idempotency/event key.
2. Hash the key.
3. Compare hash bucket to `NATIVE_SAFE_SYNC_DARK_LAUNCH_SAMPLE_RATE`.

Sampling must not use non-deterministic random selection for a given event, because repeat debugging needs stable inclusion/exclusion.

Manual sampled requests may bypass the sample-rate only if:

- source and event are allowlisted
- master flag is enabled
- request explicitly asks for dry-run dark-launch comparison
- no live mutation beyond the existing Hub bridge occurs

## No-Persistence Policy

G21P must not create or update:

- `ShopifyOrder`
- Customer App `Order`
- `OrderSyncLog` beyond the existing current bridge log
- `OrderReviewQueue`
- `CommandLog`
- `SafeSyncParityLog`
- local files
- external logs or provider systems

No-persistence means:

- no entity writes for parity output
- no file writes
- no new sync/retry/repair queue
- no provider calls
- no notification

If safe debug output is needed, return only safe metadata in the function response for explicitly sampled/manual calls. Do not include raw order records, full address, phone, provider payloads, auth headers, secrets, or stack traces.

## Safe Debug Response Shape

If `NATIVE_SAFE_SYNC_DARK_LAUNCH_RETURN_DEBUG=true` and the request is explicitly sampled/manual, response may include:

```json
{
  "dark_launch": {
    "enabled": true,
    "sampled": true,
    "source": "customer_app",
    "event": "order.created",
    "parity_status": "match",
    "mismatch_category": null,
    "mismatch_count": 0,
    "warnings": [],
    "native_writer_enabled": false,
    "hub_remains_live_writer": true
  }
}
```

Response must not include:

- raw `payload`
- raw `hubResponse`
- raw native proposed order state
- full customer PII
- raw address/phone
- Stripe/Shopify/provider payloads
- auth headers/secrets
- stack traces

## Error Handling

Dark-launch comparison failure must never fail the active Hub bridge.

If comparison throws:

- normal Hub result should still be returned
- existing `OrderSyncLog` behavior should remain unchanged
- safe debug response may include `dark_launch.error_code = "dark_launch_failed"` only when debug return is enabled
- no retry/repair/sync tool should be triggered

## Runtime Safety Rules

Future implementation must not:

- call Stripe
- call Shopify
- call Hub beyond the existing current bridge call
- call providers
- run sync/retry/repair
- send notifications
- create or update native operational records
- create persistent parity logs
- alter checkout/subscription/payment behavior
- alter Hub request payload
- block or alter Hub response handling
- process refunds
- inspect or mutate delivery/proof/drop state
- mutate production, fulfillment, inventory, purchase order, compliance, credits, or bag-return state

## G21P Implementation Boundary

Approved implementation scope for the next PR, if owner approves G21P:

- Customer App repo only.
- Likely file:
  - `base44/functions/syncOrderToHub/entry.ts`
- Optional docs update under `docs/migration/`.
- Add helper functions only inside `syncOrderToHub` unless a shared helper is already safely available.
- Reuse existing native planner/comparator logic only if it can be imported or copied without enabling writes.
- No schema changes.
- No UI.
- No automations.
- No Builder publish until PR audit and scoped publish preflight pass.

Implementation should be narrow enough that disabling `ENABLE_NATIVE_SAFE_SYNC_DARK_LAUNCH` restores exactly the current behavior.

## Boundary Verification After Publish

After a future G21P publish, verify without real order processing first:

1. Feature flag absent/false:
   - normal code path unchanged
   - no dark-launch summary
2. `mode:"live"` remains unsupported in native planner/comparator endpoints.
3. Synthetic/manual dry-run comparison still passes.
4. No entity writes beyond existing bridge behavior.
5. No new records in `CommandLog`, `OrderReviewQueue`, or parity log entities.

Controlled runtime smoke must be separately approved before invoking `syncOrderToHub` on a real order.

## Hard Stops

Stop before:

- enabling nonzero sample rate for live traffic
- invoking `syncOrderToHub` on a real order for dark-launch smoke
- creating persistent parity logs
- adding schema/entities for parity logs
- reading native `ShopifyOrder` state during runtime comparison
- sampling refund/payment/provider paths
- sampling repair/retry/replay/backfill paths
- sampling customer-facing delivery/proof/drop paths
- enabling native writer
- publishing if Builder has unrelated pending changes

## Recommended Next Phase

Proceed to **G21P: no-persistence runtime dark-launch PR prep** only after confirming this contract is acceptable.

Recommended G21P posture:

- implement feature-gated comparison in `syncOrderToHub`
- default all flags to off/skip
- no persistent logs
- no native writes
- no behavior change when disabled
- no live runtime smoke until after PR audit, merge, publish, and explicit pilot approval
