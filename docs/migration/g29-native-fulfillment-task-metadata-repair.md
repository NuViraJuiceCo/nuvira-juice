# G29 Native FulfillmentTask metadata repair

## Purpose

G29 adds an exact-gated repair path for existing native `FulfillmentTask` records that were created before G26D and may be missing admin-display metadata.

This closes the remaining visibility gap where `/admin/orders` can show a native task but still warn that metadata is incomplete.

## Scope

G29 is not a broad backfill and does not run automatically.

It adds:

- `previewNativeFulfillmentTaskMetadataRepair`
  - admin or internal-preview-secret access
  - `dry_run` only
  - exact task/order lookup only
  - returns a sanitized patch preview and blocker/warning list
- `executeNativeFulfillmentTaskMetadataRepair`
  - admin-only live execution
  - exact confirmation phrase required
  - default-off env gates required
  - exact order/task allowlist required
  - actor email allowlist required
  - fail-closed approved-field whitelist required
  - idempotent `CommandLog` guard
  - updates only the existing native `FulfillmentTask`

## Metadata repaired

When source data exists and the target task field is missing, the repair can fill
only approved operational display/linkage metadata:

- order linkage: `base44_order_id`, `shopify_order_id`, `native_shopify_order_id`
- order numbers: `shopify_order_number`, `order_number`
- source markers: `source_channel`, `source_type`, `task_source`, `created_from_native_ops`
- schedule/display fields: `scheduled_date`, `assigned_delivery_date`, `production_date`, `time_window`, `delivery_window_label`, `schedule_source`
- safe item/total/address summaries: `items_summary`, `line_item_count`, `total_price`, `address_complete`, approved address display fields
- safe operational projections when missing: `production_status`, `payment_status`, `sync_status`

Existing non-empty fields are preserved. Identity/link conflicts block the repair instead of being overwritten.

The preview and executor intentionally exclude:

- `customer_name`
- `customer_phone`
- customer email
- delivery lifecycle status fields such as `delivery_status`
- raw item arrays
- task `status`
- payment/provider ids
- route/proof/drop/delivery execution fields
- any unrecognized patch field

If derived source metadata contains unapproved fields, preview excludes them and
reports `excluded_unapproved_repair_fields`. The executor enforces the same
whitelist immediately before update and returns
`repair_patch_contains_unapproved_fields` if any unsupported field ever reaches
the live write plan.

## Live execution gates

`executeNativeFulfillmentTaskMetadataRepair` requires all of the following:

- `mode: "live"`
- `confirmation: "execute_native_fulfillment_task_metadata_repair"`
- admin auth
- `ENABLE_NATIVE_FULFILLMENT_TASK_METADATA_REPAIR_WRITES=true`
- `NATIVE_FULFILLMENT_TASK_METADATA_REPAIR_KILL_SWITCH=false`
- `NATIVE_FULFILLMENT_TASK_METADATA_REPAIR_ALLOWED_EMAILS` includes the admin actor email
- `NATIVE_FULFILLMENT_TASK_METADATA_REPAIR_ORDER_ALLOWLIST` includes the exact task/order identifier
- non-empty `request_id`

The gate is exact-order/task only. Broad mode is not valid for this migration phase.

## Safety boundary

G29 does not:

- mutate Customer App `Order`
- mutate native `ShopifyOrder`
- create a new `FulfillmentTask`
- backfill tasks automatically
- run `processMay30NativeOrderOps`
- run native safeSync order writer
- call Stripe, Shopify, providers, Hub APIs, or notification services
- run sync, retry, repair, replay, refund, production, inventory, PO, route, proof/drop, or delivery commands
- disable Hub bridge fallback

The live executor writes only:

- the exact existing `FulfillmentTask` metadata patch
- a bounded `CommandLog` audit record for the approved repair

## Local regression harness

`node scripts/migration/run-g29-native-task-metadata-repair-tests.mjs`

The harness verifies:

- exact lookup normalization
- preview admin/internal auth
- missing display metadata detection
- patch generation for an incomplete native task
- whitelist enforcement and excluded customer fields
- no-op behavior for complete tasks
- conflict blockers for wrong task/order linkage
- subscription/POS blockers
- default-off and exact allowlist gate behavior

## Recommended use

Use the preview first for a known incomplete task, such as the recovered `NV-MPZNKGNT` native task. Execute only after an explicit exact-task/order approval phrase and with gates opened for that one task/order, then close gates immediately after execution.
