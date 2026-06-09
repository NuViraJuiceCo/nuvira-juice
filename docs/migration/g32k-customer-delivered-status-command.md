# G32K: Customer App delivered status preview and gated command

## Scope

G32K adds a read-only Customer App delivered/fulfilled status impact preview and a default-off gated command for the exact order `NV-MPZNKGNT`.

This phase is PR prep only. It does not run the live Customer App Order status update.

## Target

- Order number: `NV-MPZNKGNT`
- Customer App Order id: `6a219a3f4adcda5856c3d579`
- Native ShopifyOrder id: `6a22ffda400eb806eb3ca945`
- Native FulfillmentTask id: `6a22ffdaf675ea79e30575aa`

## Status mapping audit

Canonical final Customer App Order status for this phase: `delivered`.

Reasoning:

- Existing Customer App status/notification code recognizes `delivered` as a customer-facing terminal/delivery status.
- Native delivery completion has already reconciled the native FulfillmentTask to `delivered` and the native ShopifyOrder to `fulfilled`.
- The stale `bottled_packed` status-only path is not appropriate after G32I-LIVE because delivery is already complete.

Notification caveat:

- A delivered notification subtype is configured in existing status notification mappings.
- G32K therefore requires `notification_policy=NO_NOTIFICATION` and does not call notification functions.
- The command only writes the Customer App Order status/status_history and a safe CommandLog when later approved.

Proof/drop caveat:

- `proof_drop_policy=HELD_NOT_REQUIRED_FOR_RECONCILIATION` is required.
- G32K does not write proof, drop, route, or delivery lifecycle fields.

## Read-only preview

Function:

- `previewNativeCustomerDeliveredStatusImpact`

Required policies:

- `status_mode=DELIVERED_STATUS_ONLY_NO_NOTIFICATION`
- `notification_policy=NO_NOTIFICATION`
- `proof_drop_policy=HELD_NOT_REQUIRED_FOR_RECONCILIATION`

Expected G32K target readiness:

- Customer App Order exists and is paid/captured.
- Native ShopifyOrder exists, production_status is `bottled`, and fulfillment_status is `fulfilled`.
- Native FulfillmentTask exists, status is `delivered`, delivery_status is `delivered`, and delivered_at is present.
- Six native ProductionBatch rows are `verified_logged`.
- Six BatchComplianceLog rows exist.
- Proposed Customer App Order status is `delivered`.
- Notification impact remains held and false.
- Proof/drop impact remains held and false.
- `writes_performed:false`.

## Gated command

Function:

- `updateNativeCustomerOrderDeliveredStatusForCustomerApp`

Confirmation phrase:

- `update_customer_order_delivered_status_no_notification`

Required policy:

- `DELIVERED_STATUS_ONLY_NO_NOTIFICATION`

Gate names:

- `ENABLE_NATIVE_CUSTOMER_DELIVERED_STATUS_UPDATE`
- `NATIVE_CUSTOMER_DELIVERED_STATUS_UPDATE_KILL_SWITCH`
- `NATIVE_CUSTOMER_DELIVERED_STATUS_UPDATE_ALLOWED_EMAILS`
- `NATIVE_CUSTOMER_DELIVERED_STATUS_UPDATE_ORDER_ALLOWLIST`
- `NATIVE_CUSTOMER_DELIVERED_STATUS_UPDATE_CUSTOMER_ORDER_ALLOWLIST`
- `NATIVE_CUSTOMER_DELIVERED_STATUS_UPDATE_TASK_ALLOWLIST`
- `NATIVE_CUSTOMER_DELIVERED_STATUS_UPDATE_SHOPIFY_ORDER_ALLOWLIST`
- `NATIVE_CUSTOMER_DELIVERED_STATUS_UPDATE_POLICY`

Default behavior:

- Disabled unless explicitly enabled.
- Kill switch active unless explicitly opened.
- Exact order/customer-order/task/native-order allowlists required.
- Admin auth required.
- Actor email must be allowlisted.
- Public unauthenticated calls return 401.
- Non-admin calls return 403.
- Closed gates return safe 409 with `writes_performed:false`.

Allowed future writes after separate explicit approval:

1. Exact Customer App Order `6a219a3f4adcda5856c3d579`
   - `status: delivered`
   - safe `status_history` append
2. One safe `CommandLog`

Forbidden writes/actions:

- Native ShopifyOrder update
- Native FulfillmentTask update
- ProductionBatch update
- BatchComplianceLog update
- Notification or message log creation
- Push/SMS/email/in-app sends
- Proof/drop/route writes
- Delivery lifecycle field writes
- Provider, Stripe, or Shopify API calls
- Sync, repair, or replay
- Inventory deduction
- PurchaseOrder creation
- Hub mutation

## Idempotency

- `request_id` is required.
- Existing success/skipped CommandLog for the same idempotency key returns skipped/idempotent success.
- Existing failed request id is not reusable.
- Duplicate success does not update the Customer App Order a second time and does not append duplicate status_history.
- Already delivered Customer App Order skips without status_history append.

## Live execution

Live execution requires a separate explicit approval. G32K does not run the live command.
