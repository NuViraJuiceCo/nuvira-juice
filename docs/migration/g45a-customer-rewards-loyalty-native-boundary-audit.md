# G45A: Customer Rewards/Loyalty Native Boundary Audit

## 1. Executive summary

G45A is a docs-only/static/read-only audit of the customer Rewards/Loyalty page and related loyalty backend paths after G43D-SCAN5.

Current customer order-surface state remains unchanged:

- G43B customer order-history allowlist: `NV-MQHJR3V2`, `NV-MPZNKGNT`.
- G43C OrderTracker allowlist: `NV-MQHJR3V2`.
- G43D-SCAN5 classification: `customer_order_surface_scan_complete_tracker_candidates_only`.
- No G43E/G43F automatic customer-order eligibility should start from the current evidence.

Rewards/Loyalty is not fully migrated. The customer `/rewards` page is already mostly native-read driven for displayed balances because it reads `UserPoints` through `getCustomerAccountDashboardData` and reads active `RewardTier` rows directly. However, several loyalty write and synchronization paths still depend on Hub, Stripe/payment webhooks, subscription repair tools, POS/order identity, local browser state, and legacy/import/reconciliation functions.

The safe conclusion is:

- Do not call Rewards/Loyalty fully migrated yet.
- Do not switch loyalty point balance source-of-truth without parity proof.
- Proceed next with a read-only native/Hub loyalty parity preview.
- Keep redemption, manual adjustments, refunds, subscriptions, POS, notifications, and Hub write suppression held.

No runtime code, schema, UI, Base44 publish, live data, provider, notification, Hub, sync, repair, replay, reward redemption, or points mutation is included in G45A.

## 2. Customer rewards page data path

### Customer-facing page inventory

| Surface | File path | Backend/function path | Native entities read | Hub/static/local source | Customer-visible fields | Current classification |
|---|---|---|---|---|---|---|
| Rewards page | `src/pages/Rewards.jsx` | `getCustomerAccountDashboardData`; direct `RewardTier.filter({ is_active: true })`; `claimReward` on non-product reward apply | `UserPoints` via dashboard; `RewardTier` direct; `Subscription` in reward validation for `free_delivery` | `DEFAULT_REWARDS` fallback in page; active reward in `localStorage`; Hub sync attempted by `claimReward` | total/lifetime/redeemed points, tier/progress, reward cards, activity/history, birthday reward state, referral link | `native_read_partial`, `customer_facing_held` for writes |
| Account rewards summary | `src/pages/Account.jsx` | `getCustomerAccountDashboardData` | Dashboard loads `UserPoints`, but Account currently shows a Rewards quick link rather than point balance | None for displayed rewards link | Rewards link, not balance details | `native_read_partial` |
| Reward validation helper | `src/lib/rewardManager.js` | `getCustomerAccountDashboardData`; direct `Subscription.filter` for `free_delivery` | `UserPoints`, `Subscription` | active reward in `localStorage` | Valid/invalid active reward state in Cart/Rewards | `native_read_partial` |
| Cart active reward banner | `src/pages/Cart.jsx` | `validateActiveReward` helper | Dashboard-derived `UserPoints`; `Subscription` for free delivery validation | active reward in `localStorage` | active reward banner, birthday reward banner | `customer_facing_held` for actual redemption authority |
| Checkout points/reward/referral display | `src/pages/Checkout.jsx` | direct `UserPoints.filter`; checkout/payment functions | `UserPoints` direct read | active reward in `localStorage`; referral code client-side literal `NuVira26` | points discount, active reward discount/free delivery, referral discount | `customer_facing_held`, `refund_payment_governed` |
| Referral page | `src/pages/Referral.jsx` | `base44.integrations.Core.SendEmail` only | None for ledger/referral records | static referral code `NuVira26`; static reward text | code, invite form, milestone copy | `static_catalog`, `customer_facing_held` |
| Admin loyalty members | `src/pages/admin/LoyaltyMembers.jsx` | `getAdminLaunchReadOnlySummary` with `resource: loyalty_members` | `LoyaltyMember` read-only summary | None | admin-safe member rows including email/phone, points | `native_read_partial`, admin-only |

