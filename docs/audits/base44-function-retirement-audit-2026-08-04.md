# Base44 function retirement audit — 2026-08-04

## Outcome

Three verified cleanup batches are complete. Thirty-one obsolete live functions were deleted after zero canonical callers, zero automation attachments, and zero preview/production invocations over the 30-day log window were confirmed. Thirteen source-only loyalty/import fragments were removed from the active tree because they were not deployed and caused broad deploys to emit slot-ceiling failures.

Canonical source and the Base44 remote are now in exact parity at 218 functions: zero source-only functions and zero remote-only functions. The hard-coded eight-customer loyalty audit was replaced in place with a paginated, read-only aggregate integrity audit because the grandfathered app remains above Base44's current function-creation ceiling. Payment, webhook, order lifecycle, Hub, Shopify, push, current customer journeys, consent gates, idempotency controls, current connectivity checks, recovery paths, and lifecycle protections were preserved.

## Current inventory

| Surface | Count | Finding |
|---|---:|---|
| Functions in canonical source | 218 | Active `entry.ts` functions after the verified cleanup |
| Functions reported by Base44 | 218 | Live remote inventory after deletion verification on August 4, 2026 |
| Source-only functions | 0 | Broad deploy no longer attempts dead loyalty/import endpoints |
| Remote-only functions | 0 | Every live function now has canonical source |
| Functions with automation references | 21 | 24 total automation references |

The function-creation ceiling remains real, so the generic loyalty audit retains the historical endpoint name `auditCustomerAppLoyaltyAfterPhase2` for compatibility. Its implementation contains no named customers, fixed emails, fixed orders, or Apple-relay expectations.

## Required live capability map

The following families are required for the current system to flow. Functions in these families remain **keep** unless a separate replacement is deployed and proven first.

| Capability | Required live functions or families |
|---|---|
| Checkout and payment | `createCheckoutSession`, `createPaymentIntent`, `createSubscriptionPaymentElementIntent`, `stripeCustomerPortal`, `stripeWebhook`, `shopifyWebhookReceiver`, `processManualRefund`, `adminCancelAndRefundSubscription`, `capturePreOrderPayments`, Zone 3 authorization/capture functions |
| Order lifecycle and customer status | `sendOrderStatusNotification`, `sendOrderReceivedNotification`, `pollOrderStatusUpdates`, `notifyOrderProcessed`, `getCustomerOrderDetail`, `getCustomerOrdersWithHub`, native order status/update functions, delivery and fulfillment functions |
| Communications | `customerJourneyAutomation`, `sendNotificationCampaign`, `sendCustomerNotification`, `sendCustomerPushNotification`, `registerPushSubscription`, `unregisterPushSubscription`, `resendWebhook`, transactional order/SMS functions |
| Loyalty | `createLoyaltyMember`, `enrollNewCustomerInLoyalty`, `claimReward`, `getCustomerAccountDashboardData`, `verifyCustomerFacingLoyaltyDisplay`, live order-history and profile sources used to calculate points |
| Hub and operations sync | `syncOrderToHub`, `syncShopifyOrderToHub`, `syncOrdersFromHub`, `syncHubDeliveryStatuses`, `retryFailedHubSyncs`, `hubSyncProxy`, `receiveSyncedEvent`, order/subscription/refund sync functions and their manual recovery functions |
| Shopify and catalog | `shopifyWebhookReceiver`, `shopifyPollFallback`, product push/delete/resync functions, `googleMerchantFeed`, `syncProductsToGMC`, `resolveShopifyCartPermalink` |
| Production and fulfillment | current `getAdmin*Summary`, `previewAdminProduction*`, `startAdminProductionBatch`, `completeAdminProductionBatch`, inventory deduction, batch verification, fulfillment-task and delivery functions |
| Security and account | `completeAccountSetup`, `requestAccountDeletion`, `sendUserInvite`, `addressSuggest`, `validateDeliveryEligibility`, account/dashboard read functions |
| Lifecycle safeguards | `previewNativeOrderCutoverReadiness`, native safe-sync previews/executors, `LOCK_FROZEN_FIELDS`, `order_lock_status`, launch cutoffs, consent gates, kill switches, recipient gates and idempotency controls |

The temporary May 30 or named-customer utilities are not the same thing as lifecycle locks. Retiring those utilities must not remove field locks, order lock state, preview/apply boundaries, consent checks, or live-send gates.

## Automation-attached functions

These 21 functions have 24 automation references and cannot be deleted until their automation is detached or replaced:

