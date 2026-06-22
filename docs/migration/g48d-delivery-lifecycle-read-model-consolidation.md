# G48D — Delivery Lifecycle Read-Model Consolidation

## 1. Architecture context

G48A established that the migration should stop mirroring every Hub workflow one piece at a time when a clearer native operational backbone is safer. G48C applied that pattern to production/compliance reads: a function-local helper, backend-owned activation, default-off rollout, and no write-path expansion.

G48D applies the same pattern to admin delivery reads. It consolidates delivery identity and lifecycle interpretation without attempting the blocked delivery commands from G42B.

Current carry-forward states:

- G48C: `production_compliance_read_model_backend_authoritative_deployed_disabled`.
- G42B: `admin_delivery_action_readiness_no_clean_command_candidates`.
- Apple Pay production payments: `apple_pay_deferred_intent_backend_blocked_by_platform_atomicity`.
- Subscription customer reads remain blocked by missing live native occurrence chains.

## 2. G42A/G42B findings carried forward

G42A and G42B found that the admin delivery route summary is already the strongest delivery read surface: it reads native `FulfillmentTask` and native `ShopifyOrder` rows, reconciles Hub fallback rows, labels stale Hub context, and preserves valid Hub-only rows.

G42B also found no clean command candidates for driver assignment, route mutation, out-for-delivery, delivered, or provider-backed route optimization. Read readiness must therefore stay separate from action readiness.

## 3. Why `getAdminDeliveryRouteSummary` owns this read model

`getAdminDeliveryRouteSummary` is the correct backend owner because it already:

getAdminDeliveryRouteSummary owns the G48D canonical admin delivery lifecycle read model for this package.

- enforces admin authentication;
- owns the delivery-date route-summary request;
- reads native `FulfillmentTask` and `ShopifyOrder` rows;
- fetches Hub route fallback context when configured;
- reconciles native rows against Hub fallback rows;
- returns the payload consumed by `src/pages/admin/DeliveryQueue.jsx`.

The read model remains function-local because G48B-PACK1 showed shared function module packaging is unsupported. The helper is deployed with the owning function directory:

```text
base44/functions/getAdminDeliveryRouteSummary/
  entry.ts
  deliveryLifecycleReadModel.js
```

## 4. Current delivery page data paths

| Surface | Current source path | G48D behavior |
| --- | --- | --- |
| Admin Delivery Queue | `DeliveryQueue.jsx` → `getAdminDeliveryRouteSummary` | Requests additive backend metadata and uses the canonical payload only when backend-enabled and version-valid. |
| Route preview | `DeliveryQueue.jsx` → `optimizeDeliveryRoute` | Preserved. Preview-only route behavior is not changed. |
| Driver assignment controls | `updateAdminFulfillmentTaskAssignment` | Preserved. No payload or action behavior changed. |
| Out-for-delivery controls | `markAdminFulfillmentTaskOutForDelivery` | Preserved. No payload or action behavior changed. |
| Delivered controls | `recordAdminFulfillmentTaskDelivered` | Preserved. No payload or action behavior changed. |
| Native fulfillment preview/execution controls | `previewNativeFulfillmentTaskLifecycle` / `executeNativeFulfillmentTaskLifecycle` | Preserved. G48D does not expand command readiness. |
| Native schedule correction/materialization panels | Existing preview/execute functions | Preserved. G48D does not alter their gating or identifiers. |
| Operations dashboard delivery aggregates | Existing operations dashboard functions | Preserved; G48D only documents delivery lifecycle read context. |

## 5. Exact identity and linkage rules

The helper uses only exact identifiers from repository source and schemas.

Customer App `Order` to native `ShopifyOrder`:

- `base44_order_id`;
- `customer_app_order_id` if present on a row;
- normalized exact `order_number` / `shopify_order_number`.

Customer App `Order` / native `ShopifyOrder` to `FulfillmentTask`:

- `order_id`;
- `base44_order_id`;
- `customer_app_order_id` if present;
- `native_shopify_order_id`;
- `shopify_order_id`;
- normalized exact `order_number` / `shopify_order_number`.

Task to route/driver context:

- exact `assigned_driver`, `assigned_driver_id`, or `assigned_driver_email` presence;
- exact `route_id` or `delivery_route_id` presence;
- exact `route_stop_id`, `route_stop_sequence`, or `stop_sequence` presence.

The helper does not match by customer name, customer email, phone, full address, approximate date, approximate amount, nearest route stop, newest record, or delivery instructions.

If multiple exact candidates exist, the row is classified as duplicate identity risk. The helper does not choose newest or nearest candidates.

## 6. Canonical read-model contract

When backend-enabled and explicitly requested with:

```text
read_model_mode=DELIVERY_LIFECYCLE
```

`getAdminDeliveryRouteSummary` may return:

```text
delivery_lifecycle_read_model_available
delivery_lifecycle_read_model_enabled
delivery_lifecycle_read_model_version
delivery_lifecycle_read_model
```

The read model includes:

- `read_model_version`;
- `read_model_available`;
- `read_model_enabled`;
- `source_mode`;
- summary counts;
- classification counts;
- canonical rows with order number, safe internal refs, lifecycle status, schedule/status mismatch categories, fallback/review flags, blockers, and warnings.

Explicit write readiness flags remain false:

```text
driver_assignment_write_ready=false
route_mutation_ready=false
out_for_delivery_write_ready=false
delivered_write_ready=false
shopify_fulfillment_write_ready=false
notification_expansion_ready=false
customer_status_write_ready=false
hub_write_suppression_ready=false
```

