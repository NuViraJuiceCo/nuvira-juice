# G38D Production Actuals and QC Input Packet

## 1. Executive summary

G38D defines owner/operator input packet templates for future native production lifecycle commands.

G38A/G38B/G38C established that the next production lifecycle bottleneck is not command availability. The bottleneck is exact owner/operator data for the `complete` and `verify/QC` phases:

- actual units must be supplied explicitly
- QC data must be supplied explicitly
- timestamps must be supplied explicitly
- no data may be inferred from planned units
- no fake timestamps may be used
- inventory deduction remains held
- PurchaseOrder automation remains held
- notifications remain held
- Hub remains active

This document is docs-only. It does not approve any live command.

## 2. Why this packet exists

The next real active paid/captured one-time order should move through production lifecycle only with exact approvals and exact command inputs.

The current migration position is:

- production command boundaries are ready with notes
- no real active paid/captured one-time candidate currently exists
- G37C remains held until such an order appears
- historical/late-mirror orders must not be used to prove normal production lifecycle repeatability
- complete production requires exact actual units
- verify production requires exact pH/QC/pass-fail data

G38D prevents ambiguity by giving operators copy/paste input packets that separate four distinct phases:

1. materialization from fresh preview packet
2. start production
3. complete production with actual units
4. verify/QC with compliance data

It also includes a separate historical/admin-only backfill preview template because historical backfill is not the same as live production lifecycle.

## 3. Materialization approval template

Materialization should use only a fresh exact demand-materialization preview packet.

Do not infer batch rows outside the preview. Do not create inventory deductions, PurchaseOrders, notifications, or customer-facing status updates.

```text
APPROVE EXACT NATIVE PRODUCTIONBATCH MATERIALIZATION

order_number=
customer_app_order_id=
native_shopify_order_id=
native_fulfillment_task_id=
production_date=
preview_request_id=
request_id=

policy=EXACT_PREVIEW_PACKET_ONLY
notification_policy=NO_NOTIFICATION
inventory_deduction_policy=HELD
purchase_order_policy=HELD
provider_call_policy=NO_PROVIDER_CALLS
hub_mutation_policy=NO_HUB_MUTATION
```

Required preview evidence before materialization:

- fresh demand materialization preview exists
- `dry_run:true`
- `writes_performed:false`
- `materialization_ready:true`
- `proposed_batch_count` matches expected product batch rows
- proposed products exactly match order line-item production demand
- no duplicate ProductionBatch rows exist for the target order/date/product set
- blockers are empty
- provider calls are false
- notifications are held
- inventory deduction is held
- PurchaseOrder automation is held
- Hub mutation is false

Hard stops:

- preview is missing or stale
- preview was not exact-order scoped
- `materialization_ready:false`
- blockers present
- duplicate batches exist
- product set mismatch
- requested product rows are not from preview packet
- inventory deduction requested
- PurchaseOrder creation requested
- notification requested
- provider/Stripe/Shopify call requested
- Hub mutation requested
- sync/repair/replay requested

## 4. Start production approval template

Start production requires less owner data than complete/verify, but it still needs exact selected batches and an operator/time policy.

```text
APPROVE EXACT NATIVE START PRODUCTION

order_number=
customer_app_order_id=
native_shopify_order_id=
native_fulfillment_task_id=
production_date=
request_id=

selected_batch_ids=
-
-
-

started_by=
actual_start_time=

notification_policy=NO_NOTIFICATION
inventory_deduction_policy=HELD
purchase_order_policy=HELD
provider_call_policy=NO_PROVIDER_CALLS
hub_mutation_policy=NO_HUB_MUTATION
```

Required preview evidence before start:

- fresh lifecycle preview exists
- `dry_run:true`
- `writes_performed:false`
- selected batches exist
- selected batches belong to the exact order/date
- selected batches are in `planned` status
- selected batch ids match the approved batch set
- no already-started duplicate operation is needed
- blockers are empty

Hard stops:

- selected batch ids missing
- selected batch id not in approved batch set
- selected batch belongs to another order/date
- selected batch is not `planned`
- actual start time missing when command contract requires it
- started_by missing when command contract requires it
- notification requested
- inventory deduction requested
- PurchaseOrder creation requested
- provider/Stripe/Shopify call requested
- Hub mutation requested
- sync/repair/replay requested

## 5. Complete production actual-units approval template

Complete production is the first owner-input-critical command.

Actual units must be supplied by the owner/operator. Do not infer actual units from planned units. If actual units equal planned units, still enter the exact actual units explicitly.

For each product/batch, capture:

- product name
- production batch id if known
- planned units from preview/batch row
- actual units produced
- actual end time
- completed_by policy
- optional completion notes
- variance reason when actual units differ from planned units

