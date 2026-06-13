# G33C-MIRROR2-PUB1: Base44 function-slot unblock audit

## 1. Executive summary

G33C-MIRROR2 is merged in GitHub but is not boundary-ready because the scoped Base44 deploy of `createNativeOneTimeShopifyOrderMirrorForCustomerApp` was blocked by the platform error:

```text
Maximum of 50 functions per app reached.
```

This audit is read-only and design-only. No Base44 function was deleted, renamed, republished, overloaded, or otherwise changed. No live command ran. No gates were opened. No records were mutated.

The safest unblock path is **not** to overload an unrelated existing write function. The safest practical option is a separate explicit approval to decommission one clearly one-off function slot, then deploy only `createNativeOneTimeShopifyOrderMirrorForCustomerApp` and run gates-closed boundary verification. The strongest static candidate is `applyStripeEventCleanup`, but deletion still requires separate approval because static reference absence is not the same as operational decommission proof.

If owner does not approve a decommission, hold G33C-MIRROR2 and request a Base44 function-limit increase or plan a consolidation phase.

## 2. Repository and PR state

Verified:

- PR #453 is merged: https://github.com/NuViraJuiceCo/nuvira-juice/pull/453
- Merge commit on `origin/main`: `4d523de3d9650cea80015e439e1b7e16b1e070a9`
- Local `HEAD` matches `origin/main` at the same merge commit before this docs-only branch.
- New command source exists at `base44/functions/createNativeOneTimeShopifyOrderMirrorForCustomerApp/entry.ts`.
- Only unrelated local caveat remains untracked and outside scope: `base44/functions/previewNativeOrderCutoverReadiness/entry 2.ts`.

No successful deploy/boundary verification exists for the new command. The previous scoped deploy attempt failed with the function-count error. Although `base44 functions list` currently prints the new command name, this is not enough to treat the command as deployed and live-boundary verified because the deploy command returned failure and no GET/unauth/admin gates-closed checks have passed.

## 3. Base44 function-count blocker

Read-only inventory command:

```bash
base44 functions list
```

Observed:

- Function names reported: 257
- Repo function directories: 257
- Reported function names not present in repo: 0
- Repo function directories not reported by list: 0
- Functions with automation marker in list: 19

The platform still blocks scoped creation/deploy of the new command with a maximum-function error. Treat this as a deployment unblock problem, not as approval to run the command.

Automation-marked functions:

`autoExpireZone3Authorizations`, `cancelAbandonedCheckouts`, `cancelIncompleteSubscriptions`, `deleteProductFromShopify`, `enrollNewCustomerInLoyalty`, `googleMerchantFeed`, `monitorPostPaymentChain`, `pushMerchToShopify`, `pushProductToShopify`, `retryFailedHubSyncs`, `sendOrderStatusNotification`, `sendUpcomingDeliveryNotifications`, `shopifyPollFallback`, `syncHubDeliveryStatuses`, `syncLoyaltyToHub`, `syncOrderToHub`, `syncProductsToGMC`, `syncShopifyOrderToHub`, `syncSubscriptionPlansToHub`

## 4. Classification summary

Classification is conservative. Functions with unclear runtime ownership are not removal candidates.

| Classification | Count |
|---|---:|
| active_admin_ui_dependency | 51 |
| active_customer_app_dependency | 38 |
| active_sync_or_hub_bridge_dependency | 54 |
| auth_security_critical | 2 |
| critical_live_runtime | 11 |
| historical_one_off_command | 43 |
| migration_command_default_off | 22 |
| migration_preview_active | 22 |
| payment_or_webhook_critical | 14 |

## 5. Classification inventory

### payment_or_webhook_critical

`cancelAbandonedCheckouts` (automation), `cancelIncompleteSubscriptions` (automation), `capturePreOrderPayments`, `createCheckoutSession`, `createPaymentIntent`, `createSubscriptionCheckoutHosted`, `createSubscriptionPaymentElementIntent`, `createSubscriptionPaymentIntent`, `createSubscriptionPaymentIntentV2`, `createSubscriptionSession`, `shopifyWebhookReceiver`, `stripeCustomerPortal`, `stripeWebhook`, `verifyStripeLiveMode`

### auth_security_critical

`addressSuggest`, `verifyShopifyAuth`

### critical_live_runtime