## 7. Classifications

G48D uses shared delivery read classifications:

```text
delivery_lifecycle_native_read_ready
delivery_lifecycle_native_read_partial
delivery_lifecycle_order_chain_missing
delivery_lifecycle_native_order_missing
delivery_lifecycle_task_missing
delivery_lifecycle_duplicate_identity_risk
delivery_lifecycle_schedule_mismatch
delivery_lifecycle_status_mismatch
delivery_lifecycle_driver_assignment_missing
delivery_lifecycle_route_context_missing
delivery_lifecycle_payment_hold
delivery_lifecycle_refund_cancel_hold
delivery_lifecycle_subscription_multi_delivery_hold
delivery_lifecycle_review_queue_hold
delivery_lifecycle_repair_replay_hold
delivery_lifecycle_already_completed
delivery_lifecycle_hub_fallback_required
delivery_lifecycle_manual_review_required
```

Read readiness never means command readiness.

## 8. Backend-authoritative activation

Activation is backend-owned by `getAdminDeliveryRouteSummary`:

```text
ENABLE_ADMIN_DELIVERY_LIFECYCLE_READ_MODEL
ADMIN_DELIVERY_LIFECYCLE_READ_MODEL_KILL_SWITCH
```

No Vite variable, query string, localStorage key, browser global, or UI-only flag can activate the read model.

When disabled, the existing route-summary behavior, current Hub fallback, valid rows, action buttons, and date/range filtering remain unchanged. The backend may return additive capability metadata, but does not return the read-model payload unless enabled and requested.

## 9. Admin page adoption

`src/pages/admin/DeliveryQueue.jsx` requests the backend mode and consumes the canonical payload only when all are true:

- backend reports available;
- backend reports enabled;
- backend version is supported;
- payload reports enabled and supported version;
- payload rows and summary are valid.

If disabled, unavailable, malformed, or unsupported, the page preserves the current route-summary UI and Hub fallback behavior.

The UI does not perform independent fuzzy matching and does not hide any delivery rows based on read-model classification.

## 10. Preserved write/action paths

G48D does not modify:

- driver assignment/reassignment functions;
- route optimization/mutation functions;
- out-for-delivery functions;
- delivered functions;
- revert/reset functions;
- Shopify fulfillment functions;
- Hub delivery-update functions;
- notification functions;
- customer tracker/status functions.

Existing action buttons retain their current identifiers and behavior while G48D is disabled. A canonical read-model row does not make an existing action newly available.

## 11. Hub/provider/notification holds

Hub fallback remains active. Hub write suppression remains not ready. Route optimization provider writes remain held. Notifications remain held. Customer tracker/status changes remain held. Proof/drop/route policy remains separate.

G48D does not call Hub beyond the existing route-summary read fallback already in `getAdminDeliveryRouteSummary`; the helper itself calls no external service.

## 12. Test coverage

The G48D harness covers:

- helper locality and deploy graph;
- helper purity;
- disabled route-summary compatibility;
- exact identity linkage;
- duplicate, missing, mismatch, payment, refund/cancel, subscription, review, repair/replay holds;
- assigned/unassigned/route-linked/out-for-delivery/delivered display states;
- Hub-only fallback visibility;
- backend-authoritative UI activation;
- no frontend Vite/query/localStorage/global activation;
- unchanged delivery write functions;
- no entity writes, provider calls, Hub mutation, notification, customer tracker mutation, raw payload exposure, or PII expansion.

Regression coverage includes G39D delivery route summary and G42B delivery readiness.

## 13. Publish-disabled plan

After merge:

1. Publish only `getAdminDeliveryRouteSummary`.
2. Publish Web/admin UI only when local/Builder scope is clean.
3. Keep `ENABLE_ADMIN_DELIVERY_LIFECYCLE_READ_MODEL` disabled.
4. Verify existing route summary remains unchanged.
5. Smoke Delivery Queue under fallback.
6. Run no-write verification.
7. Do not activate delivery actions.

## 14. Activation evidence requirements

A future G48D-LIVE1 requires at minimum:

- one exact non-refunded delivery chain;
- exactly one native `ShopifyOrder`;
- exactly one native `FulfillmentTask`;
- exact delivery-date agreement;
- no review/repair/replay hold;
- valid route/driver state for the displayed lifecycle;
- no payment/refund/subscription blocker;
- separate owner approval.

Delivery command work remains blocked until G42B identifies a clean command candidate.

## 15. Hub retirement criteria for delivery reads

Delivery reads may move further from Hub only after:

- native route rows cover current delivery operations;
- Hub-only valid rows are either mirrored natively or explicitly retained through fallback;
- duplicate identity and schedule mismatch rates are low enough for operational use;
- route/driver state has a native source of truth;
- customer tracker/status mapping is separately approved;
- delivery actions remain independently gated.

## 16. No-write policy

G48D is read-only PR prep. It does not mutate `Order`, `ShopifyOrder`, `FulfillmentTask`, Hub, route/provider records, notifications, customer tracker/status, schemas, or delivery action state. It does not publish Base44 or Builder during PR prep.

## 17. Next package recommendation

Close/merge/publish G48D disabled if clean. Then run disabled smoke and no-write verification. Do not start delivery commands until G42B has a clean command candidate. If G48D produces useful live read evidence, the next delivery package should be exact G48D-LIVE1 read-model activation for one proven chain, not command execution.
