# G23A Base44 Security Hardening Audit

Date: 2026-06-04

## Scope

G23A targets baseline Base44 publish-preflight findings that were confirmed in G22N as not introduced by G22M. The native safeSync writer remains disabled for real orders. This audit intentionally avoids Base44 "Fix All" and avoids broad migration/runtime cleanup.

## Classification Key

- A: introduced by current PR; must patch before publish.
- B: existing baseline P0 security blocker; patch before publish or hold.
- C: existing baseline advisory; defer.
- D: existing baseline requiring later targeted security PR.
- E: false positive or accepted platform advisory.
- PBP: public but protected by signature/secret or deliberate public read model.

## Current Patch Group: G23A1

G23A1 patches only clear high-value auth gaps:

- `syncRefundToHub`: require admin session or existing internal sync secret before reading an order or delegating to Hub.
- `stripeWebhook`: pass the existing internal secret header when invoking `syncRefundToHub` from `charge.refunded`.
- `processManualRefund`: pass the existing internal secret header when invoking `syncRefundToHub`.
- `stabilizationDiagnostic`: require admin session before service-role reads.
- `repairLiveSubscriptionFailure`: preserve disabled default, add admin session requirement before Stripe repair logic if the legacy flag is ever enabled.
- `reconcileCustomerLoyalty`: preserve disabled default, add admin session requirement before loyalty reconciliation if the feature flag is ever enabled.

## Finding Inventory

