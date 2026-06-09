# G32J: Historical Hub fulfilled native backfill preview

## Scope

G32J adds `previewHistoricalHubFulfilledNativeBackfill`, a read-only preview for Hub order `1052` / Stephanie Morales. The preview evaluates whether a historical fulfilled Hub order that has no Customer App/native mirror records can safely move to a later, separately approved backfill plan.

This phase is preview/planning only.

## Confirmed safety boundaries

The preview does not:

- create Customer App Order records
- create native ShopifyOrder records
- create native FulfillmentTask records
- update Hub records
- update Customer App/native records
- append `status_history`
- send notifications or create notification/message log rows
- call Stripe, Shopify, or providers
- run sync/retry/repair/replay
- create ProductionBatch or BatchComplianceLog rows
- write proof/drop/route fields
- deduct inventory or create PurchaseOrders

## Required request contract

Required input values:

- `hub_order_number`: `1052`
- `correction_mode`: `HISTORICAL_HUB_FULFILLED_BACKFILL_NO_NOTIFICATION`
- `notification_policy`: `NO_NOTIFICATION`
- `proof_drop_policy`: `HELD_NOT_REQUIRED_FOR_RECONCILIATION`

Authentication is admin or internal service-secret only. Unauthenticated requests return `401`; non-POST requests return `405`.

## Preview decisions

For a Hub fulfilled order with no local/native duplicates and enough schema-safe data, the preview can mark only a native ShopifyOrder historical fulfilled mirror as preview-ready. It keeps Customer App Order backfill and native FulfillmentTask reconstruction held for separate contracts.

For order `1052`, G32H established a narrow safe audit fallback when Hub bulk reads time out. That fallback confirms `fulfillment_status: fulfilled` and `production_status: new`, but does not include line items, customer identity, or fulfillment/delivery date. If the live Hub read remains unavailable or sparse, G32J returns blockers such as:

- `hub_line_items_missing`
- `hub_customer_identity_missing`
- `hub_fulfillment_or_delivery_date_missing`
- `insufficient_hub_data_for_historical_backfill`

Warnings include:

- `hub_production_status_new_despite_fulfilled`
- `hub_task_rows_absent`
- `customer_app_order_backfill_held`
- `native_fulfillment_task_backfill_held`
- `notifications_held`
- `proof_drop_held`
- `hub_mutation_not_proposed`

## Held records

- Customer App Order creation remains held because it can expose a historical order to customer-facing account views.
- Native FulfillmentTask backfill remains held because no Hub task rows were found and delivered task reconstruction needs a dedicated exact contract.
- Notifications remain held by `NO_NOTIFICATION`.
- Proof/drop remains held by `HELD_NOT_REQUIRED_FOR_RECONCILIATION`.
- Hub records remain read-only context.

## Next step

A live historical native mirror/backfill command requires separate explicit approval with exact target fields after G32J preview output is reviewed.
