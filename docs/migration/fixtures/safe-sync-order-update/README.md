# Native safeSyncOrderUpdate Fixture Library

This fixture library supports Phase G21F native Customer App `safeSyncOrderUpdate` parity work.

The fixtures are synthetic and must not be used as live records. They are designed for dry-run planning only:

- no Customer App entities are read
- no Customer App entities are written
- no `OrderSyncLog`, `OrderReviewQueue`, or `CommandLog` records are created
- no Stripe, Shopify, provider, sync, retry, repair, notification, production, fulfillment, inventory, or compliance behavior is invoked

## Files

- `fixtures.json`: table-driven fixture inputs and expected dry-run outcomes.
- `parity-map.md`: maps each fixture to the Hub guardrail it is intended to preserve.

## Required Coverage

The library currently covers:

1. clean new one-time delivery order
2. clean new pickup/POS order
3. incomplete delivery address
4. low-quality new order
5. duplicate Stripe event
6. duplicate order number
7. paid order attempted downgrade to pending
8. pending order upgrade to paid
9. subscription order update
10. subscription downgrade attempt
11. attempt to erase `stripe_subscription_id`
12. attempt to erase `line_items`
13. attempt to erase `fulfillments`
14. manual_override protected field update
15. production_scheduled order line item mismatch
16. in_production order address overwrite attempt
17. refunded/cancelled order exclusion behavior
18. partial refund review queue case
19. unknown order attempt
20. subscription ghost duplicate scenario
21. POS order address bypass
22. production_snapshot fulfillment mismatch
23. FIELD_OWNERSHIP rejection
24. LOCK_FROZEN_FIELDS rejection

## Fixture Shape

Each fixture includes:

- `fixture_id`
- `description`
- `starting_order`
- `incoming_payload`
- `source`
- `idempotency_key`
- optional `stripe_event_id`
- `expected`

Expected blocks intentionally assert high-signal behavior only, such as:

- action
- create/update/reject/quarantine booleans
- accepted/rejected field inclusion
- proposed state snippets
- queue incident type, with dry-run queue drafts using payload summaries instead of raw payload values
- untouched downstream entities

They do not claim complete Hub parity yet. The G21F dry-run planner is an initial native planner foundation; parity must be expanded through future fixtures and dark-launch comparison before live writes are considered.

## Local Runner

Use the non-live runner:

```bash
node scripts/migration/run-safe-sync-fixtures.mjs
```

The runner reads only this fixture file and performs pure in-memory assertions. It does not import Base44, call providers, or mutate records.