```text
APPROVE EXACT NATIVE COMPLETE PRODUCTION

order_number=
customer_app_order_id=
native_shopify_order_id=
native_fulfillment_task_id=
production_date=
request_id=

actual_units:
- product_name=
  production_batch_id=
  planned_units=
  actual_units=
  variance_reason=
- product_name=
  production_batch_id=
  planned_units=
  actual_units=
  variance_reason=
- product_name=
  production_batch_id=
  planned_units=
  actual_units=
  variance_reason=

completion:
actual_end_time=
completed_by=
completion_notes=

inventory_deduction_policy=HELD
purchase_order_policy=HELD
notification_policy=NO_NOTIFICATION
provider_call_policy=NO_PROVIDER_CALLS
hub_mutation_policy=NO_HUB_MUTATION
```

Required preview evidence before complete:

- fresh lifecycle preview exists
- `dry_run:true`
- `writes_performed:false`
- selected batches are in `in_production` status
- complete-ready batch count matches selected batch count
- each selected batch has exactly one actual_units value
- no extra product/batch exists in the packet
- no selected product/batch is missing from the packet
- blockers are empty

Hard stops:

- actual_units missing for any selected batch
- actual_units is not numeric
- actual_units is negative
- product missing from approved batch set
- extra product supplied
- unknown production_batch_id supplied
- actual_end_time missing
- actual_end_time is not a valid ISO timestamp when command requires ISO
- completed_by missing when command requires it
- variance_reason missing when actual_units differs from planned_units and owner policy requires variance reason
- inventory deduction requested
- PurchaseOrder creation requested
- notification requested
- provider/Stripe/Shopify call requested
- Hub mutation requested
- sync/repair/replay requested
- raw payload supplied
- customer PII supplied

## 6. Verify/QC approval template

Verify/QC is the second owner-input-critical command.

QC data must be supplied by the owner/operator. Do not infer pH results, pass/fail values, or compliance outcomes.

For each product/batch, capture:

- product name
- production batch id if known
- pH result
- pH passed true/false
- batch passed true/false
- verified_at
- verified_by
- optional QC notes
- hold/rework/discard decision if failed

```text
APPROVE EXACT NATIVE VERIFY PRODUCTION

order_number=
customer_app_order_id=
native_shopify_order_id=
native_fulfillment_task_id=
production_date=
request_id=

verification_data:
- product_name=
  production_batch_id=
  pH_result=
  pH_passed=
  batch_passed=
  qc_notes=
  failed_batch_decision=
- product_name=
  production_batch_id=
  pH_result=
  pH_passed=
  batch_passed=
  qc_notes=
  failed_batch_decision=
- product_name=
  production_batch_id=
  pH_result=
  pH_passed=
  batch_passed=
  qc_notes=
  failed_batch_decision=

verification:
verified_at=
verified_by=
compliance_log_policy=CREATE_LOCKED_SAFE_LOGS
inventory_deduction_policy=HELD
purchase_order_policy=HELD
notification_policy=NO_NOTIFICATION
provider_call_policy=NO_PROVIDER_CALLS
hub_mutation_policy=NO_HUB_MUTATION
```

Required preview evidence before verify:

- fresh lifecycle preview exists
- `dry_run:true`
- `writes_performed:false`
- selected batches are in `completed_pending_verification` status
- verify-ready batch count matches selected batch count
- each selected batch has pH_result
- each selected batch has pH_passed true/false
- each selected batch has batch_passed true/false
- compliance logs do not already exist for the same verification request
- blockers are empty

Hard stops:

- pH_result missing
- pH_result is not numeric
- pH_passed missing
- pH_passed is not true/false
- batch_passed missing
- batch_passed is not true/false
- verified_by missing
- verified_at missing when command contract requires it
- verified_at is not a valid ISO timestamp when command requires ISO
- unknown production_batch_id supplied
- unknown product supplied
- extra product supplied
- missing product supplied
- raw payload supplied
- customer PII supplied
- provider/payment data supplied
- notification requested
- inventory deduction requested
- PurchaseOrder creation requested
- provider/Stripe/Shopify call requested
- Hub mutation requested
- sync/repair/replay requested

## 7. Historical/admin-only backfill preview template

Historical/admin-only production backfill is distinct from a live production lifecycle pilot.

A historical backfill may be considered only when the owner wants admin historical completeness and supplies exact actuals/QC data. It should not mutate customer-facing status, delivery status, inventory, PO, provider systems, or notifications unless separately approved.

This template authorizes a read-only preview only. Do not run a live historical backfill command from this packet.