### Current customer data path finding

`/rewards` is mixed native/static/Hub-adjacent:

1. Logged-in page calls `getCustomerAccountDashboardData`.
2. `getCustomerAccountDashboardData` authenticates the current user, resolves identity aliases, and loads the first matching `UserPoints` record across resolved customer emails.
3. The page reads `points_record.total_points`, `points_record.lifetime_points`, `points_record.redeemed_points`, and `points_record.points_history` from that dashboard response.
4. Reward catalog comes from public-read `RewardTier` rows when present; otherwise `Rewards.jsx` falls back to hardcoded `DEFAULT_REWARDS`.
5. Tier/progress copy is currently calculated in the page from hardcoded `TIERS`, not from a native tier ledger or Hub tier status.
6. Non-product reward apply calls `claimReward`, stores active reward data in browser `localStorage`, and later checkout reads that local value.
7. Product rewards (`free_shot`, `free_bottle`) open a product picker and add a zero-price cart item locally rather than proving an authoritative redemption record first.
8. Referral is static/manual: `Referral.jsx` generates `NuVira26`, sends a referral invite email to the business inbox, and says rewards are manually applied after verification.

The customer data can update without a Builder publish when `UserPoints` or `RewardTier` records change, because those are runtime entity reads. A Builder/UI publish affects page code, local fallback reward definitions, and display behavior, not the underlying `UserPoints` values.

## 3. Loyalty domain inventory

