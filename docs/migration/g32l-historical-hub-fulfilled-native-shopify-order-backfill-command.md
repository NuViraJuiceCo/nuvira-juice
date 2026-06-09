# G32L: Historical Hub fulfilled native ShopifyOrder mirror backfill command

## Scope

G32L adds `backfillHistoricalHubFulfilledNativeShopifyOrderForCustomerApp`, a default-off gated command for Hub order `1052` only. The command can later create exactly one historical native `ShopifyOrder` mirror for a Hub-fulfilled order missing native records.

This PR does not run the live backfill.

## Gates

Required gate names:

- `ENABLE_HISTORICAL_HUB_FULFILLED_NATIVE_SHOPIFY_ORDER_BACKFILL`
- `HISTORICAL_HUB_FULFILLED_NATIVE_SHOPIFY_ORDER_BACKFILL_KILL_SWITCH`
- `HISTORICAL_HUB_FULFILLED_NATIVE_SHOPIFY_ORDER_BACKFILL_ALLOWED_EMAILS`
- `HISTORICAL_HUB_FULFILLED_NATIVE_SHOPIFY_ORDER_BACKFILL_ORDER_ALLOWLIST`
- `HISTORICAL_HUB_FULFILLED_NATIVE_SHOPIFY_ORDER_BACKFILL_POLICY`

Required policy:

- `HISTORICAL_FULFILLED_NATIVE_SHOPIFY_ORDER_ONLY_NO_NOTIFICATION`

Confirmation phrase:

- `backfill_historical_hub_fulfilled_native_shopify_order_no_notification`

## Required live input contract

- `mode: live`
- `hub_order_number: 1052`
- `request_id`
- `correction_mode: HISTORICAL_HUB_FULFILLED_BACKFILL_NO_NOTIFICATION`
- `notification_policy: NO_NOTIFICATION`
- `customer_app_order_backfill: HELD`
- `native_fulfillment_task_backfill: HELD`
- `proof_drop_policy: HELD_NOT_REQUIRED_FOR_RECONCILIATION`
- `confirmation`

## Allowed future writes

- One native `ShopifyOrder` historical fulfilled mirror.
- One safe `CommandLog`.

## Explicitly held

The command does not create or update:

- Customer App Order
- native FulfillmentTask
- Hub records
- Notification or MessageLog
- ProductionBatch or BatchComplianceLog
- OrderSyncLog, OrderReviewQueue, or SafeSyncParityLog
- InventoryItem or PurchaseOrder
- proof/drop/route fields

It does not call Stripe, Shopify, providers, sync, retry, repair, or replay.

## Native ShopifyOrder field contract

The schema audit confirms `ShopifyOrder.production_status` supports `fulfilled`. `fulfillment_status` is a string field and can safely be set to `fulfilled`.

The command writes only schema-supported native ShopifyOrder fields. It intentionally does not write optional customer name/email/phone/address fields because they are not required by the native mirror contract. The live response and CommandLog summarize only safe metadata and counts.

Primary mirror fields:

- `shopify_order_number: 1052`
- `shopify_order_id: historical_hub_fulfilled:1052`
- `source_type: hub_historical_backfill`
- `source_channel: admin`
- `order_type: one_time`
- `fulfillment_mode: single_delivery`
- `fulfillment_method: delivery`
- `production_status: fulfilled`
- `fulfillment_status: fulfilled`
- `shopify_fulfillment_status: fulfilled`
- safe line item summary from Hub read
- safe total/payment fields if available
- historical backfill tags/status/audit metadata

## Validation

Before writing, the command requires:

- gates open and exact order allowlist match
- admin actor and allowlisted actor email
- Hub order 1052 present and fulfilled
- one-time/single-delivery support
- not cancelled/refunded
- no Customer App Order for 1052
- no native ShopifyOrder for 1052
- no native FulfillmentTask for 1052
- no Customer App Order or FulfillmentTask backfill requested
- no notification/proof/drop/route mutation projected
- fresh preview or local preflight clean
- schema-safe native ShopifyOrder payload

If validation fails, it returns a structured safe response with `writes_performed:false`.

## Idempotency

The command uses `CommandLog.idempotency_key = historical_hub_fulfilled_native_shopify_order_backfill:<request_id>`.

A duplicate successful request skips with `writes_performed:false`. A previous failed request id is not reusable. Existing native records for order 1052 from another request/source block instead of creating duplicates.
