# G48E-RUNTIME1 — deployed admin-order response contract investigation

## 1. PR #557 merge/publish result

G48E PR #557 merged with commit:

```text
82d9bf1ceb7e980d78f928728fafbf83eabbd351
```

Only `getAdminOrdersWithHub` was published during G48E closeout. `AdminOrders.jsx` was not published because the live backend disabled capability contract was not observable.

Current refined classification:

```text
admin_order_lifecycle_read_model_runtime_contract_unobservable_after_deploy
```

This is not classified as a missing helper deployment failure: a deployed source pull contains both `entry.ts` and the function-local `adminOrderLifecycleReadModel.js` helper with G48E markers.

## 2. Source/runtime divergence

Pulled deployed source contains:

- `entry.ts`
- `adminOrderLifecycleReadModel.js`
- function-local import: `./adminOrderLifecycleReadModel.js`
- capability markers:
  - `admin_order_lifecycle_read_model_available`
  - `admin_order_lifecycle_read_model_enabled`
  - `admin_order_lifecycle_read_model_version`
- version marker:
  - `g48e_admin_order_lifecycle_v1`

Authenticated runtime response still succeeded through the existing admin-order path, but the response did not expose:

- `admin_order_lifecycle_read_model_available`
- `admin_order_lifecycle_read_model_enabled`
- `admin_order_lifecycle_read_model_version`

This means the existing page path appears stable, but the additive disabled capability contract is not decision-grade yet.

## 3. Exact invocation contracts

The merged source parses the request body as direct JSON:

```text
body = await req.json()
```

Expected field/value:

```text
read_model_mode=ADMIN_ORDER_LIFECYCLE
```

Observed request-shape evidence:

```text
harness_request_shape=direct_json_body
frontend_request_shape=direct_json_body
base44_sdk_request_shape=direct_json_body
direct_http_request_shape=direct_json_body
live_request_shape_used=direct_json_body
request_shape_match=true
```

The Base44 SDK invocation config used:

```text
method=post
url=/apps/<same-app>/functions/getAdminOrdersWithHub
body={"request_id":"...","read_model_mode":"ADMIN_ORDER_LIFECYCLE"}
```

No alternate nested `data` or `payload` request shape was required for the observed SDK path.

## 4. Response-path trace

`entry.ts` response paths:

| Path | Condition | Metadata attached |
| --- | --- | --- |
| auth failure | missing auth | no, returns 401 and no order data |
| role failure | non-admin | no, returns 403 and no order data |
| final success | existing admin-order path | yes in merged source |
| catch error | thrown exception | no, returns 500 error only |

The final success source path attaches the G48E metadata regardless of whether the model is enabled. Therefore, a successful runtime response with no metadata indicates one of:

```text
runtime_contract_blocked_by_stale_endpoint
runtime_contract_blocked_by_wrong_app_target
runtime_contract_blocked_by_response_serializer
runtime_contract_root_cause_unresolved
```

Based on current evidence, request-shape mismatch and mode-validation mismatch are unlikely.

## 5. Endpoint/app-target comparison

Safe target comparison evidence:

```text
cli_project_matches_source_pull=true
source_pull_matches_test_endpoint=unknown
test_endpoint_matches_production_app=unknown
custom_domain_matches_base44_app=unknown
base44_endpoint_metadata_present=false
custom_endpoint_metadata_present=false
sdk_invocation_metadata_present=false
response_key_sets_match=unknown
```

Notes:

- Local CLI app metadata and frontend default app id point to the same known app.
- Unauthenticated Base44 and custom-domain function endpoints returned 401 with no order data.
- Authenticated SDK invocation used the expected app/function URL but still did not surface G48E metadata.
- A direct authenticated custom-domain comparison was not completed because no raw auth token/cookie should be exposed in docs or scripts.

## 6. Root cause

Current root cause remains unresolved at source-only level:

```text
runtime_contract_root_cause_unresolved
```