- `auditCustomerAppLoyaltyAfterPhase2` (1)
- `autoExpireZone3Authorizations` (1)
- `cancelAbandonedCheckouts` (1)
- `cancelIncompleteSubscriptions` (1)
- `customerJourneyAutomation` (2)
- `deleteProductFromShopify` (1)
- `enrollNewCustomerInLoyalty` (1)
- `googleMerchantFeed` (1)
- `monitorPostPaymentChain` (1)
- `previewAdminMay30POSProfileCandidates` (1)
- `pushMerchToShopify` (1)
- `pushProductToShopify` (1)
- `retryFailedHubSyncs` (1)
- `sendOrderStatusNotification` (2)
- `sendUpcomingDeliveryNotifications` (1)
- `shopifyPollFallback` (1)
- `syncHubDeliveryStatuses` (1)
- `syncOrderToHub` (2)
- `syncProductsToGMC` (1)
- `syncShopifyOrderToHub` (1)
- `syncSubscriptionPlansToHub` (1)

`auditCustomerAppLoyaltyAfterPhase2` now runs the replacement aggregate loyalty-integrity audit. The August 4 live verification reported `healthy: true`, zero critical exceptions, one informational legacy balance-cache mismatch, and three profiles whose phone number is unavailable from current profile/order sources. The function is read-only and reports `writes_performed: false`.

`previewAdminMay30POSProfileCandidates` has a stale name, but its current implementation is the generic POS rewards-claim workflow. Rename it in a later compatibility-safe change; do not delete it by name.

## Phase 1 retirement candidates

These were the high-confidence historical or duplicate live functions. The first verified batch has been deleted; remaining rows stay staged until their prerequisites are independently proven.

| Function | Reason | Prerequisite |
|---|---|---|
| `auditAmarkSubscriptions` | Named-customer diagnostic | **Deleted 2026-08-04** |
| `auditLatestStripePaymentForAmark` | Named-customer payment diagnostic | **Deleted 2026-08-04** |
| `canonicalizeAmarkSubscription` | Named-customer repair command | **Deleted 2026-08-04** |
| `repairR1DeepaCAPatch` | Named-customer repair command | **Deleted 2026-08-04** |
| `repairR2RefundedDuplicatesCA` | Historical fixed repair | **Deleted 2026-08-04** |
| `repairR3HenrryCAHydration` | Named-customer repair command | **Deleted 2026-08-04** |
| `repairR4SukhwantCAStructure` | Named-customer repair command | **Deleted 2026-08-04** |
| `replaySubscriptionRefundDryRun` | Historical refund replay diagnostic | **Deleted 2026-08-04** |
| `probeHubSubscriptionCancelled` | Historical Hub probe | **Deleted 2026-08-04** |
| `correctAdminOrderDeliverySchedule` | Superseded delivery correction command | **Deleted 2026-08-04** |
| `correctAdminOrderDeliveryScheduleV2` | Superseded by native schedule correction | **Deleted 2026-08-04** |
| `monitorLiveCheckoutTest` | Active read-only admin checkout monitor | **Keep: `/admin/live-monitor` caller verified** |
| `auditCustomerAppLoyaltyAfterPhase2` | Historical name, now generic implementation | **Keep until the slot ceiling permits a compatibility-safe rename** |

## Source-only cleanup

These 13 functions existed in source but were not deployed. They were removed from the active tree on August 4, 2026; their implementation remains recoverable from Git history:

- `applyStripeEventCleanup`
- `deactivateLoyaltyMembers`
- `executeCustomerAppLoyaltyImportPhase2`
- `manualSyncLoyaltyMember`
- `monitorSubscriptionLoyalty`
- `pushExistingLoyaltyMembersToHub`
- `pushLoyaltyMemberToHub`
- `receivePointsSync`
- `reconcileCustomerLoyalty`
- `sendLoyaltySignup`
- `sendThankYouToLoyaltyMembers`
- `syncLoyaltyFromHub`
- `syncLoyaltyToHub`

No live endpoint was deleted for these source-only names. No canonical UI, automation, or function caller referenced them. Any future loyalty reconciliation must be designed as one authoritative boundary with idempotency, provenance, preview/apply separation, and a single direction of ownership rather than restoring these fragments.

## Repair findings before retirement

### Missing delivery endpoint

`src/components/program/SubscriptionUpsellModal.jsx` was refactored from the nonexistent `calculateDeliveryZone` call to the supported `validateDeliveryEligibility` contract. Subscription eligibility now uses the server's `checkout_allowed`, `allowed_for_subscriptions`, zone, distance, fee, and customer-message fields; the old fixed 15-mile copy was removed. The site build and publish completed successfully.

