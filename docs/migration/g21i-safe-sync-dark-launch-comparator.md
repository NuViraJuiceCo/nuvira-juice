# Phase G21I: Native safeSync Dark-Launch Comparator

## Scope

G21I adds a dry-run-only comparison helper:

```text
base44/functions/previewNativeSafeSyncDarkLaunchComparison/entry.ts
```

The helper compares a supplied Hub result summary against a supplied native dry-run result summary. It does not call Hub, does not call the native writer, does not read live records, and does not create logs.

## Allowed Inputs

- `mode: "dry_run"`
- `fixture_id`
- `source`
- `idempotency_key`
- `hub_result`
- `native_result`

Both result objects should already be safe summaries or dry-run outputs. The function extracts field names, actions, queue incident type, sync-log action, booleans, and error codes.

## Forbidden Inputs

The helper does not support:

- `mode: "live"`
- native writer flags
- raw provider execution payloads
- auth headers or secrets
- bulk IDs
- notification flags
- sync/retry/repair flags

## Output

The helper returns safe comparison metadata only:

- `success`
- `dry_run`
- `dark_launch`
- `native_writer_enabled:false`
- `hub_remains_live_writer:true`
- `matched`
- `mismatch_category`
- `mismatches`
- normalized Hub/native summaries
- warnings

The normalized summaries intentionally contain field names and status-like metadata, not raw order records.

## Mismatch Severity

- `blocker`: action/create/update/reject/error behavior differs.
- `high`: accepted/rejected field differences include lock, payment, subscription, line item, fulfillment, production snapshot, address, or lifecycle fields.
- `medium`: log draft or queue incident differs.
- `low`: reserved for harmless metadata differences.

## Non-Goals

G21I does not:

- enable native `safeSyncOrderUpdate` writes
- create `OrderSyncLog`, `OrderReviewQueue`, or `CommandLog`
- create/update `ShopifyOrder` or Customer App `Order`
- call Stripe, Shopify, providers, sync, retry, repair, or notification systems
- change checkout, subscription, payment, production, fulfillment, inventory, or compliance behavior

## Boundary Verification After Publish

Use only synthetic summaries:

1. `GET /api/functions/previewNativeSafeSyncDarkLaunchComparison` should return `405`.
2. Synthetic matching `POST` should return `200`, `success:true`, `dry_run:true`, `matched:true`.
3. Synthetic mismatch `POST` should return `200`, `matched:false`, with a safe `mismatch_category`.
4. `POST` with `mode:"live"` should return `400 dry_run_only`.

Do not run against live orders until a separate dark-launch sample plan is approved.