`adminCancelAndRefundSubscription`, `autoExpireZone3Authorizations` (automation), `cancelSubscriptionFutureRenewal`, `deactivateLoyaltyMembers`, `enrollNewCustomerInLoyalty` (automation), `generateSitemap`, `generateSubscriptionOrders`, `pauseSubscription`, `processManualRefund`, `redeemMay30EventBonus`, `refundFlowDiagnostic`

### active_customer_app_dependency

`approveZone3DeliveryRequest`, `approveZone3SubscriptionRequest`, `claimReward`, `completeAccountSetup`, `createLoyaltyMember`, `createZone3AuthorizationIntent`, `createZone3SubscriptionReviewRequest`, `denyZone3DeliveryRequest`, `findCustomerOrders`, `findCustomerSubscriptions`, `getAdminPushDiagnostics`, `getCustomerAccountDashboardData`, `getCustomerNotifications`, `getCustomerOrderDetail`, `getCustomerOrdersWithHub`, `getDeliveryEta`, `getOrderBySession`, `notifyOrderProcessed`, `pollOrderStatusUpdates`, `receivePointsSync`, `registerPushSubscription`, `sendAdminOrderProcessedNotification`, `sendAdminPushTestNotification`, `sendCustomerNotification`, `sendCustomerPushNotification`, `sendLoyaltySignup`, `sendMay30PushTest`, `sendNotificationCampaign`, `sendOrderConfirmation`, `sendOrderReceivedNotification`, `sendOrderSms`, `sendOrderStatusNotification` (automation), `sendThankYouToLoyaltyMembers`, `sendUpcomingDeliveryNotifications` (automation), `sendUserInvite`, `unregisterPushSubscription`, `validateDeliveryEligibility`, `verifyOutForDeliveryNotification`

### active_admin_ui_dependency

`adminDashboardData`, `appendAdminHubOrderNote`, `bottleAdminProductionVerifyShopifyOrder`, `completeAdminProductionBatch`, `correctAdminOrderDeliverySchedule`, `correctAdminOrderDeliveryScheduleV2`, `correctAdminProductionBatchStaffOnDuty`, `correctAdminProductionIngredientUsage`, `deductAdminProductionInventory`, `generateAuditPacket`, `getAdminCalendarEventsSummary`, `getAdminComplianceOpsSummary`, `getAdminDeliveryRouteSummary`, `getAdminFulfillmentTaskDetails`, `getAdminInventoryStatusSummary`, `getAdminLaunchReadOnlySummary`, `getAdminOperationsDashboardSummary`, `getAdminOpsAlertsSummary`, `getAdminOrderTimeline`, `getAdminOrdersWithHub`, `getAdminPOSOrdersSummary`, `getAdminProductionPlanningSummary`, `getAdminProductionQueueSummary`, `getAdminResourcesSummary`, `getAdminShopifyOpsSummary`, `getAdminSyncHealthSummary`, `logDriverAction`, `markAdminFulfillmentTaskOutForDelivery`, `markAdminHubOrderDeliveredForCustomerAppSync`, `optimizeDeliveryRoute`, `packAdminProductionVerifyFulfillmentTasks`, `previewAdminHistoricalHubBackfill`, `previewAdminMay30POSProfileCandidates`, `previewAdminNonSubscriptionBottledCascadeCandidates`, `previewAdminProductionBatchComplete`, `previewAdminProductionBatchStart`, `previewAdminProductionBatchVerify`, `previewAdminProductionIngredientUsageCorrection`, `previewAdminProductionInventoryDeduction`, `previewAdminProductionVerifyCascades`, `previewAdminSubscriptionFulfillmentProductionStatus`, `reconcileDeliveredOrders`, `recordAdminFulfillmentTaskDelivered`, `retryFailedDriverSync`, `saveAdminComplianceRecord`, `startAdminProductionBatch`, `updateAdminFulfillmentTaskAssignment`, `updateAdminOpsAlertStatus`, `updateAdminProductCatalogItem`, `validateComplianceEntry`, `verifyAdminProductionBatch`

### active_sync_or_hub_bridge_dependency

