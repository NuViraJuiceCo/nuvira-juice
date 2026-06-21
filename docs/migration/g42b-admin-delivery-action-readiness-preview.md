# G42B — Admin delivery action readiness preview

## 1. G42A findings

G42A found that the Delivery Queue read surface is partially native but delivery actions are not broadly migrated. The route summary read path is native-first with Hub fallback through `getAdminDeliveryRouteSummary`, while the operational action buttons still depend on Hub commands or exact-gated native lifecycle previews.

Carry-forward holds remain unchanged:

- Apple Pay production payments remain paused under `apple_pay_deferred_intent_backend_blocked_by_platform_atomicity`.
- PR #545 remains draft, blocked, unmerged, and unpublished.
- G43B/G43C customer order-history and tracker allowlists remain unchanged.
- Hub fallback and Hub writes remain active.

G42B adds an admin-only, read-only preview mode. It does not execute delivery actions and does not change live delivery behavior.

## 2. Current admin delivery action paths

| Delivery surface/action | UI control/component | Backend function | Entities read | Entities written by current action | Hub write | Shopify/provider call | Route provider call | Notification behavior | Customer-facing status effect | Gate/kill switch | Auth | Idempotency | Rollback | Current source of truth |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Route summary read | `DeliveryQueue.jsx` query | `getAdminDeliveryRouteSummary` | `FulfillmentTask`, `ShopifyOrder`, Hub fallback, Customer App Order context | none | no local mutation | no Shopify provider call | no | none | none | read path only | admin | n/a | n/a | Native summary with Hub fallback |
| Assign driver | `DriverAssignmentControls` | `updateAdminFulfillmentTaskAssignment` | request target only; Hub command resolves authoritative task | Hub-side fulfillment assignment via command wrapper | yes | no | no | none directly | operational assignment only | Hub service config | admin | request_id forwarded to Hub | unassign exists but exact rollback policy not fully proven | Hub command for Hub rows; native exact-gated lifecycle exists for native rows |
| Change/reassign driver | `DriverAssignmentControls` | `updateAdminFulfillmentTaskAssignment` | same as assign | Hub-side fulfillment assignment via command wrapper | yes | no | no | none directly | operational assignment only | Hub service config | admin | request_id forwarded to Hub | previous-driver restoration policy not fully proven | Hub command for Hub rows; native exact-gated lifecycle exists for native rows |
| Add/remove route | not exposed as persisted route action | none | n/a | none | no direct action | no | no | none | none | n/a | n/a | missing | missing | Manual/static route manifest |
| Optimize route | `RouteOptimizationPanel` | `optimizeDeliveryRoute` | explicit stops from route summary; legacy path can read Order/FulfillmentTask/UserProfile/Hub if gate allows | none in preview path | can read Hub in legacy path | no Shopify call | Google Maps Routes API when enabled | none | none | `ENABLE_DELIVERY_ROUTE_OPTIMIZATION`; legacy fetch gate | driver or admin | preview-only | no persisted route to roll back | Static/manual route remains authoritative |
| Start route | static route link | none | n/a | none | no | no | no | none | none | n/a | n/a | missing | missing | Manual driver route start outside native command surface |
| Mark out for delivery | `OperationalStatusControls` | `markAdminFulfillmentTaskOutForDelivery` | request target only; Hub command resolves authoritative task | Hub-side fulfillment status via command wrapper | yes | no | no | explicitly separate/held | customer tracker update remains separately governed | Hub service config | admin | request_id forwarded to Hub | no approved rollback | Hub command for Hub rows; native exact-gated lifecycle exists for native rows |
| Mark delivered/completed | `OperationalStatusControls` | `recordAdminFulfillmentTaskDelivered` | request target only; Hub command resolves authoritative task | Hub-side fulfillment delivery completion via command wrapper | yes | no | no | explicitly separate/held | customer tracker update remains separately governed | Hub service config | admin | request_id forwarded to Hub | no approved rollback | Hub command for Hub rows; native exact-gated lifecycle exists for native rows |
| Failed/missed delivery | not exposed | none | n/a | none | no direct action | no | no | held | held | n/a | n/a | missing | missing | No approved action |
| Revert/reset delivery status | not exposed | none | n/a | none | no direct action | no | no | held | held | n/a | n/a | missing | missing | No approved action |
| Native lifecycle preview | `NativeFulfillmentPreviewPanel` | `previewNativeFulfillmentTaskLifecycle` | request task payload only | none | no | no | no | none | none | dry-run only | admin UI path | n/a | n/a | Evidence-only preview |
| Native lifecycle execution | `NativeFulfillmentPreviewPanel` | `executeNativeFulfillmentTaskLifecycle` | exact `FulfillmentTask` | exact `FulfillmentTask`; `CommandLog` | no Hub mutation by contract | no | no | no | no Customer App status write by contract | default-off env gates, actor/action/task allowlists, kill switch | admin | CommandLog idempotency key | partial/unassign only; broader rollback not approved | Exact native task command candidate only |
| Customer tracker status | `OrderTracker.jsx` | `getCustomerOrderDetail` | Customer App Order and bounded native context | none | Hub fallback active | no | no | none | read-only display | G43C exact allowlist | customer auth | n/a | n/a | Customer App Order canonical with Hub fallback |
| Customer history status | `OrderHistory.jsx` | `getCustomerAccountDashboardData` | Customer App Order and limited native context | none | Hub fallback active | no | no | none | read-only display | G43B exact allowlist | customer auth | n/a | n/a | Customer App Order canonical with Hub fallback |
| Hub delivery sync/import/export | admin/sync surfaces | `pushOrderStatusToHub`, `syncHubDeliveryStatuses`, `syncAdminSingleHubDeliveryStatus` | Customer App/native/Hub context | Hub or sync logs depending function | yes | no | no | no direct notification expansion | may affect downstream Hub state | existing sync contracts | admin/system | function-specific | function-specific | Hub remains active |
| Notification/message dispatch | no Delivery Queue send button | `sendUpcomingDeliveryNotifications`, `verifyOutForDeliveryNotification`, `CustomerMessageDeliveryLog` use | Customer/order/task context | notification/message logs when invoked | possible downstream | provider-specific messaging | no route provider | held in G42B | none from G42B | separate notification gates | admin/system | function-specific | not part of G42B | Notification policy remains held |

