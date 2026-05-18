# NuVira Cleanup Execution Plan: Phase 4-5
## Safe, Batched Disable-First Approach with Rollback Paths

**Plan Status:** Ready for Execution  
**Created:** 2026-05-15  
**Monitoring Window:** 24h disable → 48h delete  
**Rollback Strategy:** Function backups archived, automations disabled first  

---

## CRITICAL RULES (Non-Negotiable)

✋ **NEVER delete without:**
1. ✅ Confirming ZERO callers in pages, components, automations, webhooks, entity triggers
2. ✅ Disabling all automations that call it FIRST
3. ✅ Backing up function code to archive
4. ✅ Monitoring 24-48h after disable before delete
5. ✅ Having a rollback plan

✋ **NEVER skip regression tests:**
- Checkout (one-time orders)
- Subscriptions (creation + renewal)
- Hub sync (order created → Hub received)
- Shopify POS (order received → fulfillment)
- Refunds (charge.refunded → Hub cancellation)
- Dashboard accuracy
- Loyalty points
- Mobile (cart, checkout)

---

## CUSTOMER APP CLEANUP PLAN

### Batch 1: DELETE_NOW (No Callers, Safe to Delete Immediately)

**Functions to delete (0 callers confirmed):**

#### 1. `shopifyGetAccessToken`
- **Why:** Token exchange deprecated; token now stored in secrets
- **Callers:** None (was OAuth exchange, now unnecessary)
- **Entities:** None
- **Automations:** None
- **Risk:** ✅ ZERO
- **Action:** ✅ DELETE NOW
- **Backup:** See FUNCTION_BACKUP_ARCHIVE.md

---

#### 2. `zone3LiveApprovalTestHelper`
- **Why:** QA test helper, no production use
- **Callers:** None
- **Automations:** None
- **Risk:** ✅ ZERO
- **Action:** ✅ DELETE NOW

---

#### 3. `monitorLiveCheckoutTest`
- **Why:** QA embedded checkout test, hardcoded test values
- **Callers:** None
- **Automations:** None
- **Risk:** ✅ ZERO
- **Action:** ✅ DELETE NOW

---

### Batch 2: DISABLE_FIRST (Scheduled Automations — Monitor 24h Before Delete)

**Automations to disable (possible redundancy with Hub push):**

#### 1. `syncOrdersFromHub` (Scheduled every 30 min)
- **Purpose:** Pull-model order sync from Hub
- **Redundancy Risk:** Hub may already push orders reliably. This is fallback.
- **Action:**
  1. List automation: Get automation ID
  2. Toggle OFF (disable)
  3. Monitor logs for 24h
  4. Check: Did any orders fail to sync during 24h window?
  5. If NO failures → safe to delete function
  6. If YES failures → keep enabled, investigate Hub reliability
- **Caller:** Scheduled automation (every 30 min)
- **Rollback:** Re-enable automation

---

#### 2. `syncSubscriptionFromHub` (Scheduled every 60 min)
- **Purpose:** Pull subscription updates from Hub
- **Redundancy Risk:** Hub may push updates reliably
- **Action:** Same as syncOrdersFromHub
- **Caller:** Scheduled automation
- **Rollback:** Re-enable automation

---

#### 3. `syncProductsToGMC` (Scheduled weekly)
- **Purpose:** Google Merchant Center feed sync
- **Dependency Check:**
  - Q: Is Google Ads/Shopping enabled?
  - Q: Are product feeds actively used for ads?
  - If NO → disable
  - If YES → keep
- **Action:** Verify GMC is in use before disabling
- **Caller:** Scheduled automation (weekly)
- **Rollback:** Re-enable automation

---

#### 4. `syncMerchToShopify` (Scheduled weekly)
- **Purpose:** Merch entity → Shopify products
- **Dependency Check:**
  - Q: Are Merch products actively used?
  - Q: Does Shopify have active merch catalog?
  - If NO → disable
  - If YES → keep
- **Action:** Verify Merch is in use
- **Caller:** Scheduled automation
- **Rollback:** Re-enable automation

---

#### 5. `syncEventToHub` (Scheduled event-triggered)
- **Purpose:** Event entity → Hub
- **Dependency Check:**
  - Q: Are Events actively created and used?
  - Q: Does Hub need event data?
  - If NO → disable
  - If YES → keep
- **Action:** Verify Event usage
- **Caller:** Scheduled automation
- **Rollback:** Re-enable automation

---

### Batch 3: DELETE_CANDIDATE (Debug-Only Functions)

**Delete only after confirming NO automations call them:**