| # | Domain | Current source of truth | Native coverage | Hub dependency | Read-capable | Write-capable | Customer-facing | Admin-facing | Gates/idempotency | Dependencies | Known gaps | Classifications |
|---:|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Points balance | `UserPoints.total_points` is displayed; Hub/import/webhook paths also write | `UserPoints` stores direct balance | Hub sync/import and legacy bridge can overwrite or append | Yes | Yes, many paths | Yes | Yes | Mixed; some history idempotency checks, no single balance authority | refunds, checkout, subscription, Hub | no parity proof that balance can be fully reproduced | `native_read_partial`, `hub_fallback_active`, `blocked_by_missing_ledger` |
| 2 | Points ledger/history | `UserPoints.points_history` array | Embedded array, not separate immutable ledger | Hub can push/import history | Yes | Yes | Recent activity shown | Admin/debug tools | inconsistent idempotency keys; array updates | replay/repair, refunds, subscription | not append-only; no global unique transaction entity | `native_read_partial`, `blocked_by_missing_ledger`, `blocked_by_missing_idempotency` |
| 3 | Points earned from one-time orders | Stripe webhook/order payment paths append points | `UserPoints` writes in `stripeWebhook` | Hub sync/order sync still active | Yes | Yes | Indirect via balance/history | Operational logs | duplicate checks use descriptions/order refs in places | Stripe/order identity/refunds | not separated from checkout/payment side effects | `refund_payment_governed`, `native_write_ungated` |
| 4 | Points earned from subscriptions | Stripe/subscription paths and repair tools append points | `UserPoints` writes in subscription-related functions | Hub/subscription tools active | Yes | Yes | Indirect | Admin/repair | some duplicate checks by subscription text | Stripe subscription, occurrence identity | occurrence-level parity not proven for loyalty | `subscription_governed`, `repair_replay_governed` |
| 5 | Refund/cancellation point reversals | Refund/manual/Stripe paths | `UserPoints` adjusted in refund paths | `syncRefundToHub` and Hub remain involved | Yes | Yes | Indirect | Admin/repair | inconsistent by path; full/partial distinction | payment/refund authority | reversal policy not native-authoritative | `refund_payment_governed`, `customer_facing_held` |
| 6 | Manual/admin point adjustments | `reconcileCustomerLoyalty`, manual sync/import/repair functions | `UserPoints`/`LoyaltyMember` writes | Hub import/export/manual push functions | Yes | Yes | No direct customer action | Yes | disabled gates on several tools | admin approval, Hub | broad recalculation can reset redeemed points | `repair_replay_governed`, `blocked_by_owner_policy` |
| 7 | Reward catalog | `RewardTier` if active rows exist; `DEFAULT_REWARDS` fallback | `RewardTier` public read | None required for display | Yes | Admin schema only | Yes | Admin via entity management | no versioned terms | inventory/tier/policy | UI fallback reward types differ from schema enum | `native_read_partial`, `static_catalog` |
| 8 | Reward redemption | `claimReward` plus checkout/local cart behavior | `UserPoints.claimed_rewards` updated | `claimReward` attempts Hub reward-claim POST | Yes | Yes | Yes | Logs/functions | duplicate only by `reward_id`; no balance deduction there | Hub, checkout, localStorage | missing owner check on submitted email; no authoritative balance deduction in `claimReward` | `hub_write_primary`, `blocked_by_missing_boundary`, `blocked_by_missing_idempotency` |
| 9 | Redemption fulfillment/application | Checkout/cart local reward and payment functions | checkout payload stores active reward/discount | Hub/order/payment sync active | Yes | Yes via checkout/payment | Yes | Admin/payment logs | tied to checkout idempotency | Stripe, order creation | redemption terms not versioned; localStorage not authority | `refund_payment_governed`, `customer_facing_held` |
| 10 | Loyalty tiers | Display calculated from hardcoded `TIERS` | no separate tier state entity | None for display | Yes | No direct tier write from page | Yes | Not authoritative | none | balance | tier source differs from RewardTier catalog | `static_catalog`, `native_read_partial` |
| 11 | Tier progress | Calculated client-side from balance | `UserPoints.total_points` only | None for display | Yes | No | Yes | No | none | balance | no authoritative tier progression ledger | `native_read_partial`, `customer_facing_safe` for display only |
| 12 | Referral rewards | Static/manual process | `Order.referral_code` captures code; no referral ledger entity found | manual/business process; Hub/order sync | Limited | checkout/payment writes referral_code | Yes | Manual | client-side literal code; webhook de-dupes repeat use per customer | checkout/order/payment | no attribution ledger/fraud prevention | `static_catalog`, `blocked_by_missing_ledger` |
| 13 | POS loyalty | POS/admin order functions exist; no proven loyalty parity for POS | `UserPoints` may be impacted by order/payment flows | Hub/POS source still active | Partial | Possible via payment/order sync | Indirect | Yes | not proven | POS identity/order import | POS point posting not isolated | `pos_governed`, `customer_facing_held` |
| 14 | Expiration policy | Not found as authoritative entity/policy | None found | Unknown/manual | No | No | Could be implied in UI copy only | No | none | reward terms | expiration/versioning missing | `blocked_by_schema_gap` |
| 15 | Repair/replay/backfill | multiple repair/import/reconcile functions | `UserPoints`, `LoyaltyMember` writes | Hub import/export active or gated | Yes | Yes | No direct | Yes | gates vary | Hub, Stripe, subscriptions | not safe for automatic customer page authority | `repair_replay_governed` |
| 16 | Customer notifications | enrollment and some flows create notifications/send email | `Notification` writes in enrollment; Resend email in signup | provider/email | Read via dashboard notification count | Yes | Yes | Admin | nonblocking creates | provider/notification | not part of native read migration | `notification_policy_held` |
| 17 | Admin loyalty visibility | `getAdminLaunchReadOnlySummary` | `LoyaltyMember` read summary | None for current admin page | Yes | No in page | No | Yes | admin auth | PII/admin-only | no UserPoints/Hub mismatch diagnostics | `native_read_partial`, `customer_facing_safe` only because admin-only |
| 18 | Hub loyalty sync/import/export | `syncLoyaltyFromHub`, `syncLoyaltyToHub`, `receivePointsSync`, import/push tools | `UserPoints`/`LoyaltyMember` cache | Hub primary for several sync paths | Yes | Yes | Indirect | Admin/service | several May 30 gates/legacy flags | Hub secret, external endpoints | not suppressed; not parity-proven | `hub_write_primary`, `hub_fallback_active`, `repair_replay_governed` |

