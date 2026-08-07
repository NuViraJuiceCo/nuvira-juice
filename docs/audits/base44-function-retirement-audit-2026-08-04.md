# Base44 function retirement audit — 2026-08-04

## Outcome

The audit now evaluates **necessity, ownership, overlap, and side effects**, not merely whether code runs. The cleanup reduced the deployed estate from 249 live functions to a verified canonical estate of **141**. In total, **108 obsolete live functions** were retired. An additional **13 never-deployed source fragments** were removed from canonical source.

The fourth batch removes 73 more functions after confirming zero canonical callers or a superseding canonical path, zero remaining automation attachments, and zero invocation records in the 30-day Base44 preview log window. The app's separately published production log surface has no recorded function traffic, so current live evidence comes from the active Base44 deployment, UI callers, automation inventory, webhook contracts, and source call graph.

The exhaustive retained-function inventory and retention rationale are in [the required-function manifest](./base44-function-necessity-manifest-2026-08-04.md).

## Current inventory

| Surface | Before audit | Current verified production |
|---|---:|---:|
| Live Base44 functions | 249 | 141 |
| Canonical source functions | 262 | 141 |
| Obsolete live functions retired | 0 | 108 |
| Never-deployed source fragments retired | 0 | 13 |
| Source-only functions | 13 | 0 |
| Remote-only functions | 0 | 0 |
| Automation-attached functions | 21 | 19 |
| Automation references | 24 | 22 |

The source/live count is **141/141** after deployment and verified retirement deletion.

## Necessity standard

A retained function must have at least one of these responsibilities:

1. A current customer or operations UI caller.
2. An active automation with a necessary business outcome.
3. An authenticated Hub, Shopify, Resend, Stripe, GMC, driver, or webhook contract.
4. A canonical customer lifecycle action or provider recovery path.
5. A required admin read model or explicit operational command.
6. A controlled preview/apply, exact-allowlist, idempotency, rollback, or historical recovery boundary.

The following are not sufficient reasons to keep a function: it compiles, it returns success, it was used during launch, it may be useful someday, it contains a feature gate, or it appears in an old migration document.

## Fourth-batch removals

### Duplicate checkout and payment paths

The app now has one one-time checkout path and one subscription checkout path:

- one-time orders: `createPaymentIntent`
- subscriptions: `createSubscriptionPaymentElementIntent`

Retired duplicates: `createCheckoutSession`, `createSubscriptionSession`, `createSubscriptionCheckoutHosted`, `createSubscriptionPaymentIntent`, `createSubscriptionPaymentIntentV2`, `sendOrderConfirmation`, `capturePreOrderPayments`, and `pushSubscriptionPlanToStripe`.

`stripeWebhook`, `sendOrderReceivedNotification`, `notifyOrderProcessed`, `sendOrderStatusNotification`, `sendOrderSms`, and `syncSubscriptionWithFulfillments` remain the canonical post-payment lifecycle.

### Legacy repair, diagnostic, and recovery chains

Retired: `refundFlowDiagnostic`, `repairFulfillmentTaskAssignedDeliveryDates`, `repairLiveSubscriptionFailure`, `repairLiveSubscriptionV2`, `repairMissingSubscriptionForPaidInvoice`, `retryRepairedSubscriptionHubSync`, `syncRepairedSubscriptionToHub`, `syncStuckOrdersPollerManual`, `detectStuckOrders`, `recoverStuckOrder`, `retryFailedDriverSync`, `pushOrderStatusToHub`, `reconcileDeliveredOrders`, and `verifyOutForDeliveryNotification`.

Current health and recovery are handled by `getAdminSyncHealthSummary`, `retryFailedHubSyncs`, `syncHubDeliveryStatuses`, exact historical preview/apply controls, the Delivery Queue lifecycle commands, and idempotent provider webhooks.

### Superseded scheduling and admin utilities

Retired: `adminDashboardData`, `assignDeliveryWindow`, `assignProductionWindow`, `evaluateSaturdayThreshold`, `getWindow3Status`, `correctAdminProductionBatchStaffOnDuty`, `previewAdminNonSubscriptionBottledCascadeCandidates`, `previewAdminSubscriptionFulfillmentProductionStatus`, `markAdminHubOrderDeliveredForCustomerAppSync`, `findCustomerOrders`, `findCustomerSubscriptions`, `getCustomerOrdersWithHub`, and `sendUserInvite`.