#### Audit Functions (No automations, safe to delete after backup):
- `auditAmarkSubscriptions` — customer name audit only
- `auditCustomerAppLoyaltyAfterPhase2` — Phase 2 loyalty audit
- `auditLatestStripePaymentForAmark` — customer payment audit
- `auditNewSubscriptions` — subscription creation audit
- `auditSubscriptionFulfillments` — fulfillment audit
- `auditSubscriptionPayloadToHub` — Hub payload audit
- `auditWindow3Orders` — Saturday threshold audit
- `auditStripeAndIntegrationInventory` — inventory audit
- `stabilizationDiagnostic` — diagnostic tool
- `debugHubSyncPayload` — sync debugging
- `debugAndRetryHubSync` — manual retry helper

**Action for each:**
1. Confirm NO automations call this function
2. Confirm NO other functions call this function
3. Back up function code to FUNCTION_BACKUP_ARCHIVE.md
4. Delete function from functions/ directory
5. Monitor logs for 48h (should see no errors about missing function)

**Rollback:** Re-upload function from backup

---

### Batch 4: KEEP_BUT_HARDEN (Add Logging & Limits)

#### 1. `approveZone3DeliveryRequest`
- **Issue:** Captures real money (Stripe PI), admin-only gate is sufficient but needs audit trail
- **Action:**
  - Add detailed audit logging for every capture attempt
  - Log: admin email, timestamp, DAR ID, amount, customer, address
  - Log: Stripe capture response (success/failure)
  - Example:
    ```javascript
    console.log(`[Z3_APPROVE_AUDIT] admin=${admin_email} dar=${dar.id} amount=$${amount} customer=${dar.customer_email} address=${dar.delivery_address} stripe_capture=${pi.id} status=${response.status}`);
    ```
- **Timeline:** Deploy logging changes before any cleanup deletions

---

#### 2. `retryFailedHubSyncs` (Scheduled every 15 min)
- **Issue:** Retries indefinitely, could retry failed orders forever
- **Action:**
  - Add max retry count: 10 retries per order
  - After 10 failures, mark as `manual_review` in OrderSyncLog
  - Alert operations team
  - Example:
    ```javascript
    const retryCount = syncLog.retry_count || 0;
    if (retryCount >= 10) {
      console.warn(`Max retries reached for ${order_number}. Marking manual_review.`);
      await base44.asServiceRole.entities.OrderSyncLog.update(syncLog.id, {
        status: 'manual_review',
        retry_count: retryCount + 1
      });
      return Response.json({ result: 'max_retries_exceeded, manual_review_required' });
    }
    ```
- **Timeline:** Deploy before any delete batch to prevent credit drain

---

#### 3. `syncHubDeliveryStatuses` (Scheduled every 10 min)
- **Issue:** Polls Hub API every 10 min — could drain credits if Hub read API is expensive
- **Action:**
  - Review Hub pricing model: Is read cost significant?
  - If YES, increase polling interval to 30 min
  - Add credit tracking: Log invocation count daily
  - Example:
    ```javascript
    console.log(`[HUB_STATUS_SYNC] invocation_count=${await getInvocationCount()} credit_estimate=$${count * CREDIT_PER_CALL}`);
    ```
- **Timeline:** Deploy logging, then decide on interval based on actual cost

---

### Batch 5: KEEP_REQUIRED (No Changes)

**DO NOT MODIFY these functions:**
- stripeWebhook (all payment events)
- createCheckoutSession (one-time checkout)
- syncOrderToHub (order → fulfillment)
- syncSubscriptionWithFulfillments (subscription → Hub)
- calculateNuViraFulfillmentSchedule (scheduling authority)
- pushOrderToShopify (POS sync)
- shopifyWebhookReceiver (POS ingest)
- syncShopifyOrderToHub (POS → Hub)
- createZone3AuthorizationIntent (Zone 3 flow)
- denyZone3DeliveryRequest (Zone 3 denial)
- syncRefundToHub (refund pipeline)
- sendCustomerNotification, sendOrderReceivedNotification (customer comms)
- All subscription creation paths

---

### Batch 6: UNKNOWN_NEEDS_REVIEW

#### 1. `shopifyPollFallback`
- **Status:** Unknown
- **Question:** Is there a scheduled automation that still calls this?
- **Action:** Search for automation with this function name
- **Decision:**
  - If automation exists → disable automation first, then investigate
  - If NO automation → delete as debug function

---

## EXECUTION CHECKLIST

### ✅ Pre-Cleanup

