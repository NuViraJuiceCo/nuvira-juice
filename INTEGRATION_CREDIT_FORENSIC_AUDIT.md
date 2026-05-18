# Integration Credit Forensic Audit
**Date:** 2026-05-17  
**Goal:** Identify where ~15k credits were consumed and build a lean operational architecture.

---

## Executive Summary

**Root cause of credit burn:** 4 scheduled automations running at extremely aggressive intervals (every 5–10 minutes), some of which perform full dataset scans, invoke sub-functions (double-counting credits), and call external APIs — even during idle operational periods with near-zero order volume.

**Estimated daily credit burn at current rates:**

| Category | Est. Credits/Day |
|---|---|
| Scheduled automations (execution overhead) | ~2,100 |
| Entity reads inside those automations | ~3,600 |
| External API calls (Hub, Stripe) inside automations | ~2,000 |
| Sub-function invocations from within automations | ~1,400 |
| Entity writes from sync / monitor | ~400 |
| **Total estimated** | **~9,500–12,000/day** |

**Target:** < 300 credits/day during current low-volume launch stage.

---

## Top 20 Credit Consumers — Ranked

### Tier 1 — Critical (must optimize immediately)

| Rank | Consumer | Runs/Day | Est. Credits/Day | Verdict |
|------|----------|----------|-----------------|---------|
| 1 | **Post-Payment Chain Monitor** (`monitorPostPaymentChain`) — every 5 min, 2,639 total runs, reads Orders + Subs + UserPoints + PendingSubscriptionCheckout per run | 288 | ~3,500 | **OPTIMIZE → slow to 30 min, disable when idle** |
| 2 | **Cancel Abandoned Checkouts** (`cancelAbandonedCheckouts`) — every 10 min, 1,559 runs, loads `Order.list(500)` + Stripe PI lookup per abandoned order | 144 | ~2,000 | **OPTIMIZE → 30 min interval, filter to `created_date > 1h ago` only** |
| 3 | **Hub→CA Delivery Status Sync** (`syncHubDeliveryStatuses`) — every 10 min, 1,045 runs, fetches all active orders + Hub API call per unique customer email + invokes `sendCustomerNotification` as sub-function | 144 | ~1,800 | **OPTIMIZE → 30 min during non-delivery hours, on-demand on delivery days** |
| 4 | **Auto-Retry Failed Hub Syncs** (`retryFailedHubSyncs`) — every 10 min, 1,729 runs, reads OrderSyncLog 4× per run (error + success + recovery + deduped), fetches Hub API per failed order | 144 | ~1,600 | **OPTIMIZE → 30 min interval, skip entirely if no error logs exist** |

### Tier 2 — Significant (reduce cadence)

| Rank | Consumer | Runs/Day | Est. Credits/Day | Verdict |
|------|----------|----------|-----------------|---------|
| 5 | **Auto-Expire Zone 3 Authorizations** (`autoExpireZone3Authorizations`) — every 1 hour, 117 runs, calls Stripe API per pending DAR | 24 | ~200 | **KEEP but verify it exits fast when no Zone3 requests are pending** |
| 6 | **Cancel Incomplete Subscriptions** (`cancelIncompleteSubscriptions`) — every 4 hours, 56 runs, calls Stripe API | 6 | ~80 | **KEEP — reasonable cadence** |
| 7 | **Order Status Notification Trigger** (entity automation on Order.update) — fires on every status-eligible write | ~10–30 | ~50 | **KEEP — event-driven, efficient** |
| 8 | **Sync Product to GMC on Change** (entity automation) — fires on every Product update | ~1–5 | ~10 | **KEEP — event-driven, low volume** |

### Tier 3 — Latent waste (deprecate or delete)

