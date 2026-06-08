# G32D — Gated Customer App Order status-only command

## Scope

G32D prepares a default-off, exact-order, Customer App `Order` status-only command for `NV-MPZNKGNT`.

The command is PR prep only. It must not be run live until a separate explicit approval phase.

## Target

- Order number: `NV-MPZNKGNT`
- Customer App Order id: `6a219a3f4adcda5856c3d579`
- Native ShopifyOrder id: `6a22ffda400eb806eb3ca945`
- Native FulfillmentTask id: `6a22ffdaf675ea79e30575aa`
- Production date: `2026-06-05`
- Delivery date: `2026-06-06`

## Audit findings

### Customer status model

`base44/entities/Order.jsonc` defines `Order.status` values including:

- `scheduled_for_juicing`
- `in_production`
- `bottled_packed`
- `out_for_delivery`
- `arriving_soon`
- `delivered`
- `ready_for_pickup`
- `picked_up`

`bottled_packed` is a valid Customer App Order status.

`Order.status_history` is an array of objects containing schema-safe fields:

- `status`
- `timestamp`
- `message`

G32D uses only those fields in the future status-history append.

### Status mapping

Existing Customer App projection paths map native/Hub post-production states to `bottled_packed`:

- `bottled -> bottled_packed`
- `labeled -> bottled_packed`
- `qc_checked -> bottled_packed`
- `packed -> bottled_packed`
- `in_cold_storage -> bottled_packed`

For `NV-MPZNKGNT`, the preview-ready mapping is:

- current Customer App Order status: `scheduled_for_juicing`
- target Customer App Order status: `bottled_packed`

### Notification behavior

`sendOrderStatusNotification` has notification configs for:

- `scheduled_for_juicing`
- `in_production`
- `out_for_delivery`
- `arriving_soon`
- `delivered`
- `ready_for_pickup`

It does not configure a notification for `bottled_packed`.

The command does not invoke `sendOrderStatusNotification`, `sendCustomerNotification`, push, SMS, email, or in-app notification paths. It also does not create `Notification` or `CustomerMessageDeliveryLog` rows.

Because Base44 entity automation may observe `Order.update`, the command additionally requires the explicit input `notification_policy: NO_NOTIFICATION` and validates that `bottled_packed` has no configured notification subtype before any write.

## Function

Function name:

- `updateNativeCustomerOrderStatusForCustomerApp`

Confirmation phrase:

- `update_customer_order_status_bottled_packed_no_notification`

Required policy:

- `EXACT_STATUS_ONLY_NO_NOTIFICATION`

Required notification policy:

- `NO_NOTIFICATION`

## Gates

Default gate state is closed:

- `ENABLE_NATIVE_CUSTOMER_STATUS_UPDATE` must be `true`
- `NATIVE_CUSTOMER_STATUS_UPDATE_KILL_SWITCH` must be `false`
- `NATIVE_CUSTOMER_STATUS_UPDATE_ALLOWED_EMAILS` must include the admin actor email
- `NATIVE_CUSTOMER_STATUS_UPDATE_ORDER_ALLOWLIST` must include `NV-MPZNKGNT`
- `NATIVE_CUSTOMER_STATUS_UPDATE_CUSTOMER_ORDER_ALLOWLIST` must include `6a219a3f4adcda5856c3d579`
- `NATIVE_CUSTOMER_STATUS_UPDATE_POLICY` must equal `EXACT_STATUS_ONLY_NO_NOTIFICATION`

If any gate is missing or closed, the command returns a safe `409` with `writes_performed:false`.

## Inputs

Required live inputs for a future approved run:

```json
{
  "mode": "live",
  "order_number": "NV-MPZNKGNT",
  "customer_app_order_id": "6a219a3f4adcda5856c3d579",
  "native_shopify_order_id": "6a22ffda400eb806eb3ca945",
  "native_fulfillment_task_id": "6a22ffdaf675ea79e30575aa",
  "production_date": "2026-06-05",
  "current_status_expected": "scheduled_for_juicing",
  "target_status": "bottled_packed",
  "notification_policy": "NO_NOTIFICATION",
  "request_id": "<unique request id>",
  "confirmation": "update_customer_order_status_bottled_packed_no_notification"
}
```

Forbidden inputs include notification payloads/flags, delivery/proof/drop/route fields, native order/task status overrides, production-batch fields, provider/payment payloads, raw payloads, sync/repair/replay flags, and bulk ids.

## Pre-write validation

Before any future write, the command validates:

- admin auth passes;
- actor email is allowlisted;
- exact order/customer-order/native-order/task ids match;
- current Customer App Order status is `scheduled_for_juicing`, or already `bottled_packed` for safe dedupe;
- target status is `bottled_packed`;
- `notification_policy` is `NO_NOTIFICATION`;
- Customer App Order is paid/captured;
- native ShopifyOrder is `bottled`;
- native FulfillmentTask is `packed`;
- all six target ProductionBatch rows are `verified_logged`;
- all six BatchComplianceLog rows exist;
- order is one-time / non-subscription / single-delivery;
- order/task delivery lifecycle has not advanced;
- `bottled_packed` has no configured notification subtype;
- fresh customer status / notification impact preview is clean.

The fresh preview uses local preflight by default. An optional service-preview path can invoke `previewNativeCustomerStatusNotificationImpact` with service-role context and fails closed on timeout or preview error.

## Allowed future writes

Only these writes are allowed if a future explicit live approval is granted:

- exact Customer App `Order.status = bottled_packed`
- exact Customer App `Order.status_history` append with schema-safe fields only
- one safe `CommandLog`

## Explicit non-goals

G32D does not write:

- `Notification`
- `CustomerMessageDeliveryLog`
- native `ShopifyOrder`
- native `FulfillmentTask`
- `ProductionBatch`
- `BatchComplianceLog`
- `InventoryItem`
- `PurchaseOrder`
- `OrderSyncLog`
- `OrderReviewQueue`
- `SafeSyncParityLog`
- Hub records

G32D does not call Stripe, Shopify, providers, notification providers, sync, retry, repair, replay, delivery/proof/drop/route flows, or inventory deduction.

## Idempotency

- `request_id` is required.
- Existing successful or skipped `CommandLog` for the same idempotency key returns skipped/idempotent success with `writes_performed:false`.
- A failed prior request id is not reusable.
- A different request after the Customer App Order is already `bottled_packed` returns a safe skipped/dedupe result and does not append another status-history entry.

## Preview/UI integration

`previewNativeCustomerStatusNotificationImpact` now exposes command-planning metadata:

- `status_command_available`
- `status_command_gated`
- `status_requires_exact_approval`
- `notification_policy_required: NO_NOTIFICATION`
- `proposed_status_history_entry`
- `customer_status_already_satisfied`

`/admin/sync-health` displays this as read-only status. No status update, notification, delivery, sync, or repair button is exposed.

## Next approval format

Future live approval should be explicit, for example:

```text
APPROVE G32E EXACT CUSTOMER STATUS ONLY UPDATE NV-MPZNKGNT NO NOTIFICATION
```

and should confirm:

- order number `NV-MPZNKGNT`
- Customer App Order id `6a219a3f4adcda5856c3d579`
- current status `scheduled_for_juicing`
- target status `bottled_packed`
- notification policy `NO_NOTIFICATION`