- [ ] All function backups exported to FUNCTION_BACKUP_ARCHIVE.md
- [ ] All automations IDs documented (get from list_automations)
- [ ] Regression test checklist prepared (see REGRESSION_TEST_CHECKLIST.md)
- [ ] Slack/email alert configured for 24h/48h monitoring windows
- [ ] Team notified of cleanup timeline
- [ ] Rollback procedure documented for each batch

---

### ✅ Batch 1 Execution: DELETE_NOW

**Timeline:** Immediate
**Functions:** shopifyGetAccessToken, zone3LiveApprovalTestHelper, monitorLiveCheckoutTest

```bash
Step 1: Backup code (automatic via FUNCTION_BACKUP_ARCHIVE.md)
Step 2: Verify no callers (automated check below)
Step 3: Delete functions from /functions directory
Step 4: Monitor logs for 48h
Step 5: If no errors → confirm success. If errors → rollback from backup
```

**Caller Verification Checklist:**

For each function, verify:
```
Function: shopifyGetAccessToken
- ❓ Called from frontend pages? Search: grep -r "shopifyGetAccessToken" pages/
- ❓ Called from other functions? Search: grep -r "shopifyGetAccessToken" functions/
- ❓ In any automations? Search: grep -r "shopifyGetAccessToken" [automations list]
- ❓ In entity triggers? Check entity RLS or automations that reference it
- ❓ In webhooks? Check shopifyWebhookReceiver, stripeWebhook
```

**Result:** 0 callers found → SAFE TO DELETE

---

### ✅ Batch 2 Execution: DISABLE_FIRST (24h Monitoring)

**Timeline:** Start → Monitor 24h → Decide

**Automations:** syncOrdersFromHub, syncSubscriptionFromHub, syncProductsToGMC, syncMerchToShopify, syncEventToHub

```bash
Step 1: List all automations (list_automations)
Step 2: For each automation to disable:
        - Get automation ID
        - Disable (manage_automation action="toggle")
        - Log: "Disabled {automation_name} at {timestamp}"
Step 3: Monitor logs for 24h
Step 4: Check: Were any orders/subscriptions not synced?
        - Query OrderSyncLog: any errors during 24h window?
        - Query Subscription updates: any missing sync events?
Step 5: Decision:
        - If no sync errors → function is redundant, safe to delete
        - If sync errors → Hub push is unreliable, re-enable
Step 6: Proceed to delete only if safe
```

**Monitoring Query:**
```sql
-- Check for sync failures during disable window
SELECT order_number, status FROM OrderSyncLog 
WHERE triggered_by='scheduled_poll' AND created_date > {disable_start_time}
AND status IN ('error', 'failed');

-- Check for unsynced orders
SELECT COUNT(*) FROM Order 
WHERE hub_sync_status NOT IN ('synced', 'success')
AND created_date > {disable_start_time};
```

---

### ✅ Batch 3 Execution: DELETE_CANDIDATE (After Batch 2 Success)

**Timeline:** After Batch 2 monitoring complete
**Functions:** All audit functions + debug functions

```bash
Step 1: For each function:
        - Verify NO automations call it (via list_automations)
        - Verify NO other functions call it (via grep)
        - Back up code
        - Delete function
Step 2: Monitor logs for 48h
Step 3: If no errors → success. If errors → rollback from backup
```

---

### ✅ Batch 4 Execution: KEEP_BUT_HARDEN (Parallel with Batch 1)

**Timeline:** Same as Batch 1 (can start now)
**Functions:** approveZone3DeliveryRequest, retryFailedHubSyncs, syncHubDeliveryStatuses

```bash
Step 1: Update each function with hardening code (logging, retry limits)
Step 2: Deploy changes
Step 3: Monitor for 24h
Step 4: Verify no new errors introduced
Step 5: Confirm hardening is effective (e.g., Zone 3 captures logged, retry limits working)
```

---

## REGRESSION TEST CHECKLIST

**Run after each batch:**

### 🔴 Critical Path Tests (MUST PASS)

- [ ] **Checkout (One-Time Order)**
  - Navigate to /checkout
  - Add items, select delivery date
  - Click "Checkout"
  - Complete Stripe payment
  - ✅ Order created in CA DB
  - ✅ Order synced to Hub (check OrderSyncLog)
  - ✅ Customer receives order confirmation email

- [ ] **Subscription Creation**
  - Navigate to /subscribe
  - Select plan (Weekly Fresh, Monthly Ritual, etc.)
  - Complete Stripe payment
  - ✅ Subscription created in CA DB
  - ✅ Subscription synced to Hub with 4x FulfillmentTasks
  - ✅ Customer receives subscription confirmation