## 4. Source-of-truth map

| Data | Current observed source | Notes | Migration posture |
|---|---|---|---|
| Customer displayed available points | `UserPoints.total_points` via `getCustomerAccountDashboardData` | Dashboard resolves identity aliases and uses the first matching points record. | Native-read partial; not authoritative for cutover until parity is proven. |
| Lifetime/redeemed points | `UserPoints.lifetime_points`, `UserPoints.redeemed_points` | Direct stored counters; not guaranteed reproduced from immutable ledger. | Held. |
| Recent rewards activity | `UserPoints.points_history` | Embedded array shown in `/rewards`; no separate ledger entity found. | Held for authority; usable as display-only current contract. |
| Reward catalog | `RewardTier` active rows, fallback to `DEFAULT_REWARDS` | Public read schema; fallback means UI can display static catalog if native rows missing. | Native-read partial; catalog parity needed. |
| Tier/progress | Hardcoded `TIERS` in `Rewards.jsx`, computed from available points | Not sourced from `RewardTier` or a tier entity. | Static display; not authoritative tier policy. |
| Active reward | Browser `localStorage` key `activeReward_<email>` plus `claimReward` best-effort write | Local state is customer-visible but not an authoritative redemption ledger. | Held. |
| Reward claim record | `UserPoints.claimed_rewards` updated by `claimReward` | `claimReward` also attempts Hub sync. | Write path requires boundary/idempotency hardening. |
| Checkout reward/points application | Checkout reads `UserPoints`, `localStorage` active reward, referral code, then payment functions/webhooks adjust state | Payment authority and webhook idempotency govern. | Refund/payment governed. |
| Referral code | Static `NuVira26` in UI; `Order.referral_code` in checkout/order | No referral attribution ledger found. | Manual/static; not native-authoritative. |
| Admin loyalty member list | `LoyaltyMember` via `getAdminLaunchReadOnlySummary` | Separate from `UserPoints`; may not match displayed rewards balance. | Admin-read partial. |
| Hub loyalty state | Hub import/export/sync endpoints and service-secret functions | Some functions disabled by gates; some enrollment paths call Hub first. | Hub fallback/source-of-truth hold remains active. |

## 5. Points balance and ledger audit

### Findings

- The displayed customer point balance comes from `getCustomerAccountDashboardData` -> `UserPoints.filter({ customer_email })` across resolved identity emails.
- `UserPoints` stores direct counters (`total_points`, `lifetime_points`, `redeemed_points`) plus embedded `points_history` and `claimed_rewards` arrays.
- `LoyaltyMember` is a separate entity with similar point fields and admin visibility, but `/rewards` does not read `LoyaltyMember` directly.
- A separate immutable ledger entity was not found. The ledger-like data is an array field embedded on `UserPoints`.
- Balance is stored directly, not derived at read time from a canonical immutable ledger.
- Hub and native balances can differ because Hub import/export, event bridge, manual sync, enrollment, webhook, and repair functions can all create/update native points state under different policies.
- Order points are written natively in Stripe/payment webhook paths, but this is payment-governed and intertwined with checkout/order creation.
- Refund/cancellation reversals exist in manual and webhook paths, but policy is not sufficiently isolated to declare native balance authoritative.
- Subscription points are governed by Stripe/subscription functions and repair tools; occurrence-level loyalty parity is not proven here.
- POS points are not proven as a separate native-authoritative domain.
- Manual adjustments/reconciliation are broad and gated; `reconcileCustomerLoyalty` can recalculate balances and reset redeemed points in its current design if enabled.
- Duplicate prevention exists in some webhook/subscription paths through history text/order/subscription checks, but no single global transaction/idempotency key is enforced across every points writer.

### Source-of-truth rule

Do not make native points authoritative until balance can be reproduced from safe ledger/audit evidence or another proven authoritative native source. For now, the native `UserPoints` record is the current customer display source, not a proven cutover source-of-truth.

