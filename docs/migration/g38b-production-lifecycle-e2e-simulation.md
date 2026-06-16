# G38B production lifecycle e2e simulation

## 1. Purpose

G38B adds a fixture-only, local/in-memory production lifecycle simulation for the native one-time production command sequence.

This phase does **not** prove a live natural order. It proves that, given a clean active one-time fixture and explicit owner/operator production and QC inputs, the command contracts can compose safely end-to-end without provider, notification, inventory, PurchaseOrder, sync, repair, replay, or Hub side effects.

No Base44 live functions are called. No live records are read or written.

## 2. Fixture design

Fixture file:

```text
docs/migration/fixtures/production-lifecycle-e2e/g38b-fixtures.json
```

Synthetic order context:

| Field | Value |
| --- | --- |
| order_number | `SYN-G38B-ACTIVE-ONE-TIME` |
| customer_app_order_id | `synthetic_order_g38b_001` |
| native_shopify_order_id | `synthetic_shopify_order_g38b_001` |
| native_fulfillment_task_id | `synthetic_task_g38b_001` |
| order_type | `one_time` |
| fulfillment_type | `delivery` |
| payment_status | `paid` |
| payment_captured | `true` |
| customer status | `scheduled_for_juicing` |
| native ShopifyOrder production_status | `awaiting_production` |
| native FulfillmentTask status | `pending` |
| native FulfillmentTask production_status | `awaiting_production` |
| native FulfillmentTask delivery_status | `pending` |
| production_date | `2026-07-01` |
| delivery_date | `2026-07-02` |

Line items:

- `Pineapple Juice` — quantity 1
- `RE-NU` — quantity 1
- `Watermelon Juice` — quantity 1

The fixture contains no real customer name, email, phone, address, Stripe id, Shopify id, Hub id, provider payload, payment payload, raw payload, or secret.

## 3. Owner/operator actuals and QC fixture

Actual units are explicit fixture data, not inferred from planned units:

| Product | Actual units |
| --- | ---: |
| Pineapple Juice | 1 |
| RE-NU | 1 |
| Watermelon Juice | 1 |

Completion metadata:

- `actual_start_time`: synthetic ISO timestamp
- `actual_end_time`: synthetic ISO timestamp
- `started_by`: `synthetic_admin_actor`
- `completed_by`: `synthetic_admin_actor`

Verification/QC fixture:

| Product | pH result | pH passed | batch passed |
| --- | ---: | --- | --- |
| Pineapple Juice | 3.9 | true | true |
| RE-NU | 4.0 | true | true |
| Watermelon Juice | 4.1 | true | true |

## 4. Harness

Harness file:

```text
scripts/migration/run-g38b-production-lifecycle-e2e-simulation.mjs
```

The harness is self-contained and local/in-memory only. It intentionally uses a fixture-level state machine rather than live Base44 calls.

It simulates the same contract boundaries as the production lifecycle command sequence:

1. demand preview
2. ProductionBatch materialization command
3. start production command
4. complete production command with exact actual units
5. verify/QC command with exact pH/pass-fail data
6. post-verify cascade preview
7. delivery/customer status held
8. inventory deduction and PurchaseOrder automation held

## 5. Positive path results

Command run:

```text
node scripts/migration/run-g38b-production-lifecycle-e2e-simulation.mjs
```

Result summary:

| Metric | Result |
| --- | ---: |
| total test cases | 11 |
| passed | 11 |
| failed | 0 |
| final ProductionBatch count | 3 |
| final ProductionBatch status | `verified_logged` |
| final BatchComplianceLog count | 3 |
| command log count in fixture store | 4 |
| live API calls | false |
| live Base44 calls | false |

Lifecycle transitions proven:

1. `materialized:3`
2. `started:planned->in_production`
3. `completed:in_production->completed_pending_verification`
4. `verified:completed_pending_verification->verified_logged`

## 6. Positive contract assertions

Demand preview:

