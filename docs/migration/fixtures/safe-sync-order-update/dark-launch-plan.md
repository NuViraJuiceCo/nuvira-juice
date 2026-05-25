# Native safeSyncOrderUpdate Dark Launch Plan

This plan defines the next safe parity layer after G21G. It does not enable native writes.

## Current State

- Hub `safeSyncOrderUpdate` remains the live writer.
- Customer App `previewNativeSafeSyncOrderUpdate` is dry-run only.
- Fixture runner executes synthetic fixtures only.
- No native `ShopifyOrder`, `OrderSyncLog`, `OrderReviewQueue`, or `CommandLog` records are created by the native path.

## Dark Launch Goal

For the same input that the Customer App currently sends through the bridge, compute a native dry-run output and compare it against the Hub write result. Hub remains authoritative during dark launch.

## Proposed Flow

1. Current bridge receives an order sync input.
2. Bridge sends the input to Hub as it does today.
3. Before or after the Hub call, Customer App native planner computes a dry-run result from the same normalized input and existing order snapshot.
4. Comparison logic records only safe parity metadata after explicit approval.
5. Any mismatch is reviewed before native writer work continues.

## Comparison Fields

Compare these fields first:

- accepted field names
- rejected field names and rejection reasons
- proposed order status fields
- proposed payment status fields
- proposed production and fulfillment lock fields
- `OrderSyncLog` draft action, success, idempotency key, and field lists
- `OrderReviewQueue` draft incident type and recommended action
- response action and error code
- create/update/reject/quarantine booleans

Do not compare or store raw provider payloads, auth headers, secrets, stack traces, or full raw live order records.

## Mismatch Categories

- `blocker`: native would create/update when Hub rejects, native would reject when Hub writes, or idempotency differs.
- `high`: accepted/rejected fields differ for lock, payment, subscription, line item, fulfillment, or production snapshot fields.
- `medium`: log or queue draft differs but write plan is equivalent.
- `low`: harmless formatting, warning wording, or metadata-only differences.

## Acceptance Threshold Before Native Writer

Native writer work should not begin until:

- zero blocker mismatches
- zero high mismatches
- medium mismatches are either fixed or documented as intentional
- low mismatches do not affect auditability or idempotency
- sample coverage includes one-time orders, subscriptions, POS, refunds, duplicate events, lock states, production snapshots, and low-quality quarantine cases

## Logging Design For Future Approval

If a parity log is later approved, prefer a native Customer App `CommandLog` entry or dedicated `SafeSyncParityLog` entity with safe metadata only:

- `request_id` or idempotency key
- source
- fixture or input class
- Hub action
- native dry-run action
- mismatch category
- field-name-only diff
- timestamps

Do not log raw customer PII, raw Stripe/Shopify payloads, auth headers, secrets, stack traces, or full order records.

## Disable And Rollback

Dark launch must be controlled by a server-side feature flag. Disabling the flag should stop native dry-run comparison immediately while leaving the current Hub bridge writer unchanged.

## Hard Stops

Stop dark launch if comparison requires:

- native writes
- Stripe or Shopify calls
- broad sync/retry/repair
- customer notifications
- customer-facing status changes
- raw provider payload logging
- schema changes outside the approved parity log scope
