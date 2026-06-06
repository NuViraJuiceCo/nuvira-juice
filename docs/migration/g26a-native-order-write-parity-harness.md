# G26A: Native Order Write Gateway Parity Harness

Status: implementation PR
Scope: dry-run native order write parity harness only. No live order writer is enabled.

## Goal

G26A starts the meaningful Hub retirement path by adding a native safeSync parity harness in the Customer App backend.

The Hub cannot retire until Customer App can safely own canonical operational order writes. G24A/G24C proved native mirror visibility for a paid one-time order, but Hub `safeSyncOrderUpdate` still owns the broader write semantics for duplicate events, stale payloads, refunds, subscription protection, POS normalization, and production locks.

## Added Function

`base44/functions/previewNativeSafeSyncParityHarness/entry.ts`

The function:

- requires admin session or internal preview secret
- accepts only `mode: "dry_run"`
- runs bounded synthetic or caller-supplied fixtures
- invokes existing `previewNativeSafeSyncOrderUpdate`
- compares native planner output to expected Hub/safeSync contract behavior
- reports fixture-level mismatch severity: `blocker`, `high`, `medium`, or `low`
- returns only safe summaries: actions, field names, status flags, proposed status/source summaries, and mismatch metadata

The function does not:

- create or update entities
- invoke `executeNativeSafeSyncOrderUpdate`
- invoke `processMay30NativeOrderOps`
- invoke `syncOrderToHub`
- call Hub APIs
- call Stripe, Shopify, providers, or notification services
- run sync, retry, repair, replay, refund, production, inventory, route, proof, drop, or delivery commands
- enable the broad native safeSync writer

## Default G26A Fixtures

The default synthetic fixture set covers:

| Fixture | Expected contract |
| --- | --- |
| `g26a_customer_app_paid_one_time_create` | Paid Customer App delivery order plans a native create. |
| `g26a_duplicate_stripe_event_skip` | Duplicate event plans a skipped no-op. |
| `g26a_partial_refund_requires_review` | Partial refund is rejected/quarantined for review, not silently cascaded. |
| `g26a_subscription_downgrade_guard` | Subscription order cannot be downgraded to online/one-time by stale payload. |
| `g26a_shopify_pos_create_not_required` | POS order normalizes as paid/fulfilled/not_required. |
| `g26a_production_lock_rejects_customer_app_fields` | Production-scheduled order rejects stale Customer App edits to frozen fields. |

These fixtures use synthetic IDs and synthetic customer/order context only.

## Example Request

```json
{
  "mode": "dry_run"
}
```

Optional scoped run:

```json
{
  "mode": "dry_run",
  "fixture_ids": ["g26a_partial_refund_requires_review"]
}
```

Optional custom fixture:

```json
{
  "mode": "dry_run",
  "fixtures": [
    {
      "fixture_id": "custom_paid_order_create",
      "source": "customer_app",
      "event_type": "order.created",
      "idempotency_key": "custom:paid:create",
      "incoming_payload": {
        "shopify_order_number": "CUSTOM-SYNTH-001",
        "customer_name": "Synthetic Customer",
        "source_channel": "online",
        "fulfillment_method": "delivery",
        "payment_status": "paid",
        "line_items": [{ "title": "Re-Nu", "quantity": 1, "price": 12 }],
        "total_price": 12,
        "address_line1": "Synthetic Address Line 1",
        "address_city": "Synthetic City",
        "address_state": "TX",
        "address_postal_code": "00000"
      },
      "expected": {
        "action": "created",
        "would_create_order": true,
        "accepted_fields_include": ["payment_status", "line_items", "address_line1"]
      }
    }
  ]
}
```

## Response Contract

The aggregate response includes:

- `success`
- `parity_status`
- `fixtures_run`
- `fixtures_matched`
- `fixtures_failed`
- `severity_counts`
- `failed_fixture_ids`
- `blocker_fixture_ids`
- `native_writer_enabled: false`
- `hub_remains_live_writer: true`
- `writes_performed: false`

Each fixture result includes:

- `fixture_id`
- `matched`
- `mismatch_category`
- `mismatch_count`
- `mismatches`
- `native_summary`

`native_summary` intentionally contains field names and status/source summaries, not full raw payloads.

## What This Enables Next

G26A gives us a repeatable harness for safe native write parity work. The next steps should be:

1. Expand fixture coverage from synthetic cases to read-only live-derived sanitized fixtures.
2. Add Hub-exported expected results from approved non-mutating audits.
3. Keep broad native writer disabled while mismatch classes are resolved.
4. Only after parity passes, approve an owner/test one-order native writer pilot.

## Hold Lines

Do not retire Hub bridge yet.

Do not enable broad native safeSync writer access from this PR.

Do not use this harness as a repair tool; it previews parity only.
