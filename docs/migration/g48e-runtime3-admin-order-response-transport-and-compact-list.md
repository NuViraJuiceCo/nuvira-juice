# G48E-RUNTIME3 — Admin Order Response Transport and Compact List Contract

## 1. RUNTIME2 result

G48E-RUNTIME2 deployed and verified the compact lifecycle capability/read-model response for `getAdminOrdersWithHub`.

Current backend lifecycle state:

```text
response_contract=g48e_compact_read_model_v1
compact_response_size_bytes=1024
json_parse_success=true
orders_key_present=false
admin_order_lifecycle_read_model_enabled=false
writes_performed=false
```

AdminOrders UI stayed unpublished because the ordinary no-mode legacy admin-order response was still observed as unparseable through the SDK inspection path.

## 2. Exact 66130-byte observation

The RUNTIME2 closeout observed the legacy no-mode response through `base44.functions.invoke` as:

```text
http_status=200
raw_size_bytes=66130
json_parse_success=false
parse_error=Unterminated string in JSON at position 66130
```

That evidence was not enough to prove server-side truncation because terminal/SDK inspection can truncate independently of the function response body.

## 3. Transport-layer comparison

RUNTIME3 used the same authenticated admin request and compared full-body behavior without printing order rows.

Safe live evidence:

```text
official_endpoint_http_status=200
official_endpoint_bytes_received=88414
official_endpoint_json_parse_success=true
official_endpoint_final_json_delimiter_present=true
official_endpoint_response_ended_mid_string=false

sdk_http_status=200
sdk_bytes_received=65852
sdk_json_parse_success=false
sdk_response_ended_mid_string=true
sdk_parse_error_category=Unterminated string in JSON

custom_domain_unauthenticated_status=401
custom_domain_unauthenticated_json_parse_success=true
browser_sdk_json_parse_success=unavailable
```

The official direct function fetch received a larger, complete, parseable body. The SDK `invoke` adapter received a truncated body ending mid-string.

## 4. Root-cause classification

Primary transport classification:

```text
admin_order_legacy_response_sdk_adapter_truncated
```

This is not a proven server-side response truncation. It is also not safe to publish AdminOrders against the legacy SDK invocation because the page uses `base44.functions.invoke`.

## 5. Backend change required

Because the production AdminOrders source uses SDK invocation, a backend-compatible compact list response is required before UI publish.

The legacy no-mode response remains unchanged. The compact list is additive and explicit.

## 6. Compact admin-order list contract

New request mode:

```text
response_mode=ADMIN_ORDER_LIST_COMPACT
```

Contract version:

```text
g48e_admin_order_list_compact_v1
```

Top-level response fields:

```text
success
response_mode
response_contract
orders
order_count
total
source_counts
source_truncated
source_truncated_by_entity
fallback_active
duplicate_order_number_count
warnings
local_count
hub_count
native_shopify_order_count
writes_performed:false
provider_call_impact:false
stripe_calls:false
shopify_calls:false
hub_calls:false
notifications_sent:false
repair_replay_performed:false
hub_write_suppression_ready:false
raw_payloads_returned:false
pii_returned:false
```

The compact list uses the same existing merge path as the legacy response and then maps rows to a bounded allowlisted shape. It does not modify the no-mode legacy payload.

## 7. Required AdminOrders fields

The compact row includes fields demonstrated as required by the current AdminOrders rendering, filtering, sorting, details panels, and action identifiers:

```text
id
order_number
created_date
status
payment_status
financial_status
payment_captured
fulfillment_type
estimated_delivery_date
assigned_delivery_date
delivery_window_label
total
order_type
source_type
source_channel
customer_email
customer_name
contact_phone
delivery_address
items
notes
is_test_order
do_not_recover
is_abandoned_checkout
is_hub_order
is_native_order
has_customer_app_order
has_native_order
has_native_task
customer_app_order_id
customer_app_order_status
customer_app_payment_status
customer_app_payment_captured
customer_app_line_item_count
native_shopify_order_id
native payment/production/fulfillment/sync/review/source summary fields
native_fulfillment_task_summary
native_latest_sync_log
native_review_queue_summary
hub_order_id
hub_operational_status
hub_fulfillment_status
hub_fulfillment_number
hub_updated_date
hub_sync_summary
production_date
delivered_at
delivered_by
delivery_drop_location
delivery_photo_url
approval_status
sync_status
admin_context_badges
admin_context_guidance
```

No PII expansion is introduced: these are fields already consumed by the admin-only AdminOrders surface. The compact mapper does not add new customer profile joins or raw source payloads.

## 8. Action-reference compatibility

Current AdminOrders actions and detail lookups require stable row identifiers:

- status workflow controls remain frozen and perform no writes;
- Hub note composer uses `hub_order_id` or `order_number`;
- Hub fulfillment task and timeline panels use `hub_order_id`, `order_number`, `hub_fulfillment_number`, and row `id` where available;
- native panels use existing native mirror/task summary references only for display.

The compact list preserves those safe action/display references. It does not weaken action identity and does not enable any new action.

## 9. Hub-only and fallback preservation

The compact response is built from the same merged order list as the legacy response. That preserves:

- Hub-only valid rows;
- native-only rows;
- Customer App rows;
- Hub fallback indicators;
- refund/cancel status visibility;
- subscription/multi-delivery markers;
- historical chronology from the merged row ordering.

Held rows are not promoted to native-ready by this phase.

## 10. Response-size evidence

Harness coverage proves:

```text
compact_response_parseable=true
compact_response_contains_raw_legacy_payload=false
compact_response_contains_required_action_refs=true
compact_response_smaller_than_legacy_fixture=true
```

The compact response excludes raw legacy source sections, duplicated native/Hub rows, raw provider payloads, and large nested debug structures.

No Base44 platform response-size limit is claimed.

## 11. UI publish decision

AdminOrders UI should remain held until this PR is merged, `getAdminOrdersWithHub` is published, and the following are verified live:

```text
compact_list_contract_present=true
compact_list_sdk_json_parse_success=true
compact_known_controls_present=true
compact_duplicate_order_numbers=0
compact_lifecycle_contract_present=true
compact_lifecycle_enabled=false
no_write_verification_passed=true
```

Only after that should the Web/admin UI be published from clean source.

## 12. No-write verification policy

This phase does not:

- activate G48E;
- publish AdminOrders UI during PR prep;
- mutate Order, ShopifyOrder, or FulfillmentTask;
- change admin order actions;
- suppress Hub reads or writes;
- run sync/retry/repair/replay;
- call Stripe, Shopify, or delivery providers;
- send notifications;
- change schemas/entities;
- modify Apple Pay PR #545.

## 13. Test coverage

Added:

```text
scripts/migration/run-g48e-runtime3-admin-order-response-transport-tests.mjs
```

Coverage includes:

- direct full-body temp-file analysis;
- terminal-output truncation not treated as server truncation;
- server, SDK-only, and custom-domain truncation classification;
- legacy response unchanged;
- compact list parseability;
- raw legacy payload exclusion;
- required display fields and action references;
- Hub-only, refund/cancel, subscription/multi-delivery, chronology, known controls, duplicates, source truncation;
- lifecycle compact response separation;
- G48E disabled state;
- AdminOrders compact consumption guard;
- no writes, providers, notifications, repair/replay, logs/queues, or raw payload expansion.

## 14. Final classification

```text
admin_order_compact_list_contract_pr_ready
```