## 3. Source-of-truth map

- Admin route summary: native-first `FulfillmentTask`/`ShopifyOrder` read context with Hub fallback.
- Driver assignment and delivery transitions: current Delivery Queue buttons are still Hub command wrappers for Hub rows.
- Native task lifecycle: exact-gated, default-off native command candidate exists through `executeNativeFulfillmentTaskLifecycle`, but G42B does not execute it.
- Customer App Order remains the customer-facing canonical record.
- Customer tracker/history status changes remain separately governed by G43B/G43C contracts.
- Hub delivery sync/export remains active until a separate write-suppression/shadow plan exists.
- Route optimization remains preview/provider-gated and does not persist route order.
- Notifications remain held unless separately approved.

## 4. Exact identity contract

`ADMIN_DELIVERY_ACTION_READINESS` supports:

- `EXACT_DELIVERY_ACTION_READINESS`
- `BOUNDED_DELIVERY_ACTION_READINESS_SCAN`

Exact preview accepts only safe exact identifiers:

- `fulfillment_task_id` / `task_id`
- `customer_app_order_id` / `order_id` / `base44_order_id`
- `native_shopify_order_id` / `native_order_id` / `shopify_order_id`
- normalized exact `order_number` / `shopify_order_number`, only when it resolves to one compatible chain

The preview rejects fuzzy identity. It does not match by customer name, partial email, phone, approximate address, approximate delivery date, approximate total, or newest timestamp selection.

Exact readiness requires:

- exactly one Customer App Order where required;
- exactly one compatible native ShopifyOrder where required;
- exactly one compatible FulfillmentTask;
- order number and exact linkage agreement across the chain;
- no duplicate identity risk;
- no payment, refund/cancel, subscription/multi-delivery, review queue, repair/replay, delivery schedule, or status mismatch hold.

## 5. Action readiness matrix

The preview returns one matrix row for each action:

1. `assign_driver`
2. `change_reassign_driver`
3. `add_to_route`
4. `remove_from_route`
5. `optimize_route`
6. `start_route`
7. `mark_out_for_delivery`
8. `mark_delivered_completed`
9. `mark_failed_missed_delivery`
10. `revert_reset_status`
11. `customer_tracking_status_update`
12. `notification_message_dispatch`
13. `hub_delivery_state_sync`
14. `shopify_fulfillment_state_sync`

Each row reports:

- `action_present`
- `native_read_context_complete`
- `native_write_path_exists`
- `exact_target_identity_ready`
- `current_status_allows_action`
- `current_source_of_truth`
- `hub_dependency`
- `provider_dependency`
- `notification_dependency`
- `idempotency_ready`
- `rollback_ready`
- `native_command_candidate`
- `action_native_ready`
- `fallback_required`
- `review_required`
- `blockers`
- `warnings`

A native command candidate is evidence for a later exact command plan. It is not approval to run the action.

## 6. Bounded scan strategy

`BOUNDED_DELIVERY_ACTION_READINESS_SCAN` uses one bounded read per source and joins in memory:

- `FulfillmentTask`
- `Order`
- `ShopifyOrder`
- `OrderReviewQueue`
- `OrderSyncLog`
- `SafeSyncParityLog`

The scan returns aggregate counts including:

