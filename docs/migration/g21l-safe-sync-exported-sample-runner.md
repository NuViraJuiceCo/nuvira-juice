# Phase G21L: safeSync Exported-Sample Runner

## Purpose

G21L adds a local-only runner for future redacted real-data safeSync samples.

The runner is intentionally inert until an operator supplies a redacted JSON file. It does not extract samples, read Base44 entities, call Hub, call providers, write logs, or mutate records.

## File

```text
scripts/migration/run-safe-sync-exported-samples.mjs
```

## Default Sample Path

```text
/private/tmp/nuvira-safe-sync-real-samples.redacted.json
```

The sample file must stay outside git. Do not commit real samples.

## Sample Shape

The file may be either an array or an object with a `samples` array.

Each sample requires:

```json
{
  "sample_id": "g21l_sample_001",
  "source": "customer_app",
  "idempotency_key": "redacted_or_stable_key",
  "stripe_event_id": "optional_redacted_or_stable_key",
  "starting_order": {},
  "incoming_payload": {},
  "hub_result": {}
}
```

The sample should already be redacted according to G21K:

- no full street address
- no phone number
- no raw Stripe/Shopify payloads
- no auth headers
- no secrets
- no payment method details
- no delivery proof/drop media or locations
- no full customer notes/internal notes

## Commands

Self-test with synthetic data:

```bash
node scripts/migration/run-safe-sync-exported-samples.mjs --self-test
```

Run an approved redacted sample file:

```bash
node scripts/migration/run-safe-sync-exported-samples.mjs /private/tmp/nuvira-safe-sync-real-samples.redacted.json
```

## Behavior

For each supplied sample, the runner:

1. validates required sample metadata
2. runs the native safeSync dry-run planner in memory
3. runs the dark-launch comparator in memory
4. prints match/mismatch status and aggregate counts
5. exits nonzero if any sample mismatches

## Safety

The runner:

- reads only the supplied local JSON sample file
- does not import Base44 entity clients
- does not call Hub
- does not call Stripe or Shopify
- does not call providers
- does not create/update/delete records
- does not write files
- does not enable native safeSync writes
- does not process orders or refunds

## Next Gate

Before running this on real exported samples, approve:

- exact sample source
- max sample count
- redaction level
- included event types
- whether customer email/order number may remain visible

Refund, repair/replay, provider webhook, notification, and customer-facing delivery samples remain excluded until dedicated approval.