- `success:true`
- `dry_run:true`
- `writes_performed:false`
- `production_ready:true`
- `materialization_ready:true`
- `proposed_batch_count:3`
- no provider calls
- no notifications

Batch materialization:

- creates exactly 3 fake `ProductionBatch` records
- status starts as `planned`
- creates one fake `CommandLog`
- duplicate request id skips
- no inventory deduction
- no PurchaseOrder
- no Customer App Order update
- no native ShopifyOrder update
- no native FulfillmentTask update

Start production:

- moves exactly 3 fake batches from `planned` to `in_production`
- sets `actual_start_time`
- sets `started_by`
- duplicate request id skips
- no other entity mutations

Complete production:

- requires exact `actual_units`
- moves exactly 3 fake batches from `in_production` to `completed_pending_verification`
- sets `actual_units`
- sets `actual_end_time`
- sets `completed_by`
- creates no compliance logs yet
- duplicate request id skips
- no inventory deduction
- no PurchaseOrder

Verify production:

- requires exact pH result, pH pass/fail, and batch pass/fail data
- moves exactly 3 fake batches from `completed_pending_verification` to `verified_logged`
- creates exactly 3 fake `BatchComplianceLog` records
- locks compliance logs
- duplicate request id skips
- no inventory deduction
- no PurchaseOrder
- no order/task cascade write

Post-verify cascade preview:

- `verified_batch_count:3`
- `compliance_log_count:3`
- task pack ready in preview
- ShopifyOrder bottle ready in preview
- customer status held
- delivery status held
- notifications held
- `writes_performed:false`

## 7. Negative cases

The harness proves these fail-closed cases:

1. Missing actual units blocks complete command.
2. Missing pH result blocks verify command.
3. Missing pH pass/fail blocks verify command.
4. Missing batch pass/fail blocks verify command.
5. Attempting verify before complete blocks.
6. Attempting complete before start blocks.
7. Duplicate materialization does not create duplicate batches.
8. Duplicate verify does not create duplicate compliance logs.
9. Inventory deduction request is rejected/held.
10. Notification request is rejected/held.

## 8. Idempotency results

The fixture store records one fake success `CommandLog` per positive write command:

- materialization
- start
- complete
- verify

Duplicate request ids return skipped/idempotent success and do not create duplicates for:

- ProductionBatch rows
- BatchComplianceLog rows
- CommandLog rows

## 9. Safety results

Safety flags remain false throughout the simulation:

| Flag | Result |
| --- | --- |
| provider_calls | false |
| stripe_calls | false |
| shopify_calls | false |
| notifications_sent | false |
| hub_records_updated | false |
| inventory_deduction | false |
| purchase_orders_created | false |

Held by design:

- Customer App Order mutation
- native ShopifyOrder mutation before bottle phase
- native FulfillmentTask mutation before pack phase
- delivery/customer status mutation
- notifications
- provider calls
- Hub mutation
- sync/repair/replay
- inventory deduction
- PurchaseOrder automation

## 10. What this proves

G38B proves in local fixture space that:

- production lifecycle contracts compose end-to-end
- actual units are required for complete
- pH/pass-fail/batch-pass data are required for verify
- lifecycle ordering is enforced
- materialization and verify idempotency avoid duplicates
- post-verify cascade can be previewed with pack/bottle/customer status held
- provider, notification, inventory, PO, Hub, sync, repair, and replay side effects remain held

## 11. What this does not prove

G38B does not prove:

- live natural order production lifecycle
- live Base44 read consistency
- live function boundaries
- live command execution
- real inventory deduction behavior
- real PurchaseOrder behavior
- notification behavior
- provider/Stripe/Shopify behavior
- Hub retirement readiness

Those require later phases and exact approvals.

## 12. Next phase recommendation

Recommended next phase: **G38C live gates-closed boundary verification**.

Rationale:

- G38B proves fixture composition.
- G38C should prove deployed command surfaces remain safe with gates closed.
- G37C remains held until a real active paid/captured one-time order exists.

Alternative safe next phase: continue fixture coverage for operator input packets, especially actual units and pH/QC capture templates.
