# safeSyncOrderUpdate Golden Output Index

Phase G21G adds a golden-output layer for the native Customer App dry-run planner. These golden outputs are non-live expectations derived from the Hub `safeSyncOrderUpdate` implementation and the G21B/G21C migration contracts.

The Hub endpoint does not expose a safe dry-run mode. It performs live `ShopifyOrder` writes plus `OrderSyncLog` and `OrderReviewQueue` writes when invoked, so G21G does not call it. Source notes below distinguish behavior confirmed directly from Hub code from behavior that still needs future dark-launch comparison.

## Source Labels

- `Hub code confirmed`: directly visible in the Hub `base44/functions/safeSyncOrderUpdate/entry.ts` control flow.
- `Contract inferred`: required by G21B/G21C contract and represented in current fixture expectations, but still needs live bridge shadow comparison before cutover.
- `Dark launch required`: fixture is intentionally covered now, but final equivalence must be proven by comparing native dry-run output against the current Hub writer result in shadow mode.

## Fixture Golden Outputs

| Fixture | Accepted Fields | Rejected Fields | Proposed State / Response | OrderSyncLog Draft | OrderReviewQueue Draft | Source |
| --- | --- | --- | --- | --- | --- | --- |
| `clean_new_one_time_delivery_order` | customer, line item, payment, address, Stripe event fields | none | would create one-time delivery order | `created`, success | none | Hub code confirmed |
| `clean_new_pos_order` | POS source, fulfilled status, not-required production status | none | would create POS order with delivery gate bypass | `created`, success | none | Hub code confirmed |
| `incomplete_delivery_address` | none committed | n/a, creation rejected | `delivery_order_missing_address`, no create | `rejected`, failure | `missing_customer_info` | Hub code confirmed |
| `low_quality_new_order` | none committed | n/a, creation rejected | `low_quality_new_order`, no create | `rejected`, failure | `low_quality_new_order` | Hub code confirmed |
| `duplicate_stripe_event` | none | none | duplicate event skipped, existing order preserved | `skipped`, success | none | Hub code confirmed |
| `duplicate_order_number` | safe update fields only | none | order-number match prevents duplicate create | `updated`, success | none | Hub code confirmed |
| `paid_order_attempted_downgrade_to_pending` | non-payment safe fields | `payment_status` | paid state preserved | `updated`, success with rejected field | none | Hub code confirmed |
| `pending_order_upgrade_to_paid` | `payment_status` and event fields | none | pending-to-paid upgrade allowed | `updated`, success | none | Hub code confirmed |
| `subscription_order_update` | subscription-safe update fields | none | subscription identity preserved | `updated`, success | none | Hub code confirmed |
| `subscription_downgrade_attempt` | non-conflicting fields | `source_channel` | source channel forced back to `subscription` | `updated`, success with rejected field | `subscription_downgrade_attempt` | Hub code confirmed |
| `erase_stripe_subscription_id_attempt` | preserved subscription fields | `stripe_subscription_id` | existing subscription id retained | `updated`, success with rejected field | none | Hub code confirmed |
| `erase_line_items_attempt` | preserved line item fields | `line_items` | existing line items retained | `updated`, success with rejected field | none | Hub code confirmed |
| `erase_fulfillments_attempt` | preserved fulfillment fields | `fulfillments` | existing fulfillments retained | `updated`, success with rejected field | none | Hub code confirmed |
| `manual_override_protected_field_update` | unprotected safe fields | protected operational fields | manual override protected state retained | `updated`, success with rejected fields | none | Hub code confirmed |
| `production_scheduled_line_item_mismatch` | non-line-item safe fields | `line_items` | production snapshot mismatch blocks line item overwrite | `updated`, success with rejected field | `overwrite_rejection` | Hub code confirmed |
| `in_production_address_overwrite_attempt` | non-address safe fields | address fields | frozen address retained after production starts | `updated`, success with rejected fields | none | Hub code confirmed |
| `refunded_cancelled_order_exclusion` | safe non-terminal fields | stale terminal-state revival fields | refunded/canceled state retained | `updated`, success with rejected fields | none | Contract inferred |
| `partial_refund_review_queue_case` | none committed | refund cascade withheld | `partial_refund_requires_review`, no update | `rejected`, failure | `partial_refund_received` | Contract inferred |
| `unknown_order_attempt` | none committed | n/a, creation rejected | `unknown_quality_new_order`, no create | `rejected`, failure | `unknown_order_attempt` | Hub code confirmed |
| `subscription_ghost_duplicate_scenario` | safe update fields | none | subscription id match updates existing order, no ghost create | `updated`, success | none | Dark launch required |
| `pos_order_address_bypass` | POS source/status fields | none | POS order stays address-independent | `created`, success | none | Hub code confirmed |
| `production_snapshot_fulfillment_mismatch` | non-fulfillment safe fields | `fulfillments` | snapshot mismatch blocks fulfillment overwrite | `updated`, success with rejected field | `overwrite_rejection` | Hub code confirmed |
| `field_ownership_rejection` | source-owned fields | unauthorized fields | FIELD_OWNERSHIP filters blocked fields | `updated`, success with rejected fields | none | Hub code confirmed |
| `lock_frozen_fields_rejection` | unfrozen safe fields | frozen lifecycle fields | LOCK_FROZEN_FIELDS filters blocked fields | `updated`, success with rejected fields | none | Hub code confirmed |

## Known Parity Gaps

- The Hub endpoint has no non-mutating dry-run invocation, so these expectations are not produced by executing Hub against fixtures.
- The native planner currently drafts safe `OrderSyncLog` and `OrderReviewQueue` equivalents; it does not create records.
- Partial refund behavior and terminal refunded/canceled exclusion span adjacent refund/reconciliation flows, so they are contract-derived until shadowed against the live bridge.
- Subscription ghost duplicate behavior depends on Hub lookup ordering and match keys; fixture coverage exists, but dark launch should compare actual bridge matching before native writes.

## Cutover Rule

Passing this fixture set is necessary but not sufficient for native `safeSyncOrderUpdate` writes. Native writes remain blocked until dark launch compares Customer App dry-run output against the current Hub writer result for real bridge inputs and records zero blocker mismatches across an approved sample window.