`debugAndRetryHubSync`, `debugHubSyncPayload`, `deleteProductFromShopify` (automation), `getAllOrdersForSync`, `getBagReturnsForSync`, `getLoyaltyDataForSync`, `getOrderUpdatesForSync`, `getOrdersForSync`, `getSubscriptionOrdersForSync`, `googleMerchantFeed` (automation), `hubSyncProxy`, `hubToCustomerAppStatusSync`, `manualPushOrderToHub`, `manualSyncLoyaltyMember`, `manualSyncOrders`, `manualSyncSubscription`, `manualSyncSubscriptionOrders`, `pushExistingLoyaltyMembersToHub`, `pushLoyaltyMemberToHub`, `pushMerchToShopify` (automation), `pushOrderStatusToHub`, `pushOrderToShopify`, `pushProductToShopify` (automation), `pushSubscriptionPlanToStripe`, `receiveSyncedEvent`, `reconcileCustomerLoyalty`, `retryFailedHubSyncs` (automation), `retryRepairedSubscriptionHubSync`, `shopifyBulkPushProducts`, `shopifyFulfillOrder`, `shopifyPollFallback` (automation), `shopifyResyncOrders`, `shopifyResyncProducts`, `syncAdminSingleHubDeliveryStatus`, `syncAllSubscriptionsFromHub`, `syncCustomerToHub`, `syncEventToHub`, `syncEventsFromHub`, `syncHubDeliveryStatuses` (automation), `syncLoyaltyFromHub`, `syncLoyaltyToHub` (automation), `syncMerchToShopify`, `syncOrderToHub` (automation), `syncOrdersFromHub`, `syncProductsToGMC` (automation), `syncRefundToHub`, `syncRepairedSubscriptionToHub`, `syncShopifyOrderToHub` (automation), `syncStuckOrdersPollerManual`, `syncSubscriptionFromHub`, `syncSubscriptionPlansToHub` (automation), `syncSubscriptionWithFulfillments`, `syncUserToHub`, `verifyHubEndpointReachability`

### migration_preview_active

`previewHistoricalCustomerOrderFulfillmentBackfillImpact`, `previewHistoricalHubFulfilledNativeBackfill`, `previewNativeCustomerDeliveredStatusImpact`, `previewNativeCustomerStatusNotificationImpact`, `previewNativeDeliveryCompletionReconciliation`, `previewNativeDeliveryWorkflowReadiness`, `previewNativeExactOrderPilotApproval`, `previewNativeFulfillmentTaskLifecycle`, `previewNativeFulfillmentTaskMaterialization`, `previewNativeFulfillmentTaskMetadataRepair`, `previewNativeOrderCutoverReadiness`, `previewNativeOrderScheduleCorrection`, `previewNativeProductionBatchLifecycle`, `previewNativeProductionDemandMaterialization`, `previewNativeProductionInventoryReadiness`, `previewNativeProductionMasterDataParity`, `previewNativeProductionVerifyCascades`, `previewNativeSafeSyncDarkLaunchComparison`, `previewNativeSafeSyncLiveOrderParity`, `previewNativeSafeSyncOrderUpdate`, `previewNativeSafeSyncParityHarness`, `previewNativeScheduleExceptionCorrection`

### migration_command_default_off

`backfillHistoricalHubFulfilledNativeShopifyOrderForCustomerApp`, `bottleNativeProductionShopifyOrderForCustomerApp`, `completeNativeProductionBatchesForCustomerApp`, `correctNativeScheduleExceptionForCustomerApp`, `createNativeOneTimeShopifyOrderMirrorForCustomerApp`, `createNativePartialRefundReviewQueueForCustomerApp`, `createNativeSubscriptionOccurrenceShopifyOrderMirrorForCustomerApp`, `executeNativeFulfillmentTaskLifecycle`, `executeNativeFulfillmentTaskMaterialization`, `executeNativeFulfillmentTaskMetadataRepair`, `executeNativeOrderScheduleCorrection`, `executeNativeProductionBatchLifecycle`, `executeNativeSafeSyncOrderUpdate`, `importNativeProductionMasterDataForCustomerApp`, `materializeNativeProductionBatchesForCustomerApp`, `packNativeProductionFulfillmentTaskForCustomerApp`, `processMay30NativeOrderOps`, `reconcileNativeDeliveryCompletionForCustomerApp`, `startNativeProductionBatchesForCustomerApp`, `updateNativeCustomerOrderDeliveredStatusForCustomerApp`, `updateNativeCustomerOrderStatusForCustomerApp`, `verifyNativeProductionBatchesForCustomerApp`

### historical_one_off_command