| Finding | Classification | Current behavior | G23A action |
| --- | --- | --- | --- |
| `Merch` missing RLS | D | Customer-facing catalog read appears intentional; writes should be admin-only like `Product`/`Bundle`. | Defer to G23A2 schema PR: public read, admin create/update/delete. |
| `RewardTier` missing RLS | D | Customer-facing rewards read appears intentional; writes should be admin-only like `SubscriptionPlan`. | Defer to G23A2 schema PR: public read, admin create/update/delete. |
| VAPID fallback in `sendCustomerPushNotification` | D | Public key fallback only; private key remains env-only. | Defer to push-specific PR: env-only public key with nonblocking push failure. |
| VAPID fallback in `redeemMay30EventBonus` | D | Public key fallback only; private key remains env-only. | Defer to push-specific PR: env-only public key with nonblocking push failure. |
| VAPID warning for `sendAdminPushTestNotification` | C | Admin-authenticated test path; no private key fallback found. | Document as baseline scanner carryover; verify in push PR. |
| VAPID warning for `unregisterPushSubscription` | C | Customer-authenticated unsubscribe path; no VAPID private key exposure. | Document as baseline scanner carryover; verify ownership hardening later. |
| `assignDeliveryWindow` unauthenticated warning | D | Pure scheduling calculator; no service-role reads/writes found. | Defer until call-site contract is clarified to avoid breaking checkout/scheduling. |
| `assignProductionWindow` unauthenticated warning | D | Pure scheduling calculator; no service-role reads/writes found. | Defer until call-site contract is clarified to avoid breaking checkout/scheduling. |
| `claimReward` unauthenticated warning | C | Requires `base44.auth.me()` before user reward mutation; Hub call uses server secret. | No G23A1 patch. |
| `completeAccountSetup` unauthenticated warning | C | Requires `base44.auth.me()` before account update. | No G23A1 patch. |
| `previewNativeFulfillmentTaskLifecycle` unauthenticated warning | D | Dry-run preview, POST-only, no live mutation expected. | Defer: add admin/read-preview auth after confirming test harness use. |
| `previewNativeProductionBatchLifecycle` unauthenticated warning | D | Dry-run preview, POST-only, no live mutation expected. | Defer: add admin/read-preview auth after confirming test harness use. |
| `previewNativeSafeSyncDarkLaunchComparison` unauthenticated warning | D | Dry-run comparison harness, POST-only, no live mutation expected. | Defer: add admin/read-preview auth after confirming fixture runner use. |
| `reconcileCustomerLoyalty` unauthenticated warning | B | Disabled by default, but if flag enabled it can mutate loyalty data. | Patched in G23A1 with admin gate after disabled guard. |
| `repairLiveSubscriptionFailure` unauthenticated warning | B | Disabled by default, but if flag enabled it can call Stripe and repair records. | Patched in G23A1 with admin gate after disabled guard. |
| `repairR1DeepaCAPatch` unauthenticated warning | C | Disabled by default and already admin-gated after disabled guard. | No G23A1 patch. |
| `repairR2RefundedDuplicatesCA` unauthenticated warning | C | Disabled by default and already admin-gated after disabled guard. | No G23A1 patch. |
| `repairR3HenrryCAHydration` unauthenticated warning | C | Disabled by default and already admin-gated after disabled guard. | No G23A1 patch. |
| `repairR4SukhwantCAStructure` unauthenticated warning | C | Disabled by default and already admin-gated after disabled guard. | No G23A1 patch. |
| `sendUpcomingDeliveryNotifications` unauthenticated warning | D | Disabled by default, but if enabled could send notifications from a public call. | Defer to notification-specific PR to preserve scheduler semantics. |
| `stabilizationDiagnostic` unauthenticated warning | B | Service-role diagnostic reads were public. | Patched in G23A1 with admin gate. |
| `syncOrderToHub` unauthenticated warning | PBP | Public bridge endpoint with no native writer enabled; existing bridge fallback remains required. | No G23A1 patch; keep separate from migration/runtime behavior. |
| `syncProductsToGMC` unauthenticated warning | D | Disabled by default, but if enabled could call Google Merchant APIs. | Defer to provider-sync hardening PR with scheduler/admin contract. |
| `syncRefundToHub` unauthenticated warning | B | Active helper could be directly called to read an order and delegate refund sync. | Patched in G23A1 with admin/internal auth gate. |
| `syncRepairedSubscriptionToHub` unauthenticated warning | C | Already requires auth/admin and legacy payment/subscription flag. | No G23A1 patch. |
| `syncShopifyOrderToHub` unauthenticated warning | C | Already requires admin or internal sync secret. | No G23A1 patch. |
| `syncStuckOrdersPollerManual` unauthenticated warning | C | Disabled by default and already admin-gated after disabled guard. | No G23A1 patch. |
| `syncSubscriptionWithFulfillments` unauthenticated warning | C | Requires admin auth or exact internal secret header; anonymous calls fail. | No G23A1 patch. |
| `syncUserToHub` unauthenticated warning | C | Requires logged-in user and syncs that user only. | No G23A1 patch. |
| `testSchedulingLogic` unauthenticated warning | C | Already admin-gated. | No G23A1 patch. |
| `unregisterPushSubscription` unauthenticated warning | D | Requires auth, but ownership/selector hardening should be reviewed separately. | Defer to push-specific auth/privacy PR. |
| `updateAdminOpsAlertStatus` unauthenticated warning | C | Requires admin auth before update. | No G23A1 patch. |
| `updateAdminProductCatalogItem` unauthenticated warning | C | Requires admin auth before update. | No G23A1 patch. |
| X-Frame-Options recommendation | E | Platform/header recommendation; no app-level control found in this pass. | Defer to Base44/platform support or hosting-level header review. |

## Deferred PRs

1. G23A2: `Merch` and `RewardTier` RLS schema patch.
2. G23A3: Push/VAPID cleanup and `unregisterPushSubscription` ownership review.
3. G23A4: Provider/scheduler auth contracts for notification and Google Merchant functions.
4. G23A5: Preview helper auth policy once fixture/test harness use is confirmed.

## Hard Stops Preserved

- No native safeSync writer enablement.
- No live safeSync writer call.
- No Stripe, Shopify, provider, notification, sync, retry, or repair run.
- No live business record mutation.
- No Base44 "Fix All".