Classifications:

- `native_read_partial`
- `hub_fallback_active`
- `refund_payment_governed`
- `subscription_governed`
- `pos_governed`
- `repair_replay_governed`
- `blocked_by_missing_ledger`
- `blocked_by_missing_idempotency`

## 6. Reward catalog audit

Reward definitions come from two places:

1. `RewardTier` rows where `is_active: true`, sorted by `sort_order`.
2. `DEFAULT_REWARDS` hardcoded in `src/pages/Rewards.jsx` when no active `RewardTier` rows are returned.

Important gaps:

- `RewardTier` is public-read and admin-write by RLS. It is suitable for customer catalog display, but catalog versioning/terms are not modeled.
- `DEFAULT_REWARDS` uses reward types such as `free_shot`, `double_points`, `discount_10pct`, `bundle_upgrade`, and `vip_box`; the `RewardTier` schema enum uses `free_bottle`, `discount`, `free_delivery`, `bundle`, and `exclusive`. That mismatch can produce divergent behavior between static and backend-defined rewards.
- Reward availability is mostly UI-calculated from `totalPoints >= points_required`.
- Inventory availability for free products is not proven at the reward authority layer.
- Tier-dependent availability is not authoritative; tier/progress is hardcoded client display.
- Expired/inactive reward prevention exists only for `RewardTier.is_active` rows. Static fallback rewards cannot be deactivated without UI code change/publish.
- Redemption terms are not versioned. A claimed reward stores title/type/id but not a durable terms version.

Customer page rule:

A reward should not be displayed as redeemable in a future native-first patch unless the authoritative redemption path agrees that it is active, affordable, available, owned by the customer, and governed by current terms.

## 7. Redemption write-path audit

| Function/action | Source file | Entities written | Hub/API touched | Provider/payment touched | Gate/kill switch | Ownership validation | Balance validation | Idempotency | Reward availability validation | Point deduction | Order/discount behavior | Notification behavior | Rollback/audit | Risk summary |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Apply non-product reward | `src/pages/Rewards.jsx` -> `claimReward` | `UserPoints.claimed_rewards` through backend | `claimReward` attempts Hub reward-claims endpoint | No Stripe directly | None observed | `claimReward` authenticates but accepts `email` from body; owner/admin match not enforced | UI only; backend does not verify points | duplicate `reward_id` in `claimed_rewards` only | backend does not fetch RewardTier | no deduction in `claimReward` | active reward stored in localStorage for checkout | none directly | no rollback | `blocked_by_missing_boundary`, `blocked_by_missing_idempotency` |
| Apply free product reward | `src/pages/Rewards.jsx` | Cart state/localStorage, not point ledger | None at apply step | Checkout later | None observed | frontend user session only | UI only | none authoritative | product picker only | no immediate deduction | adds zero-price cart item locally | none | no rollback | high risk until checkout/redemption authority is proven |
| Remove reward | `src/pages/Rewards.jsx` | localStorage only | None | None | None | frontend only | N/A | N/A | N/A | no point restore/deduction | removes active reward client state | none | none | local display only |
| Validate active reward | `src/lib/rewardManager.js` | none | None | None | None | uses current dashboard request and user email | checks current points; `free_delivery` checks active subscription | none | does not verify RewardTier id active | none | none | none | none | read-only guard, not authority |
| Checkout reward/points use | `src/pages/Checkout.jsx`, `createPaymentIntent`, `createCheckoutSession`, `stripeWebhook` | `Order`, `UserPoints`, payment/order records | Hub/order sync paths remain active | Stripe/payment | payment/webhook gates vary | customer session/payment context | payment functions/webhook govern | some webhook duplicate checks | active reward from localStorage | points deducted in webhook paths | discounts/order creation tied to checkout | order notifications may exist in checkout flow | no unified rollback for rewards | payment/refund governed; not part of G45A |
| Referral code | `src/pages/Referral.jsx`, `src/pages/Checkout.jsx`, webhook/order paths | `Order.referral_code`; email invite via integration | manual/business process | Core SendEmail integration; checkout/payment later | none for static code | frontend only for referral page | none | webhook de-dupes repeat use by customer in places | static literal | none | discount applied in checkout | invite email to business inbox | manual | no native referral ledger |
| Loyalty enrollment | `createLoyaltyMember`, `completeAccountSetup`, `enrollNewCustomerInLoyalty` | `LoyaltyMember`, `UserProfile`, `UserPoints`, `Notification` | Hub enrollment first if configured | Resend email provider | not default-off in `createLoyaltyMember` | owner-or-admin for supplied email | awards pre-order bonus | existing member check | N/A | creates initial points | N/A | welcome notification/email | no full rollback after partial steps | important source-of-truth boundary, not page read only |
| Hub points inbound | `receivePointsSync`, `syncLoyaltyFromHub`, import tools | `UserPoints` create/update | Hub source | None | legacy/from-Hub gates | service secret or auth/admin depending function | accepts Hub state/transactions | limited; `receivePointsSync` appends/recalculates | N/A | mutates balances/history | N/A | none | no unified rollback | Hub write-primary/repair governed |
| Manual reconciliation | `reconcileCustomerLoyalty` | `UserPoints` create/update | None directly | None | `ENABLE_LOYALTY_RECONCILIATION` | admin only | recalculates from orders | no global idempotency | N/A | resets/recalculates | N/A | none | broad audit response | repair/replay governed only |