`applyStripeEventCleanup`, `assignDeliveryWindow`, `assignProductionWindow`, `auditAmarkSubscriptions`, `auditCustomerAppLoyaltyAfterPhase2`, `auditLatestStripePaymentForAmark`, `auditNewSubscriptions`, `auditStabilizationRepair`, `auditStripeAndIntegrationInventory`, `auditSubscriptionFulfillments`, `auditSubscriptionPayloadToHub`, `auditWindow3Orders`, `backfillAdminHistoricalHubOrders`, `calculateNuViraFulfillmentSchedule`, `canonicalizeAmarkSubscription`, `detectStuckOrders`, `diagnosePiConfig`, `evaluateSaturdayThreshold`, `executeCustomerAppLoyaltyImportPhase2`, `getWindow3Status`, `ingestCustomerAppOrderManual`, `inspectPaymentIntent`, `listRecentPIs`, `monitorLiveCheckoutTest`, `monitorPostPaymentChain` (automation), `monitorSubscriptionLoyalty`, `probeHubSubscriptionCancelled`, `recoverStuckOrder`, `repairFulfillmentTaskAssignedDeliveryDates`, `repairLiveSubscriptionFailure`, `repairLiveSubscriptionV2`, `repairMissingCASubscriptionFromStripeAndHub`, `repairMissingSubscriptionForPaidInvoice`, `repairR1DeepaCAPatch`, `repairR2RefundedDuplicatesCA`, `repairR3HenrryCAHydration`, `repairR4SukhwantCAStructure`, `replaySubscriptionRefundDryRun`, `resolveShopifyCartPermalink`, `stabilizationDiagnostic`, `testSchedulingLogic`, `verifyCustomerFacingLoyaltyDisplay`, `verifyLiveSubscriptionSmoke`

## 6. Reference search results for possible slot candidates

Search roots:

- `src/`
- `base44/functions/`
- `scripts/`
- `docs/`

Reference counts are static-search signals only. They do not prove a function has no manual/operator use.

| Function | src files | function files | script files | doc files | runtime cross-ref count |
|---|---:|---:|---:|---:|---:|
| `applyStripeEventCleanup` | 0 | 0 | 0 | 0 | 0 |
| `getWindow3Status` | 0 | 1 | 0 | 0 | 0 |
| `previewNativeSafeSyncParityHarness` | 0 | 1 | 0 | 2 | 0 |
| `testSchedulingLogic` | 0 | 2 | 0 | 2 | 1 |
| `auditWindow3Orders` | 4 | 2 | 0 | 0 | 5 |
| `repairR3HenrryCAHydration` | 0 | 1 | 0 | 1 | 1 |
| `repairR1DeepaCAPatch` | 0 | 1 | 0 | 1 | 1 |
| `repairR4SukhwantCAStructure` | 0 | 1 | 0 | 1 | 1 |
| `repairR2RefundedDuplicatesCA` | 0 | 1 | 0 | 2 | 1 |
| `previewNativeSafeSyncLiveOrderParity` | 0 | 3 | 1 | 3 | 2 |
| `previewNativeExactOrderPilotApproval` | 1 | 1 | 1 | 2 | 1 |

Notable findings:

- `applyStripeEventCleanup` has no direct static references found by function name. The function source describes a one-time approved Stripe webhook event selection cleanup and performs Stripe webhook endpoint updates if its gate is enabled. That makes it a strong decommission candidate after explicit owner approval because it should not be a standing runtime dependency.
- `getWindow3Status` has no runtime cross-reference, but it returns live order status audit data and may have been used manually. It should not be removed without owner confirmation.
- `previewNativeSafeSyncParityHarness` has no runtime cross-reference outside its own function, but it is part of migration safety history and should not be removed before confirming replacement coverage.
- `testSchedulingLogic` and `auditWindow3Orders` are historical scheduling/window audit utilities. They have references and/or admin usage risk, so they are lower-confidence candidates than `applyStripeEventCleanup`.

## 7. Safe removal candidates

No function is safe to delete in this phase because this phase has no explicit deletion approval and static search is not operational decommission proof.

Strongest candidate for a **separate deletion/deploy approval**:

| Candidate | Why it is the strongest candidate | Remaining proof needed | Risk |
|---|---|---|---|
| `applyStripeEventCleanup` | One-time Stripe webhook event cleanup function; no static direct references; no automation marker; not part of customer/admin UI runtime by name; retaining it creates more risk than utility if accidentally enabled. | Owner confirms cleanup is complete and no future manual use is expected; final pre-delete list/search still clean; gate remains closed. | Low-to-medium. It calls Stripe if enabled, so accidental retention is also risky; deletion is still irreversible until redeploy from repo/source. |

