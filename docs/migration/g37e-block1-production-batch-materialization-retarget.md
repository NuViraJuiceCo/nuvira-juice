# G37E-BLOCK1: ProductionBatch materialization retarget for NV-MQHJR3V2

## 1. Purpose

G37E-BLOCK1 retargets the exact gated `materializeNativeProductionBatchesForCustomerApp` command from the previous exact pilot order to the approved controlled order `NV-MQHJR3V2`.

This is runtime PR prep only. It does not open gates, run live materialization, create `ProductionBatch`, create `CommandLog`, publish Base44, or mutate records.

## 2. Root cause

G37E live execution was stopped before gates opened because source audit showed `materializeNativeProductionBatchesForCustomerApp` was still hardcoded for the previous exact pilot:

| Field | Previous hardcoded value |
| --- | --- |
| Order number | `NV-MPZNKGNT` |
| Customer App Order | `6a219a3f4adcda5856c3d579` |
| Native ShopifyOrder | `6a22ffda400eb806eb3ca945` |
| Native FulfillmentTask | `6a22ffdaf675ea79e30575aa` |
| Production date | `2026-06-05` |
| Delivery date | `2026-06-06` |
| Products | Aura, Oasis, Pineapple Juice, Radiance Shot, Re-Nu, Reset Shot |

That command would fail exact-target validation for `NV-MQHJR3V2`, so no gates were opened and no live command was run.

## 3. New exact target

The command is retargeted to only this approved G37E target:

| Field | G37E exact target |
| --- | --- |
| Order number | `NV-MQHJR3V2` |
| Customer App Order | `6a321cbfd8d78863f15de956` |
| Native ShopifyOrder | `6a321d38a3819cdd5cf89031` |
| Native FulfillmentTask | `6a321d38071327f8218b958b` |
| Production date | `2026-06-19` |
| Delivery date | `2026-06-20` |

Approved `ProductionBatch` rows are exactly:

| Product | Planned units | Production date |
| --- | ---: | --- |
| Hydration Shot | 3 | `2026-06-19` |
| Radiance Shot | 3 | `2026-06-19` |

No arbitrary order ids, product names, units, dates, or broad allowlists are introduced.

## 4. Gate, policy, and confirmation contract

The implemented gate family remains unchanged:

| Gate | Value / behavior |
| --- | --- |
| Enable gate | `ENABLE_NATIVE_PRODUCTION_BATCH_MATERIALIZATION` |
| Kill switch | `NATIVE_PRODUCTION_BATCH_MATERIALIZATION_KILL_SWITCH` |
| Actor allowlist | `NATIVE_PRODUCTION_BATCH_MATERIALIZATION_ALLOWED_EMAILS` |
| Order allowlist | `NATIVE_PRODUCTION_BATCH_MATERIALIZATION_ORDER_ALLOWLIST` |
| Policy | `NATIVE_PRODUCTION_BATCH_MATERIALIZATION_POLICY=EXACT_PREVIEW_PACKET_ONLY` |
| Confirmation | `materialize_native_production_batches_for_customer_app` |

The command also accepts explicit safe policy fields for the future approved live body, and blocks any non-held/non-no-op value:

- `inventory_deduction_policy=HELD`
- `purchase_order_policy=HELD`
- `notification_policy=NO_NOTIFICATION`
- `provider_call_policy=NO_PROVIDER_CALLS`
- `hub_mutation_policy=NO_HUB_MUTATION`

## 5. Fresh preview dependency

Before any future write, the command still invokes `previewNativeProductionDemandMaterialization` using service-role function invocation. The fresh preview must prove:

- `success:true`
- `dry_run:true`
- `writes_performed:false`
- exact order/native ids match `NV-MQHJR3V2`
- `payment_status:paid`
- `payment_captured:true`
- `production_ready:true`
- `materialization_ready:true`
- `production_date:2026-06-19`
- `delivery_date:2026-06-20`
- proposed rows exactly Hydration Shot 3 and Radiance Shot 3
- `existing_native_batch_matches:0`
- `inventory_deduction_ready:false`
- `purchase_order_ready:false`
- provider calls false
- notifications false/held
- Hub mutation false

