# G32C: Customer-facing status / notification impact preview

## Scope

G32C adds a read-only preview for customer-facing status and notification impact after native production completion for `NV-MPZNKGNT`.

This phase does not update Customer App `Order`, append `status_history`, create or send notifications, update native `ShopifyOrder`, update native `FulfillmentTask`, update `ProductionBatch`, create compliance logs, deduct inventory, create purchase orders, call Stripe/Shopify/providers, run sync/repair/replay, or mutate delivery/proof/drop/route state.

## Target context

- Order number: `NV-MPZNKGNT`
- Customer App Order id: `6a219a3f4adcda5856c3d579`
- Native ShopifyOrder id: `6a22ffda400eb806eb3ca945`
- Native FulfillmentTask id: `6a22ffdaf675ea79e30575aa`
- Production date: `2026-06-05`
- Delivery date: `2026-06-06`

Expected pre-G32C state:

- Customer App `Order.status`: `scheduled_for_juicing`
- Native `ShopifyOrder.production_status`: `bottled`
- Native `FulfillmentTask.status`: `packed`
- Native `FulfillmentTask.production_status`: `packed`
- Six native `ProductionBatch` rows: `verified_logged`
- Six locked `BatchComplianceLog` rows
- Customer-facing status and notifications held

## Audit findings

### Customer App status model

Customer App `Order.status` supports these customer-facing states:

- `order_received`
- `scheduled_for_juicing`
- `in_production`
- `bottled_packed`
- `out_for_delivery`
- `arriving_soon`
- `delivered`
- `ready_for_pickup`
- `picked_up`

Existing Hub/native projection helpers consistently map production `bottled`, `labeled`, `qc_checked`, `packed`, and `in_cold_storage` to customer-facing `bottled_packed`.

Therefore the G32C proposed status for a one-time order whose native production/order state is verified, packed, and bottled is:

- `bottled_packed`

### Notification behavior

`sendOrderStatusNotification` has notification configs for:

- `scheduled_for_juicing`
- `in_production`
- `out_for_delivery`
- `arriving_soon`
- `delivered`
- `ready_for_pickup`

It does not configure a notification for `bottled_packed`.

Non-confirmation customer notifications remain gated by environment flags. The preview does not invoke notification functions and does not create notification records.

### Status-history behavior

A future status-only command, if separately approved, would need to append a safe `status_history` entry. G32C only previews that entry and keeps it held.

## Preview function

Function: `previewNativeCustomerStatusNotificationImpact`

Auth:

- admin auth, or
- internal preview/service secret using the existing read-only preview pattern.

Accepted inputs:

- `order_number`
- `customer_app_order_id`
- `native_shopify_order_id`
- `native_fulfillment_task_id`
- `request_id`
- `mode: dry_run`

Reads only:

- `Order`
- `ShopifyOrder`
- `FulfillmentTask`
- `ProductionBatch`
- `BatchComplianceLog`
- `Notification`
- `CustomerMessageDeliveryLog`
- `CommandLog`

Response highlights:

- `success`
- `dry_run: true`
- `writes_performed: false`
- `production_verified`
- `task_packed`
- `native_order_bottled`
- `current_customer_order_status`
- `proposed_customer_order_status`
- `status_update_ready`
- `status_update_held`
- `status_history_preview`
- `notification_preview`
- `notification_would_send: false`
- `notification_held: true`
- `blockers`
- `warnings`
- `next_action`
- `hub_fallback_required`

## Classification rules

A status-only path is preview-ready only when:

- Customer App `Order` exists;
- payment is paid/captured;
- native `ShopifyOrder.production_status` is `bottled`;
- native `FulfillmentTask.status` and `production_status` are `packed`;
- all target native `ProductionBatch` rows are `verified_logged`;
- required `BatchComplianceLog` rows exist;
- the order is one-time / non-subscription / single-delivery;
- the order is not cancelled/refunded/terminal;
- the proposed status does not imply out-for-delivery, delivery, proof, drop, or route state;
- no notification would send automatically for the proposed status.

Even when the status-only path is preview-ready, G32C keeps the update held until a separate explicit status command approval.

## NV-MPZNKGNT expected result

For the current post-G32A state:

- `production_verified: true`
- `task_packed: true`
- `native_order_bottled: true`
- `current_customer_order_status: scheduled_for_juicing`
- `proposed_customer_order_status: bottled_packed`
- `status_update_ready: true`
- `status_update_held: true`
- `notification_would_send: false`
- `notification_held: true`
- `next_action: plan_status_only_command_with_notifications_disabled`

## Hard stops

G32C does not:

- update Customer App `Order`;
- append `status_history`;
- create notification records;
- send push, SMS, email, or in-app notifications;
- update native `ShopifyOrder`, `FulfillmentTask`, or `ProductionBatch`;
- mutate compliance logs;
- deduct inventory;
- create purchase orders;
- call Stripe, Shopify, providers, sync, repair, retry, or replay;
- expose customer status or notification write buttons.

## Recommended next phase

If live preview for `NV-MPZNKGNT` matches the expected result, the next phase can plan a default-off, exact-order, status-only Customer App `Order.status = bottled_packed` command with notifications explicitly disabled/blocked.

Alternatively, business can hold customer-facing status unchanged until delivery workflow planning.
