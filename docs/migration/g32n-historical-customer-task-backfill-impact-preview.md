# G32N: Historical Customer App Order / FulfillmentTask backfill impact preview

## Scope

G32N adds `previewHistoricalCustomerOrderFulfillmentBackfillImpact`, a read-only impact preview for Hub order `1052` after G32M created the native ShopifyOrder historical fulfilled mirror.

This phase does not create Customer App Order records, native FulfillmentTask records, notifications, message logs, proof/drop/route fields, Hub records, ProductionBatch, BatchComplianceLog, inventory, PurchaseOrder, sync, repair, or replay actions.

## Target

- Hub order number: `1052`
- Native ShopifyOrder mirror id: `6a2848655450ef3556960d99`
- Existing native mirror source: `hub_historical_backfill`
- Existing native mirror statuses: `production_status: fulfilled`, `fulfillment_status: fulfilled`

## Required request contract

- `mode: dry_run`
- `hub_order_number: 1052`
- `native_shopify_order_id: 6a2848655450ef3556960d99`
- `preview_mode: HISTORICAL_CUSTOMER_ORDER_FULFILLMENT_BACKFILL_IMPACT`
- `notification_policy: NO_NOTIFICATION`
- `customer_app_order_backfill: PREVIEW_ONLY`
- `native_fulfillment_task_backfill: PREVIEW_ONLY`
- `proof_drop_policy: HELD_NOT_REQUIRED_FOR_RECONCILIATION`

Authentication is admin or internal service-secret only. Unauthenticated requests return `401`; non-POST requests return `405`.

## Preview decisions

The preview evaluates whether additional backfill is necessary or useful now that the native ShopifyOrder mirror exists.

Expected G32N classification for order `1052`:

- Native ShopifyOrder mirror is present.
- Customer App Order remains missing and held.
- Native FulfillmentTask remains missing and held.
- Notifications remain held.
- Proof/drop remains held.
- Hub mutation is not proposed.
- No writes are performed.

## Customer App Order impact

Creating a Customer App Order is not recommended by this preview because the `Order` entity is customer-scoped by `customer_email` access filters. A live Customer App Order backfill could expose historical order `1052` in the customer account/order history and could affect customer-facing order history, loyalty/rewards, totals, or analytics. Any live Customer App Order backfill requires separate explicit approval and a dedicated contract.

## Native FulfillmentTask impact

Creating a native FulfillmentTask is not recommended by this preview because Hub task rows remain absent for order `1052`. A reconstructed delivered historical task could create delivery/admin queue artifacts or imply proof/drop/route work unless a dedicated delivered-task backfill contract defines hidden/historical behavior.

## UI

`/admin/sync-health` includes a read-only panel titled `Historical Customer / Task Backfill Impact Preview`.

The panel shows:

- Hub order `1052`
- native ShopifyOrder mirror presence
- Customer App Order missing/held
- native FulfillmentTask missing/held
- customer-facing risk
- delivery queue impact
- notifications held
- proof/drop held
- No Writes Performed

It does not expose any live backfill, notification, delivered, sync, repair, or proof/drop/route controls.

## Next step

If the preview confirms the native ShopifyOrder mirror is sufficient for admin historical context, hold additional backfill for order `1052`. If the business wants customer-visible history or a native delivered task record, plan a separate default-off gated command with explicit live approval.