### Legacy payment endpoints need provider proof

The following have no current canonical frontend callers, but they touch payment/subscription creation and are not deletion-ready from static evidence alone:

- `createSubscriptionSession`
- `createSubscriptionCheckoutHosted`
- `createSubscriptionPaymentIntent`
- `createSubscriptionPaymentIntentV2`
- `sendOrderConfirmation`

Hold them until Stripe, Resend, Base44 invocation, and webhook logs show a full observation window with no traffic and the current replacement path is proven end to end.

### Old cleanup documents are stale

`docs/migration/g33c-mirror2-base44-function-slot-unblock-audit.md`, `src/CLEANUP_PLAN_PHASE_4-5_BATCHED_EXECUTION.md`, and `src/FUNCTION_BACKUP_ARCHIVE.md` describe older inventories. Some functions they describe as deleted or differently classified are still live. This audit supersedes their counts, but their rollback/history notes remain useful.

## Retirement sequence

1. **Completed:** export the current remote function and automation inventory.
2. **Completed:** replace the hard-coded loyalty audit and repair the missing delivery endpoint.
3. **Completed for the first batch:** verify zero canonical source callers, zero active automation references, and zero preview/production invocations over 30 days.
4. **Completed:** run the cleanup-specific test, lint, production build, and all critical regression suites.
5. **Completed:** delete only the proven batch from Base44 and source while preserving recovery in Git history.
6. **Completed:** re-run the remote/source inventory and prove exact 218/218 parity.
7. **Remaining:** observe payment-adjacent and operational recovery candidates for at least one complete order/subscription cycle before another deletion batch.

## Completed first batch

Deleted from Base44 and canonical source on August 4, 2026:

1. `auditAmarkSubscriptions`
2. `auditLatestStripePaymentForAmark`
3. `canonicalizeAmarkSubscription`
4. `repairR1DeepaCAPatch`
5. `repairR2RefundedDuplicatesCA`
6. `repairR3HenrryCAHydration`
7. `repairR4SukhwantCAStructure`

`verifyCustomerFacingLoyaltyDisplay` was also deleted because it was a second hard-coded historical loyalty verifier with zero caller, automation, or 30-day invocation evidence and is superseded by the aggregate audit.

## Completed second batch

Deleted from Base44 and canonical source on August 4, 2026 after the same 30-day, caller, and automation checks:

1. `replaySubscriptionRefundDryRun`
2. `probeHubSubscriptionCancelled`
3. `correctAdminOrderDeliverySchedule`
4. `correctAdminOrderDeliveryScheduleV2`

The two schedule correctors are superseded by `executeNativeOrderScheduleCorrection`, which is the endpoint used by the active Delivery Queue. `monitorLiveCheckoutTest` remains live because `/admin/live-monitor` is an active caller.

## Completed third batch

Deleted from Base44 and canonical source on August 4, 2026 after caller, automation, and 30-day invocation checks:

- fixed-customer subscription audits: `auditNewSubscriptions`, `auditStabilizationRepair`, `auditSubscriptionFulfillments`, and `auditSubscriptionPayloadToHub`
- obsolete audit/debug endpoints: `auditStripeAndIntegrationInventory`, `stabilizationDiagnostic`, `debugAndRetryHubSync`, and `debugHubSyncPayload`
- legacy payment diagnostics: `diagnosePiConfig`, `inspectPaymentIntent`, `listRecentPIs`, `verifyLiveSubscriptionSmoke`, and `verifyStripeLiveMode`
- deprecated sync shells: `manualPushOrderToHub`, `manualSyncOrders`, `manualSyncSubscription`, and `manualSyncSubscriptionOrders`
- obsolete live test/mutation endpoints: `auditWindow3Orders` and `testSchedulingLogic`

`auditWindow3Orders` was especially misleading: despite its audit name, it could directly update order scheduling fields after a Saturday threshold. The current scheduling and controlled recovery paths remain in place.

This cleanup removed thirty-one obsolete live functions and thirteen never-deployed source fragments without touching payments, webhook receivers, order status, production, loyalty calculation, push, active Hub/Shopify sync, customer journeys, or lifecycle safeguards. Lint, production build, the G67 cleanup suite, and all 42 critical regression suites passed. Remaining payment-adjacent or recovery candidates stay live until their specific replacement and observation requirements are proven.