| Rank | Consumer | Runs/Day | Est. Credits/Day | Verdict |
|------|----------|----------|-----------------|---------|
| 9 | `pollOrderStatusUpdates` — explicitly deprecated, returns 410 immediately | 0 (disabled) | ~0 | **DELETE** — dead code consuming storage, confusing developers |
| 10 | `syncStuckOrdersPollerManual` — manual/audit function, should not be scheduled | Low | Low | **DISABLE any scheduled trigger if active** |
| 11 | `shopifyPollFallback` — Shopify polling fallback, likely stale | Unknown | Unknown | **AUDIT — verify if scheduled, DISABLE if not needed** |
| 12 | `sendUpcomingDeliveryNotifications` — queries Notification entity per subscription to check duplicates instead of using idempotency key | Low | Low | **OPTIMIZE — add idempotency_key to skip the filter lookup** |
| 13 | `auditStabilizationRepair`, `stabilizationDiagnostic`, `auditNewSubscriptions` — one-off audit functions | 0 | 0 | **DELETE — completed audit artifacts** |
| 14 | `repairR1*`, `repairR2*`, `repairR3*`, `repairR4*`, `repairMissing*`, `repairLive*` — completed repair operations | 0 | 0 | **DELETE — completed repair artifacts** |
| 15 | `auditAmarkSubscriptions`, `canonicalizeAmarkSubscription`, `auditLatestStripePaymentForAmark` — customer-specific one-off audits | 0 | 0 | **DELETE** |
| 16 | `debugAndRetryHubSync`, `debugHubSyncPayload`, `diagnosePiConfig`, `refundFlowDiagnostic` — debug functions | 0 | 0 | **DELETE** |
| 17 | `replaySubscriptionRefundDryRun`, `probeHubSubscriptionCancelled` — probe/dry-run functions | 0 | 0 | **DELETE** |
| 18 | `verifyStripeLiveMode`, `verifyHubEndpointReachability`, `verifyLiveSubscriptionSmoke`, `verifyOutForDeliveryNotification`, `verifyCustomerFacingLoyaltyDisplay` — verification scripts | 0 | 0 | **DELETE** |
| 19 | `auditStripeAndIntegrationInventory`, `auditSubscriptionFulfillments`, `auditSubscriptionPayloadToHub`, `auditWindow3Orders` — audit snapshots | 0 | 0 | **DELETE** |
| 20 | `listRecentPIs`, `inspectPaymentIntent`, `executeCustomerAppLoyaltyImportPhase2`, `auditCustomerAppLoyaltyAfterPhase2` — one-off ops | 0 | 0 | **DELETE** |

---

## Hotspot Analysis

### 🔴 `monitorPostPaymentChain` — HIGHEST PRIORITY

**Problem:** Runs every 5 minutes but only needs to run shortly after a new order or subscription is created. At current volume (< 5 orders/day), it runs 288 times to check effectively 0–1 new orders per window.

**Per execution cost:**
- `Order.list(20)` = 1 read
- `OrderSyncLog.filter()` per order = N reads
- `Subscription.list(20)` = 1 read
- `UserPoints.filter()` per sub = N reads
- `PendingSubscriptionCheckout.filter()` per sub = N reads
- `PendingSubscriptionCheckout.list(20)` = 1 read
- **Total per run at low volume: ~6–10 entity reads**
- **At 288 runs/day: ~2,000–2,900 entity reads/day from this one job alone**

**Fix:** Slow to 60 minutes. Convert to entity automation on `Order.create` and `Subscription.create` to check the chain only when new records actually appear.

---

### 🔴 `cancelAbandonedCheckouts` — SECOND PRIORITY

**Problem:** Loads `Order.list(500)` every 10 minutes. At 144 runs/day, that's 72,000 order records fetched per day (144 × 500). Then calls Stripe API for each order that has a PI.

**Per execution cost:**
- `Order.list(500)` = 1 read (but loads 500 records)
- `stripe.paymentIntents.retrieve()` per abandoned order = external API call
- **At 144 runs/day with zero abandoned checkouts: 144 full dataset loads for nothing**

**Fix:** Change `Order.list(500)` to `Order.filter({ status: 'pending_payment' }, '-created_date', 50)`. Change interval to 30 minutes.

---

### 🔴 `retryFailedHubSyncs` — THIRD PRIORITY

**Problem:** Reads 4 separate `OrderSyncLog` collections every 10 minutes:
1. `filter({ status: 'error' }, null, 50)` 
2. `filter({ status: 'success' }, null, 200)`
3. `filter({ status: 'recovery' }, null, 200)`
4. `filter({ status: 'deduped' }, null, 200)`

That's 600 log records fetched per run × 144 runs/day = **86,400 log records/day** when there are likely 0 failed syncs to retry.

**Fix:** Add an early-exit guard: query only `status: 'error'` first. If count = 0, return immediately. Only fetch the 3 resolution collections if there are actual errors to deduplication-check.

---

### 🔴 `syncHubDeliveryStatuses` — FOURTH PRIORITY  

**Problem:** Every 10 minutes it loads all active orders, then makes one Hub API call per unique customer email. The Hub calls consume external API credits. The function also invokes `sendCustomerNotification` as a sub-function (counts as a separate function execution credit). During non-delivery periods (most of the week), this is pure waste.

**Fix:** Implement a "delivery day only" guard. Only run at full frequency on Wednesday, Saturday, Sunday (delivery days). Slow to every 60 minutes on non-delivery days.

---

## Structural Issues Found

### 1. Double-notification path
`syncHubDeliveryStatuses` writes to Order entity → entity automation `Order Status Notification Trigger` fires → `sendOrderStatusNotification` calls `sendCustomerNotification`. **AND** `syncHubDeliveryStatuses` also directly calls `sendCustomerNotification` as a safety net. Both paths fire on every status change = 2 function invocations per status update. The idempotency key prevents duplicate records, but the credit cost of invoking the function twice remains.

