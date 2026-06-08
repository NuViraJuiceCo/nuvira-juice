# G32I: Gated Direct Delivered Reconciliation Command

## Scope

Adds `reconcileNativeDeliveryCompletionForCustomerApp`, a default-off gated command for the exact native delivery completion reconciliation for order `NV-MPZNKGNT`.

This phase does **not** run live correction. Live execution requires a separate explicit approval with an owner-approved `actual_delivered_at` timestamp.

## Target

- Order number: `NV-MPZNKGNT`
- Customer App Order id: `6a219a3f4adcda5856c3d579`
- Native ShopifyOrder id: `6a22ffda400eb806eb3ca945`
- Native FulfillmentTask id: `6a22ffdaf675ea79e30575aa`

## Confirmation phrase

`reconcile_native_delivery_completion_no_notification`

## Gates

Default state is disabled / fail-closed.

- `ENABLE_NATIVE_DELIVERY_COMPLETION_RECONCILIATION`
- `NATIVE_DELIVERY_COMPLETION_RECONCILIATION_KILL_SWITCH`
- `NATIVE_DELIVERY_COMPLETION_RECONCILIATION_ALLOWED_EMAILS`
- `NATIVE_DELIVERY_COMPLETION_RECONCILIATION_ORDER_ALLOWLIST`
- `NATIVE_DELIVERY_COMPLETION_RECONCILIATION_CUSTOMER_ORDER_ALLOWLIST`
- `NATIVE_DELIVERY_COMPLETION_RECONCILIATION_TASK_ALLOWLIST`
- `NATIVE_DELIVERY_COMPLETION_RECONCILIATION_SHOPIFY_ORDER_ALLOWLIST`
- `NATIVE_DELIVERY_COMPLETION_RECONCILIATION_POLICY`

Required policy:

`DIRECT_DELIVERED_NO_NOTIFICATION`

## Required input contract

- `mode: live`
- `order_number: NV-MPZNKGNT`
- `customer_app_order_id: 6a219a3f4adcda5856c3d579`
- `native_shopify_order_id: 6a22ffda400eb806eb3ca945`
- `native_fulfillment_task_id: 6a22ffdaf675ea79e30575aa`
- `actual_delivered_at`: valid ISO timestamp
- `notification_policy: NO_NOTIFICATION`
- `proof_drop_policy: HELD_NOT_REQUIRED_FOR_RECONCILIATION`
- `correction_mode: DIRECT_DELIVERED_NO_NOTIFICATION`
- `request_id`
- `confirmation: reconcile_native_delivery_completion_no_notification`

## Allowed future writes

Only after separate live approval:

1. Exact native FulfillmentTask `6a22ffdaf675ea79e30575aa`
   - `status = delivered`
   - `delivery_status = delivered`
   - `delivered_at = approved actual_delivered_at`
   - safe `audit_trail` append

2. Exact native ShopifyOrder `6a22ffda400eb806eb3ca945`
   - `fulfillment_status = fulfilled`
   - safe `audit_trail` append

3. One safe `CommandLog`

## Explicitly forbidden writes/actions

- Customer App Order update
- Customer App `status_history` append
- Notifications or message logs
- Proof/drop/route fields
- Native ShopifyOrder `production_status`
- Native ShopifyOrder `delivered_at`
- Native FulfillmentTask `production_status`
- ProductionBatch or BatchComplianceLog mutation
- OrderSyncLog / OrderReviewQueue / SafeSyncParityLog mutation
- Hub record mutation
- Stripe / Shopify / provider calls
- Sync / repair / replay
- Inventory deduction or PurchaseOrder creation

## Validation

Before writing, the command validates:

- admin auth and allowlisted actor email
- closed gates return safe `409` with `writes_performed:false`
- exact order/task/order allowlists
- valid ISO delivered timestamp
- Customer App Order exists and is paid/captured
- Native ShopifyOrder exists and `production_status=bottled`, `fulfillment_status=pending`
- Native FulfillmentTask exists and `status=packed`, `delivery_status=pending`, `production_status=packed`
- six target ProductionBatch rows are `verified_logged`
- six BatchComplianceLog rows exist
- fresh delivery completion reconciliation preview is clean
- no customer status, notification, proof/drop/route, ProductionBatch, BatchComplianceLog, provider, payment, sync/repair/replay, inventory, PO, or Hub mutation is projected

## Idempotency

- `request_id` is required.
- A matching successful/skipped `CommandLog` returns idempotent skipped success with no writes.
- A failed prior log cannot be reused.
- Duplicate calls do not append duplicate audit entries, do not update records again, and do not create a second success log.

## Failure behavior

- Validation failure returns a structured safe response with `writes_performed:false`.
- CommandLog creation failure occurs before record mutation and returns a structured safe error.
- If FulfillmentTask update succeeds but ShopifyOrder update fails, the command returns a reconciliation-required structured error and finalizes the CommandLog as failed with partial-write metadata.
- No stack traces, raw payloads, secrets, provider/payment data, proof/drop data, or customer PII are returned.
