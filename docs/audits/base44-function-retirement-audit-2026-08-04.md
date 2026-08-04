# Base44 function retirement audit — 2026-08-04

## Outcome

The Base44 function estate is oversized and contains historical one-off repair commands, an active customer-specific loyalty audit, and source for functions that are not deployed. It is also at the provider's function-slot ceiling. The formerly remote-only `customerJourneyAutomation` endpoint was repurposed during the communication rollout as the required, scheduler-only customer-journey runtime; it is no longer a retirement candidate.

No function or automation was deleted during this audit. The correct next move is a disable-first retirement in small batches with exact caller, automation, webhook, and provider-log verification. Payment, webhook, order lifecycle, Hub, Shopify, push, and current customer-journey protections remain out of deletion scope.

## Current inventory

| Surface | Count | Finding |
|---|---:|---|
| Function directories in source | 262 | Canonical `main` after the dedicated customer-journey runtime rollout |
| Functions reported by Base44 | 249 | Live remote inventory on August 4, 2026 |
| Source-only functions | 13 | Deployment rejects them at the function ceiling; they are not live runtime dependencies |
| Remote-only functions | 0 | Every live function now has canonical source |
| Functions with automation references | 22 | 24 total automation references |

The Base44 deploy sweep completes, but attempts to create the 13 source-only functions return `Maximum of 50 functions per app reached`. This is a real operational ceiling and not a reason to combine unrelated payment, order, or customer-data contracts.

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

These 22 functions have 24 automation references and cannot be deleted until their automation is detached or replaced:

- `auditCustomerAppLoyaltyAfterPhase2` (1)
- `autoExpireZone3Authorizations` (1)
- `cancelAbandonedCheckouts` (1)
- `cancelIncompleteSubscriptions` (1)
- `customerJourneyAutomation` (1)
- `deleteProductFromShopify` (1)
- `enrollNewCustomerInLoyalty` (1)
- `googleMerchantFeed` (1)
- `monitorPostPaymentChain` (1)
- `previewAdminMay30POSProfileCandidates` (1)
- `pushMerchToShopify` (1)
- `pushProductToShopify` (1)
- `retryFailedHubSyncs` (1)
- `sendNotificationCampaign` (1)
- `sendOrderStatusNotification` (2)
- `sendUpcomingDeliveryNotifications` (1)
- `shopifyPollFallback` (1)
- `syncHubDeliveryStatuses` (1)
- `syncOrderToHub` (2)
- `syncProductsToGMC` (1)
- `syncShopifyOrderToHub` (1)
- `syncSubscriptionPlansToHub` (1)

`auditCustomerAppLoyaltyAfterPhase2` is the one clearly incorrect active attachment. Its source audits a fixed historical set of eight people/orders, including Apple private-relay and Amar records, against hard-coded expectations. That is not a system health check. Replace it with an aggregate loyalty-integrity audit, prove the replacement, then detach and retire it.

`previewAdminMay30POSProfileCandidates` has a stale name, but its current implementation is the generic POS rewards-claim workflow. Rename it in a later compatibility-safe change; do not delete it by name.

## Phase 1 retirement candidates

These are high-confidence historical or duplicate live functions. They have no current UI caller or required automation in the canonical source audit. Disable/invoke-block first, observe logs, and then delete in two or three small batches.

| Function | Reason | Prerequisite |
|---|---|---|
| `auditAmarkSubscriptions` | Named-customer diagnostic | Verify no recent manual/provider use |
| `auditLatestStripePaymentForAmark` | Named-customer payment diagnostic | Verify Stripe/operator logs first |
| `canonicalizeAmarkSubscription` | Named-customer repair command | Verify the repair is closed |
| `repairR1DeepaCAPatch` | Named-customer repair command | Verify no pending repair case |
| `repairR2RefundedDuplicatesCA` | Historical fixed repair | Verify no pending repair case |
| `repairR3HenrryCAHydration` | Named-customer repair command | Verify no pending repair case |
| `repairR4SukhwantCAStructure` | Named-customer repair command | Verify no pending repair case |
| `replaySubscriptionRefundDryRun` | Historical refund replay diagnostic | Retain audit evidence; verify no recent invocations |
| `probeHubSubscriptionCancelled` | Historical Hub probe | Verify no runbook references |
| `correctAdminOrderDeliverySchedule` | Superseded delivery correction command | Prove V2/current native correction coverage |
| `correctAdminOrderDeliveryScheduleV2` | Historical correction command now superseded by native schedule correction | Prove current replacement coverage |
| `monitorLiveCheckoutTest` | Launch/test monitor with no production caller | Verify no recent invocations |
| `auditCustomerAppLoyaltyAfterPhase2` | Hard-coded historical loyalty audit | Deploy a real aggregate loyalty audit and detach its automation first |

## Source-only cleanup

These functions exist in source but are not deployed. They cannot currently affect customers, but every broad deploy attempts them, produces slot errors, and obscures real deployment failures:

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

Recommended treatment:

1. Remove one-time commands (`applyStripeEventCleanup`, `executeCustomerAppLoyaltyImportPhase2`, `sendThankYouToLoyaltyMembers`) from active source after preserving their Git history.
2. Do not deploy the nine fragmented loyalty sync functions as-is. First design one authoritative loyalty reconciliation boundary with idempotency, provenance, preview/apply separation, and a single direction of ownership.
3. Search and repair any UI/function callers before source removal. A source-only function name may still reveal a broken caller even though the endpoint itself is absent.

## Repair findings before retirement

### Missing delivery endpoint

`src/components/program/SubscriptionUpsellModal.jsx` invokes `calculateDeliveryZone`, but there is no source or deployed function with that name. `validateDeliveryEligibility` is the supported endpoint. Refactor the modal to its response contract and test Zone 1, Zone 2, Zone 3 review, and ineligible addresses.

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

1. Export the current remote function and automation inventory.
2. Replace the hard-coded loyalty audit and repair the missing delivery endpoint.
3. For each candidate, verify zero canonical source callers, zero active automation references, zero webhook/provider references, and zero recent invocations.
4. Block or disable the smallest candidate batch without deleting source.
5. Observe at least one complete business cycle; use 48 hours for diagnostics and at least one subscription/order cycle for payment-adjacent functions.
6. Run checkout, POS ingestion, points accrual/redemption, order confirmation/status, Hub sync/retry, refund, subscription, push, and customer-account regressions.
7. Delete only the proven batch from Base44 and source. Preserve recovery through Git rather than a second live duplicate endpoint.
8. Re-run the remote/source inventory and confirm broad deploy output contains no unexpected function-slot failures.

## Recommended first batch

After the communication sandbox passes, retire only:

1. `auditAmarkSubscriptions`
2. `auditLatestStripePaymentForAmark`
3. `canonicalizeAmarkSubscription`
4. `repairR1DeepaCAPatch`
5. `repairR2RefundedDuplicatesCA`
6. `repairR3HenrryCAHydration`
7. `repairR4SukhwantCAStructure`

This batch removes seven clearly customer-specific utilities without touching payments, webhook receivers, order status, production, loyalty calculation, push, Hub, Shopify, customer journeys, or lifecycle safeguards. The remaining candidates should follow only after their listed prerequisite is satisfied.