Hard stops for redemption:

- no live redemption pilot;
- no points deduction;
- no discount/order creation;
- no provider calls;
- no Hub mutation;
- no notifications;
- no broad loyalty write migration.

## 8. Refund, subscription, and POS holds

### Refunds/cancellations

Refund/cancellation loyalty behavior remains payment/refund governed. Refund paths can update `Order`, adjust `UserPoints`, create `OrderSyncLog`, and invoke Hub refund sync. Native loyalty cannot become authoritative until refund parity proves exact point reversal behavior for full refunds, partial refunds, cancellations, duplicate webhooks, and manual repair paths.

### Subscriptions

Subscription-earned points remain Hub/subscription governed. Multiple subscription functions and repair tools inspect or mutate `UserPoints` based on Stripe subscription/invoice/payment state. Native loyalty authority for subscription points requires exact occurrence identity and idempotency proof.

### POS

POS loyalty remains held. `getAdminPOSOrdersSummary` and POS/order pathways may inform admin visibility, but no separate proof was found that POS order identity and point posting are safely represented in a native loyalty ledger.

### Unknown/manual adjustments

Manual loyalty import, reconciliation, and repair functions require manual review/audit trail. They must not become automatic customer-facing source-of-truth without bounded parity previews.

## 9. Native-read eligibility rules

A future customer rewards response may become native-primary only when all of the following are true:

- authenticated customer ownership is proven before any loyalty lookup;
- exactly one native loyalty account/balance source exists for the customer identity set;
- no duplicate `UserPoints`/`LoyaltyMember` identity exists;
- the point balance is internally consistent;
- ledger/history coverage is sufficient to explain balance, lifetime, redeemed, and recent activity;
- refund/cancellation point holds are accounted for;
- subscription/POS points are either safely represented or explicitly held/fallback;
- reward catalog is current, active, and compatible with the authoritative redemption path;
- no active review/repair/import/replay hold exists;
- active reward/redemption state is not sourced only from localStorage;
- no raw/internal metadata reaches customers;
- Hub fallback remains available for unsupported contexts.

For G45B/G45C planning, native-read-primary should mean display-only balance/catalog/history reads. It must not imply native write authority for redemption, adjustment, refund reversal, subscription points, POS points, notifications, or Hub suppression.

## 10. Page-by-page gaps

### A. Rewards main page

- Balance: displayed from `UserPoints.total_points`; needs parity against Hub/native ledger before authority switch.
- Tier/progress: hardcoded in UI; needs policy-backed tier source or explicit display-only classification.
- Available rewards: `RewardTier` plus static fallback; reward type enum mismatch needs catalog parity.
- Redemption buttons: UI unlocks by points and calls `claimReward`/localStorage; backend does not fully validate owner, balance, catalog, deduction, or terms.
- Activity/history: embedded `points_history` array; no immutable ledger or source-specific idempotency proof.

