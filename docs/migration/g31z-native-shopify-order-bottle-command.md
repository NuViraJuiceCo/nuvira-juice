# G31Z — Native ShopifyOrder Bottle/Pack Command Planning

Date: 2026-06-08

## Scope

G31Z prepares a default-off native Customer App command to mark the exact one-time native `ShopifyOrder` for `NV-MPZNKGNT` bottled after native production verification and FulfillmentTask pack have already succeeded.

This phase does **not** run the bottle/pack command and does **not** mutate live records during PR prep.

## Target context

- Order number: `NV-MPZNKGNT`
- Customer App Order id: `6a219a3f4adcda5856c3d579`
- Native ShopifyOrder id: `6a22ffda400eb806eb3ca945`
- Native FulfillmentTask id: `6a22ffdaf675ea79e30575aa`
- Production date: `2026-06-05`
- Delivery date: `2026-06-06`

Current native context after G31Y retry:

- Six native `ProductionBatch` rows exist and are `verified_logged`.
- Six `BatchComplianceLog` rows exist, one per batch.
- Native `FulfillmentTask` is `packed` with `production_status: packed` and `delivery_status: pending`.
- Native `ShopifyOrder` is still `production_status: awaiting_production` and `fulfillment_status: pending`.
- Customer App Order, customer-facing status, notifications, delivery/proof/drop/route state, inventory, PO, providers, Stripe, Shopify API, sync/repair/replay, and Hub bridge remain untouched.

## Audit findings

### Customer App ShopifyOrder schema

Relevant schema-safe order bottle fields:

- `production_status`
- `audit_trail`

The native `ShopifyOrder.production_status` enum includes `bottled`, `packed`, and later production/delivery states. G31Z uses `bottled` as the canonical v1 post-production bottle status because this command is specifically the order-level bottled cascade and must not advance delivery or fulfillment.

Fields intentionally held:

- `fulfillment_status`
- `shopify_fulfillment_status`
- `order_status`
- Customer App `Order.status`
- Customer App `Order.status_history`
- native `FulfillmentTask`
- `ProductionBatch`
- `BatchComplianceLog`
- notification fields
- delivery/proof/drop/route fields
- provider/payment/sync fields
- Hub records

### Hub reference behavior

Hub `bottleProductionVerifyShopifyOrderForCustomerApp` remains reference behavior only. G31Z does not call Hub and does not call Shopify. Native v1 keeps Customer App Order status projection, notifications, fulfillment status changes, delivery lifecycle, and Hub bridge changes separate.

## Bottle-state contract

Future approved live command may write only:

- `ShopifyOrder.production_status = bottled`
- safe `ShopifyOrder.audit_trail` append
- one safe `CommandLog`

It must not write:

- Customer App `Order`
- Customer App `Order.status_history`
- native `FulfillmentTask`
- `ProductionBatch`
- `BatchComplianceLog`
- `InventoryItem` / inventory deduction
- `PurchaseOrder`
- delivery/proof/drop/route fields
- notifications
- provider/payment/API calls
- sync/retry/repair/replay
- Hub records

## Command contract

Function:

- `bottleNativeProductionShopifyOrderForCustomerApp`

Confirmation phrase:

- `bottle_native_shopify_order_for_customer_app`

Required feature gates:

- `ENABLE_NATIVE_SHOPIFY_ORDER_BOTTLE=true`
- `NATIVE_SHOPIFY_ORDER_BOTTLE_KILL_SWITCH=false`
- `NATIVE_SHOPIFY_ORDER_BOTTLE_ALLOWED_EMAILS=<admin/owner allowlist>`
- `NATIVE_SHOPIFY_ORDER_BOTTLE_ORDER_ALLOWLIST=NV-MPZNKGNT`
- `NATIVE_SHOPIFY_ORDER_BOTTLE_SHOPIFY_ORDER_ALLOWLIST=6a22ffda400eb806eb3ca945`
- `NATIVE_SHOPIFY_ORDER_BOTTLE_POLICY=EXACT_VERIFIED_PACKED_ONE_TIME_ORDER_ONLY`

Defaults:

- disabled
- kill switch active
- no writes

Required inputs:

- `mode: live`
- `confirmation: bottle_native_shopify_order_for_customer_app`
- `order_number: NV-MPZNKGNT`
- `native_shopify_order_id: 6a22ffda400eb806eb3ca945`
- `native_fulfillment_task_id: 6a22ffdaf675ea79e30575aa`
- `customer_app_order_id: 6a219a3f4adcda5856c3d579`
- `production_date: 2026-06-05`
- `request_id`

Optional safety match:

- `expected_delivery_date: 2026-06-06`
- `expected_production_status: bottled`

Forbidden inputs include custom status overrides, fulfillment/delivery status overrides, Customer App Order updates, status history updates, notification flags, proof/drop/route data, sync/repair/replay flags, provider/payment payloads, raw payloads, production batch overrides, and bulk ids.

## Pre-write validation

The command performs fresh exact-target validation immediately before any write. By default it uses local preflight reads; optional service-preview invocation is available only behind explicit opt-in and fails closed.

Validation requires:

- exact order, Customer App Order, native ShopifyOrder, and native FulfillmentTask ids;
- Customer App Order present and paid/captured;
- native ShopifyOrder present and not cancelled/refunded;
- native ShopifyOrder is one-time / non-subscription / single-delivery;
- native ShopifyOrder current `production_status` is eligible for bottle, or already `bottled` for safe dedupe;
- native FulfillmentTask exists, is `packed`, has `production_status: packed`, and delivery lifecycle has not advanced;
- six exact native `ProductionBatch` rows are `verified_logged`;
- each batch has verification metadata and a readable `BatchComplianceLog` row;
- customer-facing status impact remains held;
- notifications remain held;
- fulfillment status update is not projected.

## Idempotency

- `request_id` is required.
- Existing success/skipped `CommandLog` for the same idempotency key returns skipped/idempotent success with `writes_performed:false`.
- Failed request ids cannot be reused.
- Already bottled exact target order is treated as safe skipped/dedupe; it does not rewrite the order.

## Preview and UI cleanup

G31Z updates the post-verify cascade preview to show:

- task pack already satisfied when the native `FulfillmentTask` is already `packed`;
- `shopify_order_bottle_ready` only when the task is packed and the order is eligible;
- proposed native ShopifyOrder `production_status: bottled`;
- Customer App Order status impact held;
- notifications held;
- no writes performed.

The `/admin/sync-health` panel uses read-only wording only. No live Bottle/Pack button is added.

## Hard stops

G31Z does not run live bottle/pack. Future live execution requires separate explicit approval, likely G32A.

## Recommended next phase

After G31Z is published and boundary-verified, request exact approval for G32A native ShopifyOrder bottle/pack for `NV-MPZNKGNT`, then run one gated live command with gates open only for that attempt.