If the preview changes, proposed rows differ, existing batches are found, blockers appear, or side effects would be needed, the command fails closed with `writes_performed:false`.

## 6. Allowed writes

Only these future writes are allowed after separate live approval and gates are opened exactly:

1. Exact `ProductionBatch` rows:
   - Hydration Shot, planned units 3, production date `2026-06-19`
   - Radiance Shot, planned units 3, production date `2026-06-19`
2. One safe `CommandLog`.

The command creates planned/pre-start batches only. It does not start, complete, verify, pack, bottle, deliver, or update customer-facing state.

## 7. Forbidden writes and side effects

Still forbidden:

- `BatchComplianceLog` creation
- Customer App `Order` update
- native `ShopifyOrder` update
- native `FulfillmentTask` update
- `Recipe`, `InventoryItem`, `IngredientYield`, `Bundle`, or `Product` mutation
- inventory deduction
- `PurchaseOrder` creation
- `Notification` or `CustomerMessageDeliveryLog` creation
- `OrderSyncLog` or `OrderReviewQueue` creation
- Stripe, Shopify, provider, or Hub calls/mutations
- sync/retry/repair/replay
- any other order or production lifecycle phase

## 8. Idempotency and duplicate behavior

- `request_id` is required.
- Existing successful/skipped `CommandLog` with the same idempotency key returns idempotent skip and creates no duplicate rows.
- The deterministic batch ids are based on exact order, production date, and product name.
- If both exact rows already exist, the command can skip safely and log a skipped command.
- If only a partial exact batch state exists, the command fails closed rather than creating a partial remainder.
- Locked/in-progress/completed/conflicting same-product/date batches block materialization.

## 9. Response safety

The response remains safe metadata only, including counts, ids, product names, booleans, blockers, and warnings. It does not return customer email, phone, full address, raw provider/payment payloads, raw order payloads, secrets, auth headers, or stack traces.

Additive safe fields include:

- `production_batch_created`
- `production_batch_records_created`
- `created_production_batch_ids`
- `created_product_names`
- `batch_compliance_log_created:false`
- `notifications_created:false`
- `command_log_created`
- `sync_repair_replay_performed:false`

## 10. Test coverage

`run-g37e-block1-production-batch-materialization-retarget-tests.mjs` covers:

- disabled gates, auth, confirmation, policy, and allowlist behavior
- wrong order/native ids and wrong dates blocked
- missing, extra, wrong, or wrong-unit approved rows blocked
- fresh preview missing/not ready/blocker/side-effect cases blocked
- inventory deduction, PO, notification, provider, and Hub mutation requests blocked
- valid in-memory command creates exactly two `ProductionBatch` rows and one `CommandLog`
- duplicate same request id skips
- partial existing state blocks
- all-existing exact rows skip safely
- no compliance, order/task, inventory, PO, provider, notification, Hub, or raw payload/PII exposure

The existing G31L regression entrypoint delegates to this current exact command contract because the command is intentionally retargeted.

## 11. Live execution requirement

G37E-BLOCK1 does not run the live materialization. After audit/merge/publish, a separate live G37E approval must:

1. Publish only `materializeNativeProductionBatchesForCustomerApp`.
2. Boundary-verify gates closed.
3. Rerun fresh demand materialization preview.
4. Open only exact gates.
5. Run the command once with a new request id.
6. Run duplicate idempotency once.
7. Shut gates immediately.
8. Verify no side effects outside exact `ProductionBatch` + `CommandLog` writes.

## 12. Recommendation

Close/merge/publish G37E-BLOCK1 if checks pass. Then request separate exact G37E live materialization approval only after boundary and fresh preview are clean.
