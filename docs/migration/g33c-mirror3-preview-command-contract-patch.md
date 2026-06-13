# G33C-MIRROR3-PATCH1 — One-Time ShopifyOrder Mirror Preview/Command Contract Patch

## Executive summary

G33C-MIRROR3 attempted the exact live native ShopifyOrder mirror for `NV-MP5SOQLJ` and failed closed before any write. The live command did not create a native ShopifyOrder, CommandLog, FulfillmentTask, Customer App Order update, Hub mutation, provider call, notification, sync/repair/replay, inventory action, or PurchaseOrder.

The failure was a preview/command contract mismatch: `createNativeOneTimeShopifyOrderMirrorForCustomerApp` validated several readiness fields at the top level of the G33C-MIRROR1 preview response, while the live read-only preview returns the canonical evidence in nested fields.

This patch keeps the command default-off and narrows the fix to command-side evidence normalization.

## Root cause

The command required top-level preview fields:

- `payment_status`
- `payment_captured`
- `order_type`
- `fulfillment_type`
- `line_item_count`

The live G33C-MIRROR1 preview for `NV-MP5SOQLJ` returns those values under canonical nested paths including:

- `customer_app_order_summary.payment_status`
- `customer_app_order_summary.payment_captured`
- `customer_app_order_summary.order_type`
- `customer_app_order_summary.fulfillment_type`
- `customer_app_order_summary.line_item_count`
- `native_shopify_order_mirror_preview.would_create_native_shopify_order`
- `native_fulfillment_task_preview.would_create_native_fulfillment_task`
- `native_fulfillment_task_preview.task_create_depends_on_native_shopify_order`

The command correctly returned `g33c_mirror1_preview_not_write_ready` with `writes_performed:false` instead of writing from incomplete evidence.

## Patch behavior

`createNativeOneTimeShopifyOrderMirrorForCustomerApp` now resolves G33C-MIRROR1 preview evidence from both supported response shapes:

1. Canonical nested preview fields.
2. Backward-compatible top-level preview fields.

The patch marker is:

- `g33c_mirror3_patch1_preview_command_contract_alignment`

## Validation remains strict

The command still fails closed unless all conditions are true:

- Customer App Order exists.
- Payment status is `paid`.
- Payment is captured.
- Order type is `one_time`.
- Fulfillment type is `delivery`.
- Line item count is `3` for `NV-MP5SOQLJ`.
- Native ShopifyOrder is missing.
- Native FulfillmentTask is missing.
- G33C-MIRROR1 says `would_create_native_shopify_order:true`.
- G33C-MIRROR1 says `would_create_native_fulfillment_task:false`.
- Task preview remains dependent on native ShopifyOrder.
- Provider call impact is false.
- Notifications are held.
- Preview blockers are empty.

If canonical evidence is missing, the command returns a safe blocker identifying the missing evidence path and performs no write.

## No-write policy for PATCH1

This phase does not authorize live mirror creation. Gates remain closed during publish and boundary verification.

PATCH1 does not authorize:

- Native ShopifyOrder creation.
- FulfillmentTask creation.
- Customer App Order mutation.
- Hub mutation.
- ProductionBatch or BatchComplianceLog creation.
- OrderSyncLog or OrderReviewQueue creation.
- Notification or message log creation.
- Stripe, Shopify, or provider calls.
- Sync, repair, replay, inventory, or PurchaseOrder actions.

## Next step

After PATCH1 is merged, deployed, boundary-verified with gates closed, and a fresh G33C-MIRROR1 preview remains clean, a new G33C-MIRROR3 retry requires separate explicit owner approval and a new request id.