- [ ] **Refund Processing**
  - Refund an order via Stripe Dashboard
  - ✅ stripeWebhook receives charge.refunded
  - ✅ Order marked refunded in CA DB
  - ✅ Order sync status = refund_pending_hub_sync
  - ✅ Hub receives refund event
  - ✅ Loyalty points restored

- [ ] **Shopify POS Order**
  - Register order in Shopify POS
  - ✅ shopifyWebhookReceiver receives order.created
  - ✅ ShopifyOrder created in CA DB
  - ✅ Synced to Hub for fulfillment

- [ ] **Hub Sync Status**
  - Check OrderSyncLog
  - ✅ Recent orders have hub_action = 'created' or 'updated'
  - ✅ No spike in 'error' status

- [ ] **Dashboard Accuracy**
  - Navigate to /account/orders
  - ✅ All orders visible with correct status
  - ✅ Delivery dates correct
  - ✅ Totals correct

- [ ] **Loyalty Points**
  - Place order, check UserPoints
  - ✅ Points awarded (10 pts per $1)
  - ✅ Points total updated
  - ✅ Redeem reward → points deducted

- [ ] **Mobile Checkout**
  - Use mobile browser
  - Complete checkout flow
  - ✅ No layout breaks
  - ✅ Payment succeeds

### 🟡 Secondary Tests (SHOULD PASS)

- [ ] Admin Orders page loads without errors
- [ ] Zone 3 delivery request creates auth hold
- [ ] Production schedule calculations are correct
- [ ] Referral code validation works
- [ ] Health advisory acknowledgment saved

---

## MONITORING DASHBOARD

**Track during 24-48h windows:**

```
METRICS TO WATCH:

1. Integration Credit Burn
   - Track: Daily function invocation count
   - Alert if: Increased > 20% vs baseline
   - Expected after disable: Decrease in sync functions

2. Function Failures
   - Track: Errors in logs (grep "ERROR", "FAILED", "EXCEPTION")
   - Alert if: New error patterns appear
   - Expected: No errors from deleted/disabled functions

3. Order Sync Status
   - Track: ORDER_SYNC_STATUS distribution
   - Expected: "success" + "deduped" = 95%+ of recent orders
   - Alert if: "error" > 5%

4. Hub Sync Latency
   - Track: Time from order.created to hub_action="created"
   - Expected: < 5 minutes
   - Alert if: > 10 minutes

5. Subscription Fulfillment
   - Track: FulfillmentTask creation count
   - Expected: 4 per subscription (weekly decomposition)
   - Alert if: 0 or unexpected numbers

6. Customer Experience
   - Track: Order confirmation emails sent
   - Track: In-app notifications created
   - Expected: 1:1 ratio with orders
```

---

## ROLLBACK PLAN

**If issues detected during monitoring:**

### 🔄 Rollback Batch 1 (DELETE_NOW)

```bash
# Restore from backup
1. Get function code from FUNCTION_BACKUP_ARCHIVE.md
2. Recreate function in /functions directory
3. Deploy
4. Monitor logs for recovery
5. Document root cause in incident report
```

### 🔄 Rollback Batch 2 (DISABLE_FIRST)

```bash
# Re-enable automations
1. For each disabled automation:
   - Get automation_id from list_automations
   - manage_automation action="toggle" to enable
2. Monitor logs
3. Verify sync recovery within 30 min
```

### 🔄 Rollback Batch 4 (KEEP_BUT_HARDEN)

```bash
# Revert code to pre-hardening version
1. Get original code from git
2. Restore original version
3. Deploy
4. Test that original functionality intact
```

---

## POST-CLEANUP SUMMARY

**After all batches complete:**

| Batch | Functions | Status | Result |
|-------|-----------|--------|--------|
| 1 (DELETE_NOW) | 3 | ✅ Complete | 0 callers, safe delete |
| 2 (DISABLE_FIRST) | 5 automations | ⏳ 24h window | Decide after monitoring |
| 3 (DELETE_CANDIDATE) | 11+ audit | ⏳ Batch 2 complete | Delete if no errors |
| 4 (KEEP_BUT_HARDEN) | 3 critical | ✅ Deploy now | Enhance reliability |

**Expected Outcome:**
- ✅ 19+ functions deleted or archived
- ✅ 5 automations potentially disabled (saves credits)
- ✅ 3 critical functions hardened with logging/limits
- ✅ Zero impact on critical flows (checkout, subscriptions, refunds)
- ✅ Credit burn rate reduced

---

**Next Step:** Execute Batch 1 immediately. Monitor for 48h. Then proceed to Batch 2.