Current schedule ownership is `calculateNuViraFulfillmentSchedule` plus the previewed `executeNativeOrderScheduleCorrection` path. Current customer reads come from `getCustomerAccountDashboardData` and `getCustomerOrderDetail`. Current delivery actions come from the Delivery Queue functions.

### Disabled compatibility shells and inaccurate legacy sync

Retired: `generateSubscriptionOrders`, `syncAllSubscriptionsFromHub`, `syncSubscriptionFromHub`, `syncOrdersFromHub`, `ingestCustomerAppOrderManual`, `hubToCustomerAppStatusSync`, `syncEventToHub`, `receiveSyncedEvent`, `hubSyncProxy`, and `getLoyaltyDataForSync`.

`getLoyaltyDataForSync` was especially unsafe to retain because it exported the legacy `LoyaltyMember` cache rather than the authoritative `UserPoints` balance now used by customer and admin surfaces.

### Expired May 30 event surface

Retired: `redeemMay30EventBonus`, `sendMay30PushTest`, the expired event route, page, event check-in card, and the separate event-era order processor. Native paid-order processing is consolidated inside `syncOrderToHub`.

### Superseded native migration commands

Retired writer/migration endpoints with no current UI, automation, external contract, or 30-day invocation evidence:

- `bottleNativeProductionShopifyOrderForCustomerApp`
- `completeNativeProductionBatchesForCustomerApp`
- `correctNativeScheduleExceptionForCustomerApp`
- `createNativeOneTimeFulfillmentTaskMirrorForCustomerApp`
- `createNativeOneTimeShopifyOrderMirrorForCustomerApp`
- `createNativePartialRefundReviewQueueForCustomerApp`
- `createNativeSubscriptionOccurrenceShopifyOrderMirrorForCustomerApp`
- `executeNativeFulfillmentTaskMetadataRepair`
- `importNativeProductionMasterDataForCustomerApp`
- `materializeNativeProductionBatchesForCustomerApp`
- `packNativeProductionFulfillmentTaskForCustomerApp`
- `startNativeProductionBatchesForCustomerApp`
- `updateNativeCustomerOrderDeliveredStatusForCustomerApp`
- `updateNativeCustomerOrderStatusForCustomerApp`
- `verifyNativeProductionBatchesForCustomerApp`

The corresponding current operations pages, read-only previews, and generalized production/delivery lifecycle commands remain. Standalone migration-only previews `previewNativeFulfillmentTaskMetadataRepair`, `previewNativeCustomerDeliveredStatusImpact`, and `previewNativeSafeSyncParityHarness` were also retired because they had no current caller or external contract.

### Shopify and Hub cleanup

Retired: `deleteProductFromShopify`, `shopifyBulkPushProducts`, `shopifyFulfillOrder`, `syncMerchToShopify`, `syncSubscriptionPlansToHub`, `verifyHubEndpointReachability`, and `verifyShopifyAuth`.

The destructive Product-delete automation and the disabled SubscriptionPlan-to-Hub automation were turned off and archived before their functions were removed. Current Shopify ownership remains with the signed webhook receiver, explicit product/merch push functions, controlled resync recovery, and the order poll fallback.

## Preserved safeguards

The cleanup did not remove:

- Stripe or Shopify webhook receivers
- canonical one-time or subscription payment creation
- consent, unsubscribe, recipient, or idempotency controls
- customer order, loyalty, account, push, or notification reads
- active Hub/Shopify/GMC pull, push, poll, or retry contracts
- current production, fulfillment, delivery, compliance, or admin read models
- exact allowlists, kill switches, `LOCK_FROZEN_FIELDS`, `order_lock_status`, preview/apply separation, rollback evidence, or lifecycle locks

Temporary event compatibility names were removed or consolidated. Current lifecycle safeguards remain distinct and preserved.

## Verification completed

1. G67 retirement regression and the complete critical regression harness pass.
2. The production Web build passes and the published asset contains the consolidated callers.
3. Every retained function in the required-function manifest exists exactly once.
4. Replacement functions were deployed and read back before obsolete endpoints were deleted.
5. Base44 inventory confirms source/live parity at 141/141 with 19 automation-attached functions and 22 automation references.
6. No provider calls, customer notifications, or live data mutations were used for cleanup verification.

## Forward rule

No new customer-specific function, probe, duplicate payment path, or compatibility shell should be deployed. A new function must declare its canonical caller or external contract, unique responsibility, source of truth, side effects, authorization, idempotency, rollback behavior, and the function it replaces.