### B. Account rewards summary

- Account page uses the same dashboard data path but currently shows a Rewards quick link rather than balance details.
- If future Account summary shows points/tier, it should share the same native/Hub parity contract as `/rewards`.
- Link consistency is safe; balance authority is not yet proven.

### C. Reward detail/redemption

- No separate reward detail page or authoritative redemption record was found.
- `claimReward` records a claim, not a full redemption lifecycle.
- Eligibility, terms, idempotency, point deduction, checkout application, and rollback are split across UI/localStorage/payment webhook behavior.
- Redemption write safety is not ready for migration.

### D. Referral surface

- Referral code is static (`NuVira26`).
- Invite action sends an email to the business inbox through a Core email integration.
- Attribution, fraud prevention, duplicate prevention, and point issuance are manual/order-payment governed.
- No referral ledger entity was found.

### E. Admin loyalty surface

- Admin page reads `LoyaltyMember` through `getAdminLaunchReadOnlySummary`.
- It does not compare `LoyaltyMember` against `UserPoints`, Hub, order-derived points, subscription points, refunds, or POS points.
- Manual adjustment/reconciliation tools exist elsewhere and are gated/repair-governed.
- A future admin diagnostics phase should add mismatch visibility before any customer-facing native-read-primary expansion.

## 11. Recommended migration sequence

1. **G45B — native/Hub loyalty read parity preview**
   - Read-only.
   - Bounded customer samples.
   - Compare `UserPoints`, `LoyaltyMember`, Hub loyalty payloads, order-derived point evidence, subscription/refund/POS holds, `RewardTier` catalog, and recent activity.
   - No writes.

2. **G45C — limited native-first Rewards page reads**
   - Exact safe customer/account subset only.
   - Hub fallback retained.
   - Customer App/native `UserPoints` remains display source only after parity proof.
   - No redemption, adjustment, refund, subscription, POS, or notification changes.

3. **G45D — rewards/admin mismatch diagnostics**
   - Admin-only.
   - Show `UserPoints`/`LoyaltyMember`/Hub/order-derived mismatches.
   - No customer-visible diagnostics.

4. **G45E — redemption command audit/plan**
   - Docs/read-only first.
   - Define owner boundary, reward catalog authority, balance validation, idempotency, point deduction, checkout application, rollback, audit logs, and Hub behavior.
   - No live redemption.

5. **G45F — refund/subscription/POS loyalty policy**
   - Held until refund parity, subscription occurrence identity, and POS identity/point posting are proven.

Do not recommend broad rewards write cutover from G45A.

## 12. Hard stops

- no points balance source-of-truth switch without parity;
- no points ledger mutation;
- no reward redemption;
- no manual point adjustment;
- no refund reversal migration;
- no subscription points migration;
- no POS points migration;
- no customer notifications;
- no provider calls;
- no Hub mutation;
- no repair/replay/backfill writes;
- no customer-visible internal diagnostics;
- no loyalty cutover based only on UI appearance.

## 13. Recommendation

Rewards/Loyalty should be classified as:

```text
customer_rewards_loyalty_native_read_partial_hub_write_and_redemption_held
```

Proceed first with **G45B — native/Hub loyalty read parity preview**. Keep redemption, adjustments, refunds, subscriptions, POS, notifications, and Hub write suppression held. The `/rewards` page can be evaluated for limited native-read-primary display only after parity proves that native balance, history, tier/catalog, and customer ownership are safe for a bounded customer subset.

## 14. No-write policy

G45A performed a static source audit only. It did not change runtime code, schemas, UI, Base44 publish state, Builder state, loyalty points, reward balances, redemptions, referrals, tiers, orders, Hub records, providers, Stripe, Shopify, notifications, sync, repair, replay, logs, queues, refunds, POS, or subscriptions.
