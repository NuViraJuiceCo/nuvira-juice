# Base44 function retirement audit — 2026-08-04

## Outcome

The audit now evaluates **necessity, ownership, overlap, and side effects**, not merely whether code runs. Four cleanup batches reduced the deployed estate from 249 live functions to a proposed canonical estate of **145**. Across the four batches, **104 obsolete live functions** were retired. An additional **13 never-deployed source fragments** were removed from canonical source.

The fourth batch removes 73 more functions after confirming zero canonical callers or a superseding canonical path, zero remaining automation attachments, and zero invocation records in the 30-day Base44 preview log window. The app's separately published production log surface has no recorded function traffic, so current live evidence comes from the active Base44 deployment, UI callers, automation inventory, webhook contracts, and source call graph.

The exhaustive retained-function inventory and retention rationale are in [the required-function manifest](./base44-function-necessity-manifest-2026-08-04.md).

## Current inventory

| Surface | Before audit | After batch 4 |
|---|---:|---:|
| Live Base44 functions | 249 | 145 |
| Canonical source functions | 262 | 145 |
| Obsolete live functions retired | 0 | 104 |
| Never-deployed source fragments retired | 0 | 13 |
| Source-only functions | 13 | 0 |
| Remote-only functions | 0 | 0 |
| Automation-attached functions | 21 | 19 |
| Automation references | 24 | 22 |

The source/live count becomes 145/145 after batch 4 is deployed and the retirement delete is verified.

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

Retired: `redeemMay30EventBonus`, `sendMay30PushTest`, the `/event/may30` route, the expired event page, and the old event check-in card. `processMay30NativeOrderOps` remains because it is a current native order-processing dependency despite its compatibility name.

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

Temporary May 30 compatibility names are distinct from current lifecycle safeguards. The remaining stale names are documented in the manifest and are retained only where current callers still depend on them.

## Verification requirements

Before merging batch 4:

1. Run the G67 retirement regression and all critical regression suites.
2. Run lint and the production Web build.
3. Verify all remaining function names in the required-function manifest exist exactly once.
4. Deploy/delete the 73-function batch only after the two attached legacy automations are archived.
5. Re-run Base44 inventory and confirm source/live parity at 145/145.
6. Re-run the live aggregate loyalty audit and confirm `writes_performed: false` with zero critical exceptions.

## Forward rule

No new customer-specific function, probe, duplicate payment path, or compatibility shell should be deployed. A new function must declare its canonical caller or external contract, unique responsibility, source of truth, side effects, authorization, idempotency, rollback behavior, and the function it replaces.