The most useful next proof is whether a newly added, static, admin-only diagnostic response appears after a scoped `getAdminOrdersWithHub` redeploy. If it appears, the runtime is executing current source and the issue is likely on the legacy success response path or serializer. If it does not appear, the issue is likely stale endpoint, wrong app target, or Base44 runtime propagation.

## 7. Narrow correction

This PR adds a diagnostic mode only:

```text
diagnostic_mode=G48E_RUNTIME_CONTRACT
```

The diagnostic mode runs after existing admin authorization and before entity reads. It returns only static booleans and safe enums:

- `success:true`
- `dry_run:true`
- `writes_performed:false`
- `g48e_source_marker_present:true`
- `request_body_parsed:true`
- `read_model_mode_received`
- `read_model_mode_value_match`
- `legacy_path_selected:false`
- `capability_metadata_constructed:true`
- `capability_metadata_attached:true`
- `response_contract_version:g48e_runtime_contract_v1`

The diagnostic does not return orders, customer data, record ids, raw payloads, environment values, secret names, or secret values.

## 8. Redeploy result

No redeploy is performed in PR prep.

Post-merge plan:

1. Publish only `getAdminOrdersWithHub`.
2. Keep G48E disabled.
3. Invoke:

```json
{
  "diagnostic_mode": "G48E_RUNTIME_CONTRACT",
  "read_model_mode": "ADMIN_ORDER_LIFECYCLE",
  "request_id": "g48e_runtime1_contract_<timestamp>"
}
```

Expected diagnostic response:

```text
success=true
dry_run=true
writes_performed=false
g48e_source_marker_present=true
read_model_mode_received=true
read_model_mode_value_match=true
capability_metadata_attached=true
response_contract_version=g48e_runtime_contract_v1
```

Then rerun the explicit disabled request and require:

```text
admin_order_lifecycle_read_model_available=true
admin_order_lifecycle_read_model_enabled=false
admin_order_lifecycle_read_model_version=g48e_admin_order_lifecycle_v1
read_model_payload_absent=true
```

## 9. UI publish remains held

`AdminOrders.jsx` remains unpublished for G48E until the live backend disabled capability contract is observable.

Do not publish the admin UI, use Builder Fix All, or activate G48E in this phase.

## 10. No-write verification

Runtime1 diagnostic design is read-only:

```text
writes_performed=false
provider_call_impact=false
hub_mutation_performed=false
notifications_sent=false
raw_payloads_returned=false
pii_returned=false
```

Diagnostic mode is designed to perform no entity reads where avoidable and no entity writes.

G48E closeout no-write verification before Runtime1 found zero exact request-id matches and zero recent mutations for:

- `Order`
- `ShopifyOrder`
- `FulfillmentTask`
- `OrderSyncLog`
- `CommandLog`
- `OrderReviewQueue`
- `SafeSyncParityLog`
- `Notification`
- `CustomerMessageDeliveryLog`
- `OperationalAlert`
- `ComplianceAlert`
- `PurchaseOrder`

The extended refund/payment/subscription probe was stopped on rate limiting and should not be repeatedly retried.

## 11. Final classification

PR-prep classification:

```text
admin_order_lifecycle_runtime_contract_fix_pr_ready
```

Post-merge classifications should be selected from:

```text
admin_order_lifecycle_read_model_backend_authoritative_deployed_disabled
admin_order_lifecycle_runtime_target_mismatch_resolved
admin_order_lifecycle_runtime_contract_fix_pr_ready
admin_order_lifecycle_runtime_contract_root_cause_unresolved
hard_stop_admin_order_lifecycle_runtime_investigation_side_effect
```

## Hard stops

- Do not activate G48E.
- Do not publish `AdminOrders.jsx` until backend metadata is observable.
- Do not mutate orders, native orders, tasks, payments, refunds, subscriptions, or delivery state.
- Do not call Stripe, Shopify, Hub, delivery providers, or notification providers.
- Do not run repair/replay.
- Do not suppress Hub writes.
- Do not modify PR #545.
