# G33C-TASK2: One-time FulfillmentTask mirror command

## Executive summary

G33C-TASK2 adds PR-prep for a default-off gated command that can later create exactly one native `FulfillmentTask` mirror for the recovered one-time order `NV-MP5SOQLJ`.

This phase does **not** run the command, does **not** open gates, and does **not** deploy the new function. Hub remains active.

Target context:

| Field | Value |
| --- | --- |
| `order_number` | `NV-MP5SOQLJ` |
| `customer_app_order_id` | `6a060df457fc07751f3c7ded` |
| `native_shopify_order_id` | `6a2df0026e266e19c68046eb` |
| fulfillment type | `delivery` |
| delivery date | `2026-05-16` |
| production date | `2026-05-16` |
| line item count | `3` |
| payment status | `paid` |
| current Customer App status | `bottled_packed` |
| native task status target | `bottled_packed` |

## Command contract

Function source added for later deployment:

```text
createNativeOneTimeFulfillmentTaskMirrorForCustomerApp
```

Required confirmation phrase:

```text
create_native_one_time_fulfillment_task_mirror_no_notification
```

Required policy:

```text
EXACT_ONE_TIME_FULFILLMENT_TASK_MIRROR_ONLY_NO_NOTIFICATION
```

Required input contract:

```text
order_number=NV-MP5SOQLJ
customer_app_order_id=6a060df457fc07751f3c7ded
native_shopify_order_id=6a2df0026e266e19c68046eb
task_creation_policy=EXACT_NATIVE_SHOPIFY_ORDER_LINK_ONLY
notification_policy=NO_NOTIFICATION
provider_call_policy=NO_PROVIDER_CALLS
hub_mutation_policy=NO_HUB_MUTATION
request_id=<unique request id>
confirmation=create_native_one_time_fulfillment_task_mirror_no_notification
```

Allowed future writes, only after a separate publish/boundary phase and separate live approval:

1. One native `FulfillmentTask`.
2. One safe `CommandLog`.

No other writes are allowed.

## Gates

The command is default-off and must fail closed unless all exact gates pass:

```text
ENABLE_NATIVE_ONE_TIME_FULFILLMENT_TASK_MIRROR
NATIVE_ONE_TIME_FULFILLMENT_TASK_MIRROR_KILL_SWITCH
NATIVE_ONE_TIME_FULFILLMENT_TASK_MIRROR_ALLOWED_EMAILS
NATIVE_ONE_TIME_FULFILLMENT_TASK_MIRROR_ORDER_ALLOWLIST
NATIVE_ONE_TIME_FULFILLMENT_TASK_MIRROR_CUSTOMER_ORDER_ALLOWLIST
NATIVE_ONE_TIME_FULFILLMENT_TASK_MIRROR_SHOPIFY_ORDER_ALLOWLIST
NATIVE_ONE_TIME_FULFILLMENT_TASK_MIRROR_POLICY
```

Rules:

- Admin auth is required.
- Actor email must be allowlisted server-side.
- Order allowlist must match only `NV-MP5SOQLJ` or `#NV-MP5SOQLJ`.
- Customer App order allowlist must match only `6a060df457fc07751f3c7ded`.
- Native ShopifyOrder allowlist must match only `6a2df0026e266e19c68046eb`.
- Kill switch wins over all other gates.
- Browser-supplied actor identity is never trusted.

## Fresh G33C-TASK1 preview requirement

Before any future write, the command must invoke `previewNativeOrderCutoverReadiness` through the Base44 function SDK, not through public HTTP self-fetch.

Required preview input:

```text
preview_mode=ONE_TIME_NATIVE_FULFILLMENT_TASK_MIRROR_PACKET
order_number=NV-MP5SOQLJ
customer_app_order_id=6a060df457fc07751f3c7ded
native_shopify_order_id=6a2df0026e266e19c68046eb
task_creation_policy=HELD_UNTIL_NATIVE_SHOPIFY_ORDER_EXISTS
notification_policy=NO_NOTIFICATION
provider_call_policy=NO_PROVIDER_CALLS
hub_mutation_policy=NO_HUB_MUTATION
```

Required preview evidence:

- `success:true`
- `dry_run:true`
- `writes_performed:false`
- `task_packet_ready:true`
- `native_shopify_order_present:true`
- `native_fulfillment_task_present:false`
- `duplicate_task_risk:false`
- `blockers:[]`
- payment status `paid`
- fulfillment type `delivery`
- delivery date present
- production date present
- line item count `3`
- provider call impact `false`
- notifications held
- Hub mutation `false`

If any of the above changes, the command must fail closed with `writes_performed:false`.

## FulfillmentTask schema audit

`base44/entities/FulfillmentTask.jsonc` supports the required native task mirror fields, including:

