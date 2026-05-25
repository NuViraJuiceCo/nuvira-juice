# Native safeSyncOrderUpdate Fixture Parity Map

This map links each fixture to the Hub guardrail it is intended to preserve. G21G adds `golden-output-index.md` as the fixture-by-fixture output expectation and `dark-launch-plan.md` as the future shadow comparison plan.

| Fixture | Hub guardrail / behavior |
| --- | --- |
| `clean_new_one_time_delivery_order` | Creates complete paid one-time delivery order through safe field ownership and address quality gates. |
| `clean_new_pos_order` | POS handling forces no-production/no-delivery semantics and bypasses delivery address gate. |
| `incomplete_delivery_address` | New delivery orders without complete address are rejected and quarantined. |
| `low_quality_new_order` | Minimum completeness score rejects low-quality new records. |
| `duplicate_stripe_event` | `stripe_event_id_applied` duplicate idempotency returns skipped/no mutation. |
| `duplicate_order_number` | Order number fallback prevents duplicate operational order creation. |
| `paid_order_attempted_downgrade_to_pending` | Payment status guard blocks stale paid-to-pending downgrade. |
| `pending_order_upgrade_to_paid` | Pending-to-paid upgrade is allowed even when lock status would otherwise freeze payment fields. |
| `subscription_order_update` | Subscription updates preserve subscription channel and identifiers. |
| `subscription_downgrade_attempt` | Subscription hard lock blocks source channel downgrade and queues the attempt. |
| `erase_stripe_subscription_id_attempt` | Subscription hard lock prevents erasing `stripe_subscription_id`. |
| `erase_line_items_attempt` | Subscription hard lock prevents erasing existing `line_items`. |
| `erase_fulfillments_attempt` | Subscription hard lock prevents erasing existing `fulfillments`. |
| `manual_override_protected_field_update` | Manual override guard blocks Customer App/rebuild sources from overwriting protected operational fields. |
| `production_scheduled_line_item_mismatch` | Production snapshot lock queues line item mismatch and rejects line item overwrite. |
| `in_production_address_overwrite_attempt` | `LOCK_FROZEN_FIELDS` blocks address overwrite after production starts. |
| `refunded_cancelled_order_exclusion` | Terminal refunded/canceled state is not revived by stale non-refund payloads. |
| `partial_refund_review_queue_case` | Partial refunds go to manual review instead of silent production/order cascade. |
| `unknown_order_attempt` | Unknown/incomplete overwrite attempt is rejected and quarantined. |
| `subscription_ghost_duplicate_scenario` | Subscription id matching prevents same-email ghost duplicate orders. |
| `pos_order_address_bypass` | POS address bypass remains explicit and test-covered. |
| `production_snapshot_fulfillment_mismatch` | Production snapshot lock queues fulfillment count mismatch and rejects fulfillment overwrite. |
| `field_ownership_rejection` | FIELD_OWNERSHIP filters unauthorized source fields. |
| `lock_frozen_fields_rejection` | LOCK_FROZEN_FIELDS rejects frozen fields under lifecycle locks. |

## Current Parity Status

These fixtures define expected native behavior based on Hub rules audited in G21B and re-read in G21G. They are now checked as a native dry-run golden-output suite, but they are not yet produced by executing Hub in a dry-run mode because the Hub endpoint directly writes `ShopifyOrder`, `OrderSyncLog`, and `OrderReviewQueue` records.

Future parity phases should:

1. add approved dark-launch instrumentation that compares Hub live writer results to native dry-run plans
2. run native dry-run planner against the same fixture input
3. compare accepted fields, rejected fields, proposed state, log drafts, queue drafts, and response codes
4. add any discovered mismatch as a new fixture before enabling live native writes