- `unique_delivery_task_count`
- `duplicate_task_identity_count`
- `exact_order_chain_complete_count`
- `assign_driver_candidate_count`
- `route_candidate_count`
- `out_for_delivery_candidate_count`
- `delivered_candidate_count`
- `already_completed_count`
- `schedule_mismatch_count`
- `status_mismatch_count`
- `payment_hold_count`
- `refund_cancel_hold_count`
- `subscription_multi_delivery_hold_count`
- `review_queue_hold_count`
- `repair_replay_hold_count`
- `Hub_write_required_count`
- `provider_call_required_count`
- `notification_held_count`
- `native_command_candidate_count`
- `fallback_required_count`
- `review_required_count`
- `classification_counts`

If a required source is truncated or fails, `scan_complete` is false and missing related context is treated as `bounded_scan_context_not_found` rather than definitively absent.

## 7. Customer-facing status implications

G42B must not change customer-facing tracking or order-history behavior.

- Out-for-delivery and delivered statuses may be previewed as operational readiness only.
- Customer-facing tracker/status copy remains governed by G43C and later approved customer-status policies.
- Notifications remain separately held.
- Delivered customer status cascade remains held.
- No route/proof/drop data is exposed to customers.

## 8. Hub/Shopify/provider dependencies

Current dependencies that block broad native delivery action migration:

- Hub command wrappers remain the current action path for Hub rows.
- Hub fallback remains active and is not suppressed by G42B.
- `optimizeDeliveryRoute` can call Google Maps Routes API when the optimization gate is enabled; G42B never calls it.
- Shopify provider calls are not part of G42B. Native `ShopifyOrder` entity reconciliation remains separate and exact-gated.
- Notification functions and `CustomerMessageDeliveryLog` remain outside this action-readiness preview.

## 9. Idempotency and rollback gaps

Known gaps:

- Hub wrappers forward request IDs, but Hub-side idempotency is not treated as native migration proof.
- `executeNativeFulfillmentTaskLifecycle` has CommandLog idempotency and exact allowlists, but broad delivery action migration is not approved.
- Route add/remove/start/optimization persistence has no approved native rollback path.
- Delivered/out-for-delivery rollback is not approved.
- Reassign rollback to a previous exact driver state is not fully proven.

G42B therefore reports idempotency and rollback readiness per action and keeps later commands default-off.

## 10. Response safety

Required top-level safety fields remain false:

- `writes_performed`
- `provider_call_impact`
- `shopify_calls`
- `hub_calls`
- `route_provider_calls`
- `notifications_sent`
- `hub_mutation_performed`
- `order_mutation_performed`
- `native_order_mutation_performed`
- `fulfillment_task_mutation_performed`
- `driver_assignment_performed`
- `route_mutation_performed`
- `delivery_status_updated`
- `command_log_created`
- `pii_returned`
- `raw_payloads_returned`

The preview returns order numbers and aggregate booleans/counts only. It does not return customer names, emails, phone numbers, full addresses, delivery instructions, raw Hub/Shopify/provider payloads, driver private contact details, secrets, auth/session data, or proof/drop media.

## 11. Test coverage

`run-g42b-admin-delivery-action-readiness-tests.mjs` covers:

- admin auth boundary markers;
- exact order/native/task resolution;
- duplicate/missing identity holds;
- payment, refund/cancel, subscription, schedule, status, review, and repair/replay holds;
- assignment, out-for-delivery, delivered, route, provider, notification, idempotency, and rollback classifications;
- bounded one-read-per-source scan behavior;
- source truncation behavior;
- no PII/raw payload exposure;
- no Order, ShopifyOrder, FulfillmentTask, driver, route, delivery status, provider, Hub, Shopify, notification, log, or queue mutation.

## 12. Recommended next action phases

If G42B finds exact clean candidates, proceed one action at a time:

1. Assign driver default-off native command plan.
2. Mark out-for-delivery default-off native command plan.
3. Mark delivered default-off native command plan.
4. Route optimization/provider integration last.

Do not combine all delivery actions into one command.

If G42B finds no clean candidate, resolve identity, status, schedule, idempotency, or rollback blockers before any runtime command patch.

## 13. Hard stops

- No delivery action execution in G42B.
- No driver assignment.
- No route optimization/provider call.
- No route mutation or persisted route order.
- No out-for-delivery write.
- No delivered write.
- No revert/reset status write.
- No Order, ShopifyOrder, or FulfillmentTask mutation.
- No Hub mutation or Hub write suppression.
- No Shopify provider call.
- No customer or driver notification.
- No customer-facing tracker/status change.
- No proof/drop upload or evidence mutation.
- No sync/repair/replay.
- No inventory deduction.
- No PurchaseOrder creation.
- No UI publish during PR prep.

## 14. No-write confirmation

G42B is admin-only, read-only, and preview-only. It adds no delivery command execution, no schema change, no UI change, no Base44 publish during PR prep, no Hub/provider/Shopify call, no notification, no route mutation, no record mutation, and no customer-facing behavior change.