```text
APPROVE HISTORICAL ADMIN-ONLY PRODUCTION BACKFILL PREVIEW

order_number=
production_date=
historical_context=
request_id=

inventory_deduction_policy=HELD
purchase_order_policy=HELD
notification_policy=NO_NOTIFICATION
customer_status_policy=HELD
provider_call_policy=NO_PROVIDER_CALLS
hub_mutation_policy=NO_HUB_MUTATION

products:
- product_name=
  planned_units=
  actual_units=
  actual_start_time=
  actual_end_time=
  completed_by=
  verified_at=
  verified_by=
  pH_result=
  pH_passed=
  batch_passed=
  create_batch_compliance_log=
  notes=
- product_name=
  planned_units=
  actual_units=
  actual_start_time=
  actual_end_time=
  completed_by=
  verified_at=
  verified_by=
  pH_result=
  pH_passed=
  batch_passed=
  create_batch_compliance_log=
  notes=
```

Required explicit historical statements:

```text
inventory_deduction=false
purchase_order_creation=false
notifications=false
customer_status_update=false
provider_calls=false
hub_mutation=false
```

Hard stop:

Do not run a live historical backfill command from this template. First run a read-only historical backfill packet preview, then require a separate exact live approval if the owner decides historical completeness is worth the admin-only write.

## 8. Data validation rules

All future packet validators and command preflights should enforce these rules.

### Numeric values

- actual_units must be a nonnegative number
- planned_units must be numeric when supplied
- pH_result must be numeric
- no numeric value may be supplied as an ambiguous text phrase

### Boolean values

- pH_passed must be true/false
- batch_passed must be true/false
- create_batch_compliance_log must be true/false in historical previews
- inventory_deduction, purchase_order_creation, notifications, provider_calls, and hub_mutation must remain false unless separately approved in a different phase

### Timestamps

- actual_start_time must be an ISO timestamp when required
- actual_end_time must be an ISO timestamp when required
- verified_at must be an ISO timestamp when required
- fake timestamps are prohibited
- backdated timestamps require explicit historical timestamp policy

### Product and batch identity

- product names must match preview/batch rows exactly
- production_batch_id values must match selected batch rows exactly when known
- no extra products are allowed
- no missing products are allowed
- no unknown batch ids are allowed
- no inferred data from planned units is allowed

### Safety and privacy

- no raw payloads
- no customer PII
- no customer email, phone, or full address
- no provider/payment data
- no Stripe IDs
- no Shopify provider IDs
- no auth headers or secrets
- no notification payloads
- no proof/drop/route payloads unless a separate delivery/proof workflow is approved

### Held policies

Unless a separate exact phase explicitly changes the policy:

- inventory_deduction_policy=`HELD`
- purchase_order_policy=`HELD`
- notification_policy=`NO_NOTIFICATION`
- provider_call_policy=`NO_PROVIDER_CALLS`
- hub_mutation_policy=`NO_HUB_MUTATION`

## 9. Operator workflow for the next real order

Use this workflow only for a real active paid/captured one-time Customer App order.

1. Run G37C exact eligibility preview.
2. Confirm the order is not delivered, bottled, packed, cancelled, refunded, subscription, multi-delivery, or payment-not-ready.
3. Confirm or create exact native ShopifyOrder and native FulfillmentTask only through separately approved exact mirror phases if missing.
4. Run master-data parity preview.
5. Run production/inventory readiness preview.
6. Run procurement visibility preview.
7. Run demand materialization preview.
8. If clean, request exact materialization approval using the materialization template.
9. Confirm batches were created before any start phase.
10. Request exact start approval using the start template.
11. During/after production, collect exact actual units from the owner/operator.
12. Request exact complete approval using the complete template.
13. Collect exact pH/QC/pass-fail data from the owner/operator.
14. Request exact verify approval using the verify/QC template.
15. Only after verification, run post-verify cascade preview.
16. Separately decide whether pack/bottle/delivery/customer-status phases are appropriate.
17. Keep notifications held unless separately approved.
18. Keep inventory deduction and PurchaseOrder automation held.
19. Keep Hub active.
20. Use a new request id for every write phase.

## 10. Hard stops

Do not proceed to a live write if any of these are true:

- no real active paid/captured one-time order exists
- preview is missing or stale
- exact IDs are missing
- blockers are present
- duplicate batches/logs would be created
- owner/operator actual units are missing
- owner/operator QC data is missing
- any product/batch is unknown
- any product/batch is extra or missing
- any timestamp is fake or ambiguous
- inventory deduction is requested
- PurchaseOrder creation is requested
- notifications are requested
- provider/Stripe/Shopify calls are requested
- Hub mutation is requested
- sync/repair/replay is requested
- raw payloads or PII are supplied
- the request id was previously used for a failed or successful write
- gates are broader than the exact order/batch/policy being approved

## 11. Next phase recommendation

Recommended next phase:

- hold until the next natural paid/captured one-time order appears, then run G37C exact preview

Optional confidence work before a live order exists:

- G38E local packet-validation harness that checks the templates above against fixture data

Do not run live production lifecycle commands until a real active paid/captured one-time order exists and each write phase receives separate exact approval.