Other candidates are `obsolete_candidate_needs_proof`, not deletion-ready.

## 8. Unsafe/unknown functions to keep

Keep all functions in these groups unless a separate decommission packet proves otherwise:

- payment/webhook functions, especially `stripeWebhook`, checkout/payment intent functions, Stripe portal functions, and Shopify webhook functions
- auth/security helpers
- customer-facing account/order/notification functions
- admin dashboard/operations functions
- Hub bridge/sync functions
- automation-attached functions
- active migration previews and default-off migration commands
- all functions with static runtime references
- all unknown functions

## 9. Deployment unblock options

### Option A — Decommission one clear one-off function slot

Recommended if owner wants the quickest safe unblock.

Candidate: `applyStripeEventCleanup`

Required separate approval. Do not perform from this audit.

Proposed steps after approval:

1. Re-run `base44 functions list` and static `rg` checks for `applyStripeEventCleanup`.
2. Confirm no automation marker and no runtime/frontend references.
3. Confirm owner approval phrase.
4. Delete only `applyStripeEventCleanup` from Base44 deployed functions.
5. Verify the function is absent from `base44 functions list`.
6. Deploy only `createNativeOneTimeShopifyOrderMirrorForCustomerApp`.
7. Verify live source markers.
8. Boundary-check only:
   - GET returns 405, `writes_performed:false`
   - unauth POST returns 401, `writes_performed:false`
   - admin-auth gates-closed call returns 409, `writes_performed:false`
9. Run fresh G33C-MIRROR1 read-only preview.
10. Verify no records/logs/queues/notifications were created.

### Option B — Consolidate old preview functions into `previewNativeOrderCutoverReadiness`

Safer long-term, but slower. Requires a separate design/implementation PR and careful regression tests. This is appropriate if Base44 function-slot pressure will continue.

### Option C — Extend an existing default-off command function

Not recommended without a design pass. Mixing unrelated write contracts in a single endpoint increases operational and audit risk.

### Option D — Keep G33C-MIRROR2 merged but dormant

Safest if no deletion or consolidation approval is available. The command remains in repo but not boundary-ready.

### Option E — Request Base44 support / function-limit increase

Safe if platform support can raise the limit or clarify why the app reports 257 functions while deploy reports a 50-function limit.

## 10. Recommended option

Default recommendation:

1. Hold G33C-MIRROR2 live execution.
2. Request Base44 support or approve a dedicated decommission step for `applyStripeEventCleanup`.
3. Do not overload an existing command function.
4. Do not broaden gates.
5. Keep Hub active.

If owner wants the fastest unblock, approve Option A for `applyStripeEventCleanup` deletion and immediate scoped deploy/boundary verification of `createNativeOneTimeShopifyOrderMirrorForCustomerApp`.

## 11. Hard stops before deletion/deploy

Stop if any are true:

- candidate function has an automation marker
- candidate function is referenced by runtime/admin/customer code
- candidate function is payment/webhook/auth/security critical
- owner approval is not exact
- Base44 list/search results changed unexpectedly
- deletion would require Builder Fix All or broad publish
- deploy would require overloading an unrelated command function
- gates would need to be opened
- any live command would run
- any record/log/queue/notification/provider/Hub mutation would occur

## 12. Exact next approval phrase

If owner approves the strongest unblock path, use this exact approval phrase in a future phase:

```text
APPROVE G33C-MIRROR2-PUB2 DELETE applyStripeEventCleanup AND DEPLOY createNativeOneTimeShopifyOrderMirrorForCustomerApp GATES CLOSED ONLY
```

That approval should still not authorize live mirror creation. It authorizes only function-slot deletion, scoped command deploy, gates-closed boundary verification, fresh read-only preview, and no-write verification.

## 13. No-write confirmation

This audit did not:

- delete functions
- rename functions
- deploy functions
- publish Builder
- use Fix All
- open gates
- run live mirror command
- create native ShopifyOrder
- create Customer App Order
- create FulfillmentTask
- create ProductionBatch
- create BatchComplianceLog
- create OrderSyncLog
- create OrderReviewQueue
- create CommandLog
- send notifications
- call Stripe
- call Shopify
- call providers
- mutate Hub records
- mutate live records