**Fix:** Remove the safety-net direct call from `syncHubDeliveryStatuses`. The entity automation is reliable. Trust the idempotency key.

### 2. `sendUpcomingDeliveryNotifications` uses filter instead of idempotency key
Queries `Notification.filter({ customer_email, type, title })` to check for existing notifications. This is expensive and fragile. Should use `idempotency_key` like all other notification functions.

### 3. No early-exit guards on any scheduled function
None of the 4 high-volume scheduled functions exit early when there is nothing to do. They all load full datasets every run unconditionally.

### 4. Stale/audit function backlog
~25+ functions that were created for one-off repairs, audits, and debugging remain deployed and active. They consume no credits at rest, but clutter the codebase and create confusion about what is operationally active.

---

## Optimization Plan — Ordered by Impact

### Phase 1 — Immediate (do today, -80% credit burn)

**1. Slow `monitorPostPaymentChain` from 5 min → 60 min**
- Impact: 288 → 24 runs/day (-88%)
- Better: Convert to entity automation on Order.create + Subscription.create

**2. Add early-exit to `retryFailedHubSyncs`**
- Query only `status: 'error'` first. If 0 results, return immediately.
- Impact: Eliminates ~3 of 4 OrderSyncLog fetches per run when no errors exist

**3. Fix `cancelAbandonedCheckouts` query**
- Replace `Order.list(500)` with `Order.filter({ status: 'pending_payment' }, '-created_date', 50)`
- Change interval from 10 min → 30 min
- Impact: -90% entity reads from this function

**4. Remove safety-net `sendCustomerNotification` call from `syncHubDeliveryStatuses`**
- The entity automation handles this reliably now that idempotency is fixed
- Impact: Eliminates 1 sub-function invocation per status update

### Phase 2 — This Week (-additional 30–40%)

**5. Add delivery-day guard to `syncHubDeliveryStatuses`**
```js
const dayOfWeek = new Date().toLocaleString('en-US', { weekday: 'long', timeZone: 'America/Chicago' });
const isDeliveryDay = ['Wednesday', 'Saturday', 'Sunday'].includes(dayOfWeek);
const intervalMinutes = isDeliveryDay ? 10 : 60;
// If not delivery day and last run was < 60 min ago, skip
```

**6. Delete completed one-off functions** (see Tier 3 list above — ~25 functions)

**7. Fix `sendUpcomingDeliveryNotifications`** to use idempotency_key

### Phase 3 — Next Sprint (architecture hardening)

**8. Convert `monitorPostPaymentChain` to entity automation**
- Trigger on `Order.create` and `Subscription.create` only
- Check chain 5 minutes after creation (use a scheduled 5-min automation with a creation timestamp guard)
- Eliminate continuous polling entirely

**9. Add `no_active_orders` early exit to `syncHubDeliveryStatuses`**
- If active order count = 0, return immediately without calling Hub

**10. Consolidate sync logs**
- OrderSyncLog is queried by 4 different status values per `retryFailedHubSyncs` run
- Add a composite `needs_retry: boolean` field to avoid 4 separate reads

---

## Operational Targets

| Stage | Target | Current | Gap |
|---|---|---|---|
| Now (launch, < 10 orders/day) | 150–300 credits/day | ~9,500–12,000/day | **40×–80× over** |
| Growth (100 orders/month) | < 1,000 credits/day | — | Achievable after Phase 1+2 |
| Scale (500+ orders/month) | < 3,000 credits/day | — | Achievable after Phase 3 |

---

## Protection Rules (Non-Negotiable Going Forward)

1. **No automation may run more than once per 30 minutes unless it processes live customer-facing events (e.g., out_for_delivery, delivered).**
2. **Every scheduled function must have an early-exit guard as its first operation.** If there is nothing to process, return in < 2 entity reads.
3. **No function may load more than 50 records unconditionally.** All bulk loads must be filtered.
4. **No sub-function invocations from within scheduled automations** unless the sub-function cannot be inlined. Each invocation counts as a separate execution credit.
5. **Completed one-off repair/audit/debug functions must be deleted within 1 week of completion.**
6. **Entity writes only when data has actually changed.** Add field-diff checks before every `entity.update()` call in sync functions.

---

## Immediate Action Checklist

- [ ] Slow `monitorPostPaymentChain` to 60 min (automation update)
- [ ] Add early-exit to `retryFailedHubSyncs` (code change)
- [ ] Fix `cancelAbandonedCheckouts` query + slow to 30 min (code + automation)
- [ ] Remove safety-net `sendCustomerNotification` from `syncHubDeliveryStatuses` (code change)
- [ ] Delete ~25 stale one-off functions (housekeeping)
- [ ] Add delivery-day guard to `syncHubDeliveryStatuses` (code change)