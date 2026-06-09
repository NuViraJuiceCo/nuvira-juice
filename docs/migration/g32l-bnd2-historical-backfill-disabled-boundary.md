# G32L-BND2: historical Hub fulfilled backfill disabled-boundary diagnostic

## Scope

Adds an admin-only diagnostic panel to `/admin/sync-health` for the G32L historical Hub order 1052 native ShopifyOrder mirror backfill command.

The diagnostic calls `backfillHistoricalHubFulfilledNativeShopifyOrderForCustomerApp` through the existing authenticated frontend Base44 function invocation path while gates remain closed. It is intended to verify the disabled/kill-switch boundary before any separate G32M live backfill approval.

## Safety contract

The panel does not:

- open gates
- change secrets
- create native ShopifyOrder
- create Customer App Order
- create native FulfillmentTask
- mutate Hub records
- create notification or message log rows
- call Stripe, Shopify, providers, sync, repair, or replay
- write proof/drop/route fields
- inspect cookies, localStorage, sessionStorage, auth tokens, headers, or secrets
- display raw request/response payloads

The panel displays only:

- HTTP/function status
- success
- skipped
- error_code
- writes_performed
- generated request id

## Fixed request body

The UI uses a fixed diagnostic body for Hub order 1052:

- `mode: live`
- `hub_order_number: 1052`
- `correction_mode: HISTORICAL_HUB_FULFILLED_BACKFILL_NO_NOTIFICATION`
- `notification_policy: NO_NOTIFICATION`
- `proof_drop_policy: HELD_NOT_REQUIRED_FOR_RECONCILIATION`
- `customer_app_order_backfill: HELD`
- `native_fulfillment_task_backfill: HELD`
- `request_id: g32l_bnd2_disabled_historical_backfill_1052_<timestamp>`
- `confirmation: backfill_historical_hub_fulfilled_native_shopify_order_no_notification`

## Expected result

With gates closed, the expected result is:

- status `409`
- `error_code` of `historical_hub_fulfilled_native_shopify_order_backfill_disabled` or `kill_switch_active`
- `writes_performed:false`

G32M remains held until that disabled-gate result is observed and no-write verification confirms no records/logs/mutations.
