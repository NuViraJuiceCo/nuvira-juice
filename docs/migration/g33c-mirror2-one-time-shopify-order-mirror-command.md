# G33C-MIRROR2: one-time ShopifyOrder mirror command

## Executive summary

G33C-MIRROR2 adds a default-off gated command for one exact one-time Customer App order recovery path:

- Function: `createNativeOneTimeShopifyOrderMirrorForCustomerApp`
- Target order: `NV-MP5SOQLJ`
- Customer App Order id: `6a060df457fc07751f3c7ded`
- Allowed future write, only after separate explicit owner approval: one native `ShopifyOrder` mirror and one safe `CommandLog`

This PR prep phase does not run the live command. Hub remains active. Native `FulfillmentTask` creation remains held until the native `ShopifyOrder` mirror exists and a separate task preview/command is approved.

## Command contract

Required request inputs:

```json
{
  "order_number": "NV-MP5SOQLJ",
  "customer_app_order_id": "6a060df457fc07751f3c7ded",
  "notification_policy": "NO_NOTIFICATION",
  "provider_call_policy": "NO_PROVIDER_CALLS",
  "hub_mutation_policy": "NO_HUB_MUTATION",
  "task_creation_policy": "HELD_UNTIL_NATIVE_SHOPIFY_ORDER_EXISTS",
  "request_id": "<exact idempotency key>",
  "confirmation": "create_native_one_time_shopify_order_mirror_no_notification"
}
```

Required confirmation phrase:

```text
create_native_one_time_shopify_order_mirror_no_notification
```

Required policy:

```text
EXACT_ONE_TIME_SHOPIFY_ORDER_MIRROR_ONLY_NO_NOTIFICATION
```

## Gates

All gates are default-closed:

- `ENABLE_NATIVE_ONE_TIME_SHOPIFY_ORDER_MIRROR`
- `NATIVE_ONE_TIME_SHOPIFY_ORDER_MIRROR_KILL_SWITCH`
- `NATIVE_ONE_TIME_SHOPIFY_ORDER_MIRROR_ALLOWED_EMAILS`
- `NATIVE_ONE_TIME_SHOPIFY_ORDER_MIRROR_ORDER_ALLOWLIST`
- `NATIVE_ONE_TIME_SHOPIFY_ORDER_MIRROR_CUSTOMER_ORDER_ALLOWLIST`
- `NATIVE_ONE_TIME_SHOPIFY_ORDER_MIRROR_POLICY`

A future live run requires:

- enable flag set true
- kill switch false
- actor email allowlisted
- exact order number allowlisted
- exact Customer App Order id allowlisted
- policy exactly `EXACT_ONE_TIME_SHOPIFY_ORDER_MIRROR_ONLY_NO_NOTIFICATION`
- admin auth
- exact confirmation phrase

No browser-supplied actor identity is trusted.

## Fresh G33C-MIRROR1 preview requirement

Before any write, the command invokes the existing read-only preview locally through the Base44 SDK:

```json
{
  "preview_mode": "ONE_TIME_NATIVE_MIRROR_TASK_PARITY",
  "mode": "EXACT_ORDER_PREVIEW",
  "order_number": "NV-MP5SOQLJ",
  "customer_app_order_id": "6a060df457fc07751f3c7ded"
}
```

Required preview evidence:

- `success:true`
- `dry_run:true`
- `writes_performed:false`
- Customer App Order exists
- `payment_status:paid`
- `payment_captured:true`
- `order_type:one_time`
- `fulfillment_type:delivery`
- `line_item_count:3`
- native ShopifyOrder present: `false`
- native FulfillmentTask present: `false`
- missing native reason: `native_ops_duplicate_hub_dedupe_only`
- Hub bridge status: `deduped`
- OrderReviewQueue blocker absent
- proposed native ShopifyOrder packet present
- `would_create_native_shopify_order:true`
- proposed FulfillmentTask remains held with `task_create_depends_on_native_shopify_order`
- `provider_call_impact:false`
- notifications held
- Hub mutation not projected

If the preview is unavailable, unstable, blocked, or no longer matches the exact target, the command fails closed with `writes_performed:false`.

## Native ShopifyOrder create contract

The command creates only schema-safe fields derived from the fresh G33C-MIRROR1 packet.

Supported top-level values include:

- `shopify_order_number:#NV-MP5SOQLJ`
- `base44_order_id:6a060df457fc07751f3c7ded`
- `source_channel:online`
- `source_type:customer_app_one_time_native_mirror`
- `order_type:one_time`
- `fulfillment_mode:single_delivery`
- `fulfillment_method:delivery`
- `payment_status:paid`
- `financial_status:paid`
- `production_status:bottled`
- `fulfillment_status:pending`
- `sync_status:native_one_time_mirror_g33c_mirror2`
- three line items from the safe preview packet
- delivery and production date fields when schema-safe
- safe audit trail metadata

Schema note: `ShopifyOrder.source_channel` does not support `customer_app`; the command uses schema-valid `online` and stores Customer App source context in `source_type`, `sync_status`, tags, and audit trail.

## Fields intentionally omitted

The command does not write:

- raw Customer App payload
- raw Hub payload
- raw Shopify payload
- raw Stripe/payment payload
- customer email
- customer phone
- full address
- proof/drop/route fields
- notification fields
- FulfillmentTask fields
- unsupported top-level preview fields

## No-notification / no-provider / no-Hub-mutation policy

G33C-MIRROR2 does not:

- call Stripe
- call Shopify
- call providers
- send notifications
- create notification rows
- create message logs
- mutate Hub records
- disable or alter the Hub bridge
- run sync, retry, repair, or replay
- deduct inventory
- create PurchaseOrders

## Records held

The command does not write:

- Customer App `Order`
- native `FulfillmentTask`
- `ProductionBatch`
- `BatchComplianceLog`
- `OrderSyncLog`
- `OrderReviewQueue`
- `Notification`
- `CustomerMessageDeliveryLog`
- `InventoryItem`
- `PurchaseOrder`

## Idempotency

`request_id` is required. The command builds an idempotency key from:

```text
native_one_time_shopify_order_mirror_create:<order_number>:<customer_app_order_id>:<request_id>
```

Behavior:

- prior successful `CommandLog` returns skipped/idempotent success
- existing native ShopifyOrder created by the same request returns skipped/idempotent success
- failed prior log does not count as success and blocks request id reuse
- existing native ShopifyOrder from another source conflicts safely and blocks duplicate creation
- no partial write is allowed after validation failure

## Live execution boundary

This PR prep does not run the live mirror command.

A future G33C-MIRROR3/G33D-style live execution would require a new explicit owner approval including:

- exact order number
- exact Customer App Order id
- fresh clean G33C-MIRROR1 preview
- exact gate values
- no notification policy
- no provider call policy
- no Hub mutation policy
- confirmation phrase

## Hub policy

Hub remains active. This mirror is recovery/admin context only. It is not approval to broaden native one-time gates or retire Hub fallback.
