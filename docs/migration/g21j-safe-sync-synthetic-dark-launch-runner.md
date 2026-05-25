# Phase G21J: Synthetic safeSync Dark-Launch Runner

## Purpose

G21J adds a local-only migration runner that exercises the native safeSync planner and the dark-launch comparator together using synthetic fixtures.

The runner proves the comparison pipeline before any real bridge sampling, persistent parity logging, or native writer work.

## File

```text
scripts/migration/run-safe-sync-dark-launch-comparisons.mjs
```

## Behavior

The runner:

1. loads the 24 synthetic fixtures from `docs/migration/fixtures/safe-sync-order-update/fixtures.json`
2. runs each fixture through `previewNativeSafeSyncOrderUpdate` planner logic in memory
3. converts the native dry-run result into a Hub-shaped golden summary for comparator exercise
4. runs `previewNativeSafeSyncDarkLaunchComparison` comparator logic in memory
5. expects all 24 synthetic comparisons to match
6. runs one synthetic negative case and expects a `blocker` mismatch

## Safety

The runner:

- does not import Base44 entity clients
- does not read live Base44 records
- does not create, update, or delete records
- does not call Hub, Stripe, Shopify, providers, sync, retry, or repair
- does not write files
- does not enable native safeSync writes
- uses synthetic fixture data only

## Command

```bash
node scripts/migration/run-safe-sync-dark-launch-comparisons.mjs
```

Expected output:

```text
24/24 synthetic fixture comparisons matched.
1/1 synthetic negative comparison produced blocker mismatch.
```

## What This Does Not Prove

This runner does not prove real Hub writer parity. It validates the native comparison machinery and fixture path only.

Actual dark launch still requires a separate approved implementation that feeds safe Hub writer result summaries and native dry-run summaries into the comparator without enabling native writes or persistent logging by default.

## Next Gate

Before real bridge sampling:

- decide the exact bridge placement
- decide whether any persistent parity log is allowed
- define sample limits
- verify no customer-facing side effects
- keep native writer disabled