- `order_id`
- `base44_order_id`
- `shopify_order_id`
- `native_shopify_order_id`
- `shopify_order_number`
- `order_number`
- `customer_email`
- `source_channel`
- `source_type`
- `task_source`
- `created_from_native_ops`
- `order_type`
- `fulfillment_type`
- `fulfillment_number`
- `delivery_date`
- `scheduled_date`
- `assigned_delivery_date`
- `production_date`
- `time_window`
- `delivery_window_label`
- address fields
- `items`
- `items_summary`
- `line_item_count`
- `total_price`
- `address_complete`
- `status`
- `delivery_status`
- `production_status`
- `payment_status`
- `sync_status`
- `schedule_source`
- `internal_notes`
- `review_status`
- `review_reason`
- `audit_trail`
- `notes`

Required fields are:

```text
order_id
customer_email
fulfillment_number
delivery_date
```

The status value `bottled_packed` is schema-supported for `FulfillmentTask.status`.

## customer_email internal hydration policy

`customer_email` is required by the `FulfillmentTask` schema. G33C-TASK1 intentionally did not return it in preview output.

G33C-TASK2 therefore hydrates `customer_email` internally from the exact server-side Customer App `Order` row. It must not expose the value in:

- command response
- `CommandLog.payload`
- `CommandLog.result`
- docs
- admin UI
- test output

If the email cannot be hydrated or is not a valid email shape, the command must fail closed with:

```text
schema_contract_blocker
customer_email_required_for_fulfillment_task_missing
```

## Native FulfillmentTask create packet

The future write packet is built from G33C-TASK1 and internal safe reads.

Expected safe fields:

```text
order_id=6a060df457fc07751f3c7ded
base44_order_id=6a060df457fc07751f3c7ded
shopify_order_id=6a2df0026e266e19c68046eb
native_shopify_order_id=6a2df0026e266e19c68046eb
shopify_order_number=#NV-MP5SOQLJ
order_number=NV-MP5SOQLJ
source_channel=online
source_type=customer_app_one_time_native_mirror
task_source=native_one_time_fulfillment_task_mirror
created_from_native_ops=true
order_type=one_time
fulfillment_type=delivery
fulfillment_number=1
delivery_date=2026-05-16
scheduled_date=2026-05-16
assigned_delivery_date=2026-05-16
production_date=2026-05-16
line_item_count=3
status=bottled_packed
delivery_status=pending
production_status=bottled
payment_status=paid
sync_status=native_one_time_fulfillment_task_mirror_g33c_task2
schedule_source=customer_app_order
```

Address fields may be hydrated internally for operational delivery use if present and schema-safe. They must not be echoed in command response or logs.

## Explicitly omitted fields

The command must not write or log:

- raw Customer App order payload
- raw Hub payload
- raw Shopify payload
- raw Stripe/payment payload
- provider payloads
- notification payloads
- proof/drop/route payloads
- unsupported top-level metadata

The command response must not expose:

- customer email
- customer phone
- full address
- raw payloads
- secrets/auth values
- provider/payment payloads

## No-notification policy

The command requires:

```text
notification_policy=NO_NOTIFICATION
```

It does not send notifications and does not create `Notification` or `CustomerMessageDeliveryLog` rows.

## No-provider-call policy

The command requires:

```text
provider_call_policy=NO_PROVIDER_CALLS
```

It does not call Stripe, Shopify, Hub providers, or payment APIs.

## No-Hub-mutation policy

The command requires:

```text
hub_mutation_policy=NO_HUB_MUTATION
```

Hub remains active. The command does not mutate Hub records and does not disable Hub bridge/fallback behavior.

## No Customer App Order / native ShopifyOrder update policy

The command must not update:

- Customer App `Order`
- native `ShopifyOrder`

Those rows are read-only inputs for this phase.

## Idempotency

The command requires a unique `request_id`.

Idempotency rules:

- A matching successful `CommandLog` returns skipped/idempotent success.
- An existing FulfillmentTask created by the same request returns skipped/idempotent success.
- A failed prior log is not treated as success.
- If a FulfillmentTask exists from another source/request, the command returns a safe conflict and creates no duplicate.

## Function-count / deploy constraint

Base44 has already hit the app function-count limit. This PR adds command source and tests only.

A future closeout/publish phase must choose one of these strategies:

1. Deploy the new standalone function only if a function slot is available.
2. Request separate function-slot/decommission approval before deploy.
3. Stop before publish if no slot is available.

Do not overload an unrelated live function without a separate design approval.

## Live execution requirement

Merging this PR does not approve live execution.

A future live attempt requires:

- function deployed and live source verified
- GET boundary returns `405`
- unauthenticated POST returns `401`
- admin-auth gates-closed call returns `409`, `writes_performed:false`
- fresh G33C-TASK1 preview is clean
- separate exact owner approval
- gates opened only for this order/customer/native-order/actor/policy
- immediate gate shutdown after execution/idempotency verification

## Hub policy

Hub remains active and remains fallback/source-of-truth for unsupported paths. This command is a narrow native mirror recovery command only.
