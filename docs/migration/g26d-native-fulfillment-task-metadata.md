# G26D Native FulfillmentTask metadata completeness

## Scope

G26D improves future native `FulfillmentTask` drafts and creates so Customer App admin pages can display native task context without depending on Hub rows for basic operational metadata.

This is a future-write metadata patch only. It does not backfill existing native tasks.

## Creation paths covered

- `processMay30NativeOrderOps`
  - creates a native delivery `FulfillmentTask` for eligible paid Customer App delivery orders when its gated live path is explicitly enabled and authorized
  - now includes display-critical order linkage, source, schedule, line-item count, total, address completeness, and native source markers on new task drafts
  - dedupes existing tasks without rewriting them, so old tasks are not backfilled by this patch
- `previewNativeFulfillmentTaskMaterialization`
  - dry-run preview only; no writes
  - now previews the same display-critical task metadata
- `executeNativeFulfillmentTaskMaterialization`
  - exact-order gated execution path for approved native task materialization
  - newly created tasks now carry the same display-critical metadata

## Future task metadata

Future native tasks include the schema-supported metadata below when source data exists:

- native order id and Customer App order linkage: `order_id`, `shopify_order_id`, `native_shopify_order_id`, `base44_order_id`
- order number fields: `shopify_order_number`, `order_number`
- customer/admin context: `customer_name`, `customer_email`, `customer_phone`
- source and task markers: `source_channel`, `source_type`, `task_source`, `created_from_native_ops`, `order_type`, `schedule_source`, `sync_status`
- schedule fields: `delivery_date`, `scheduled_date`, `assigned_delivery_date`, `production_date`, `time_window`, `delivery_window_label`
- safe item summary: `items`, `items_summary`, `line_item_count`, `total_price`
- safe routing/display fields: `address`, structured address fields, `address_complete`, `delivery_zone_key`

## Local regression harness

`node scripts/migration/run-g26d-native-task-metadata-tests.mjs` exercises synthetic, in-memory drafts only:

- paid Customer App delivery order produces a task draft with complete admin-display metadata
- POS orders do not create delivery tasks
- missing delivery date skips task creation
- existing tasks are deduped without update/backfill calls
- preview and exact-gated execute drafts include the same linkage and schedule metadata

## Safety boundary

This patch does not:

- mutate existing `FulfillmentTask` records
- backfill old task metadata
- run `processMay30NativeOrderOps`
- run native safeSync writer on real orders
- call Stripe, Shopify, providers, or notification services
- run sync, retry, repair, replay, refund, production, inventory, PO, route, proof, drop, or delivery commands
- change checkout/payment behavior
- disable Hub bridge fallback

## Admin impact

`/admin/orders` already reads native task order number, source type, schedule source, and production date. New tasks created after G26D should no longer trigger the incomplete display metadata warning when those source fields exist.

Existing tasks, including historical recovered tasks, remain unchanged and may still show the warning until explicitly handled in a separately approved backfill or repair phase.
