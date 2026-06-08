# G32B: Native ShopifyOrder bottle audit and preview cleanup

## Scope

Read-only cleanup after the exact G32A native ShopifyOrder bottle/pack execution for `NV-MPZNKGNT`.

This phase does not rerun the bottle command, reopen gates, mutate records, call providers/payments, send notifications, run sync/repair/replay, deduct inventory, create purchase orders, or change customer-facing status.

## Root cause: CommandLog `writes_performed` inconsistency

The G32A live command response correctly returned `writes_performed: true` and the native ShopifyOrder was updated from `awaiting_production` to `bottled`.

The embedded success `CommandLog.result` incorrectly retained `writes_performed: false` because the result object set `writes_performed: true` and then spread the generic `safetyResult(...)` object afterward. `safetyResult(...)` defaults `writes_performed` to `false`, so the later spread overwrote the true success value.

## Patch behavior

Future successful native ShopifyOrder bottle command executions now use an explicit write-safety helper so:

- top-level response `writes_performed` remains `true` after a write;
- `CommandLog.result.writes_performed` remains `true` after a write;
- nested `safety.writes_performed` is `true` when the command actually updates the native ShopifyOrder;
- idempotent duplicate calls still return `writes_performed: false`, `skipped: true`, and reuse the existing success log;
- disabled or kill-switch boundary responses remain `writes_performed: false` and do not create success logs.

Historical G32A `CommandLog` records are not backfilled or edited by this patch.

## Already-bottled preview/UI cleanup

`previewNativeProductionVerifyCascades` now treats a native ShopifyOrder with `production_status: bottled` as already satisfied rather than ready for another bottle command.

Expected already-bottled preview fields:

- `shopify_order_bottle_ready: false`
- `shopify_order_bottle_already_satisfied: true`
- `post_verify_native_cascades_already_satisfied: true` when the task is also already packed
- `would_update_native_shopify_order: false`
- `bottle_command_available: false`
- `next_action: post_verify_cascades_already_satisfied_customer_status_held`

The SyncHealth post-verify cascade panel now shows bottled/deduped copy instead of stale “Order Bottle Ready” / “Plan Gated Native Shopify Order Bottle Command” wording.

## Preserved behavior

Eligible unbottled one-time orders still preview as bottle-ready when:

- all related ProductionBatch rows are `verified_logged`;
- required BatchComplianceLog rows exist;
- the exact FulfillmentTask is packed;
- the native ShopifyOrder is present and eligible;
- customer-facing status and notifications remain held.

Subscription, multi-delivery, cancelled, and refunded blockers remain unchanged.
