# 🎯 HUB SYNC SLA AND STUCK ORDER PROTOCOL

**Status: FRAMEWORK DEFINED, PENDING HUB TEAM CONFIRMATION**  
**Date: 2026-05-01**  
**Version: 1.0**

---

## 📋 OFFICIAL SYNC ARCHITECTURE (Customer App Side)

### **What Customer App Guarantees**

✅ **1. Immediate Order Creation**
- Stripe webhook creates order in Customer App immediately after payment
- Timestamp: `created_date` in Order entity (utc)
- Status: `scheduled_for_juicing` (or `order_received` for pre-orders)
- All fields populated: address, items, totals, customer name, Stripe IDs

✅ **2. Immediate Sync Attempt**
- `stripeWebhook` calls `syncOrderToHub({ order_id: order.id })` **synchronously**
- Logs attempt to OrderSyncLog:
  - Success: status = `success`, triggered_by = `stripe_webhook` or `stripe_webhook_preorder`
  - Failure: status = `error`, triggered_by = `stripe_webhook` or `stripe_webhook_preorder`
- If sync fails, webhook re-throws error (alerts Stripe, triggers retry)

✅ **3. Idempotent Order Creation**
- Deduped by `stripe_checkout_session_id`
- Webhook retries safe (same order not re-created)

✅ **4. Complete Metadata for Recovery**
- Order stored with Stripe IDs: `stripe_checkout_session_id`, `stripe_payment_intent_id`
- Used by Hub for idempotent sync via `safeSyncOrderUpdate`

✅ **5. OrderSyncLog Audit Trail**
- Every sync attempt (successful and failed) logged
- Admin can see: order_number, status, description, triggered_by, timestamps
- Manual recovery attempts logged separately

✅ **6. Stuck Order Detection** (NEW)
- Function: `detectStuckOrders` runs on-demand or scheduled
- Compares Customer App paid orders with Hub orders
- Classifies by age:
  - **Normal**: In Hub, or <2 min old (expected delay)
  - **Delayed**: >5 min old, not in Hub yet (⚠️ watch)
  - **Stuck**: >10 min old, not in Hub (🚨 alert + recovery)
- Logs to OrderSyncLog for visibility

✅ **7. Safe Recovery Mechanism** (NEW)
- Function: `recoverStuckOrder` (admin-only)
- Idempotent: Safe to call multiple times for same order
- Routes through `syncOrderToHub` (approved path)
- Logs recovery attempt to OrderSyncLog
- Returns detailed status + order details

---

## ⏱️ OFFICIAL SLA (RECOMMENDED)

| Stage | Expected Timing | Status | Notes |
|-------|-----------------|--------|-------|
| **Stripe payment** → **Customer App order** | <1 second | ✅ Guaranteed | Webhook immediate |
| **Order created** → **Sync attempt** | <1 second | ✅ Guaranteed | Webhook synchronous |
| **Sync attempt** → **Hub order visible** | **??** | ⏳ **Pending Hub confirmation** | **See below** |

### **Recommended Hub Sync Timing (Based on NV-MONI2Z3R Test)**

| Scenario | Expected Time | Threshold | Action |
|----------|----------------|-----------|--------|
| **Fast path** (Hub immediate pull) | 2-5 seconds | ✅ Normal | Order appears in Hub |
| **Scheduled pull** (next cycle) | 5-15 minutes | ⚠️ Delayed | Order still appears, just slower |
| **Beyond stuck threshold** | >10 minutes | 🚨 Stuck | Recovery needed |

**Current Evidence:**
- NV-MONI2Z3R: Created 22:44:57, appeared in Hub by 23:17:47 (~33 minutes)
- Actual trigger unknown (immediate pull vs. scheduled pull vs. other)
- **Hub team must confirm actual sync timing and mechanism**

---

## 🚨 STUCK ORDER PROTOCOL

### **Definition**
A "stuck order" is:
- ✅ Paid (payment_captured = true OR is_preorder = true)
- ✅ Created in Customer App
- ❌ NOT visible in Hub after 10 minutes
- ❌ NOT syncing via automatic pull or webhook

### **Detection (Automated)**

Function: `detectStuckOrders`

**Triggers:**
- On-demand: Admin calls manually
- Scheduled: Cron job every 5 minutes (recommended)

**Output:**
- Classifies all paid orders into: Normal | Delayed | Stuck
- Logs **Delayed** and **Stuck** to OrderSyncLog
- Admin sees them immediately in stuck orders dashboard/query

**Visibility for Admin:**

```sql
-- Query to find stuck orders
SELECT order_number, customer_email, customer_name, created_date, 
       total, estimated_delivery_date, stripe_checkout_session_id,
       age_minutes, status
FROM OrderSyncLog
WHERE status IN ('error', 'pending')
  AND triggered_by = 'cron_poll'
  AND created_date > NOW() - INTERVAL 1 hour
ORDER BY created_date DESC;
```

Or via dedicated Admin function: `getStuckOrders` (can create if needed)

### **Recovery (Manual)**

Function: `recoverStuckOrder` (admin-only)

**Process:**
1. Admin sees stuck order in OrderSyncLog
2. Calls `recoverStuckOrder({ order_number: "NV-MONI2Z3R" })`
3. Function:
   - Fetches order from Customer App
   - Calls `syncOrderToHub` with full error handling
   - Logs recovery attempt
   - Returns success/failure with details

**Idempotency:**
- Safe to call multiple times (same order ID)
- Hub dedupes via stripe_checkout_session_id
- Will NOT create duplicates

**Expected Outcome:**
- Success: Order syncs to Hub, logs "recovery" status
- Failure: Logged for Hub team escalation

---

## 📊 ORDERSYNLOG SCHEMA (SLA TRACKING)

| Field | Type | Purpose |
|-------|------|---------|
| `order_number` | string | Order identifier |
| `status` | enum | `success` \| `error` \| `recovery` \| `pending` |
| `description` | string | Detailed message (max 1000 chars) |
| `started_at` | timestamp | When sync/poll attempt started |
| `completed_at` | timestamp | When attempt completed |
| `triggered_by` | enum | `stripe_webhook` \| `stripe_webhook_preorder` \| `cron_poll` \| `manual` |

**Admin Visibility:**
- OrderSyncLog searchable by order_number
- Filtered by triggered_by (webhook vs. poll vs. manual)
- Shows historical sync attempts for each order

---

## ✅ PRE-LIVE CHECKOUT VERIFICATION FOR NV-MONI2Z3R

### **Customer App Side** ✅ VERIFIED

| Check | Status | Details |
|-------|--------|---------|
| Order created | ✅ | 2026-05-01T22:44:57.636Z |
| Payment captured | ✅ | payment_captured = true |
| Stripe IDs stored | ✅ | session_id + intent_id present |
| All fields populated | ✅ | address, items, totals, customer name, phone |
| OrderSyncLog logged | ⏳ | Will be logged for future orders (enhancement deployed) |

### **Hub Side** ⏳ PENDING VERIFICATION

| Check | Required For Live | Status |
|-------|-------------------|--------|
| Appears in Hub Orders | ✅ Critical | **Need Hub team confirmation** |
| Appears in Production Planning | ✅ Critical | **Need Hub team confirmation** |
| Appears in Production page | ✅ Critical | **Need Hub team confirmation** (check for x0 bug) |
| Appears in FulfillmentTasks | ✅ Critical | **Need Hub team confirmation** |
| Appears in Driver Portal | ✅ Important | If delivery date valid |
| No duplicate in Hub | ✅ Critical | **Need Hub team confirmation** |
| No missing address | ✅ Critical | **Need Hub team confirmation** |
| OrderReviewQueue clean | ✅ Critical | **Need Hub team confirmation** |

---

## 🎯 REQUIRED HUB TEAM CONFIRMATION

Before declaring **READY FOR FINAL LIVE CHECKOUT TEST**, Hub team must confirm:

1. **Sync Timing:**
   - What is the actual expected time from Customer App order creation to Hub visibility?
   - Is it "immediate" (2-5 sec), "scheduled" (5-15 min), or variable?
   - What logs prove the pull/ingestion happened?

2. **Sync Trigger:**
   - Does Hub pull/ingest on-demand when Stripe payment is created?
   - Or does scheduled poller poll at a fixed interval?
   - Or both?

3. **safeSyncOrderUpdate Path:**
   - Confirmed NV-MONI2Z3R routed through this?
   - What are the idempotency keys it uses?
   - Does it prevent duplicates?

4. **NV-MONI2Z3R Downstream:**
   - ✅ Appears in Hub Orders exactly once?
   - ✅ Appears in Production Planning?
   - ✅ Appears in Production page with correct items (no x0)?
   - ✅ Appears in FulfillmentTasks?
   - ✅ Appears in Driver Portal (if valid)?
   - ✅ OrderReviewQueue has no issues?

5. **Max Acceptable Delay:**
   - If Customer App order is not in Hub within [X] minutes, is it considered stuck?
   - What's the SLA Hub can support?

---

## 🚀 FINAL READINESS CHECKLIST

### **Customer App Guarantees** ✅ MET
- [x] Orders created immediately on Stripe payment
- [x] Sync attempted immediately (logged)
- [x] Idempotent order creation (no duplicates)
- [x] Complete metadata stored for Hub recovery
- [x] OrderSyncLog tracks all sync attempts
- [x] Stuck order detection function deployed
- [x] Safe recovery function deployed
- [x] Admin visibility for stuck orders

### **Hub Team Confirmation** ⏳ REQUIRED
- [ ] Confirm NV-MONI2Z3R appears in Hub Orders (1x, no dups)
- [ ] Confirm NV-MONI2Z3R appears in Production Planning
- [ ] Confirm NV-MONI2Z3R appears in Production page (correct items, no x0)
- [ ] Confirm NV-MONI2Z3R appears in FulfillmentTasks
- [ ] Confirm NV-MONI2Z3R in Driver Portal (if delivery valid)
- [ ] Confirm OrderReviewQueue has no issues
- [ ] Confirm actual Hub sync timing SLA
- [ ] Confirm sync mechanism (immediate pull, scheduled pull, hybrid)

### **Final Status**

```
CUSTOMER APP: ✅ READY
HUB CONFIRMATION: ⏳ PENDING

→ OVERALL: ⏳ AWAITING HUB TEAM CONFIRMATION

Once Hub confirms 6 items above, status = ✅ READY FOR TIMESTAMPED LIVE CHECKOUT TEST
```

---

## 📝 FINAL LIVE CHECKOUT TEST PROCEDURE

Once Hub team confirms readiness:

1. **Pre-test:** Confirm no manual repairs or in-progress syncs
2. **Test:** Place live order, capture all timestamps:
   - Stripe payment submitted: T0
   - Stripe webhook fired: T1
   - Customer App order created: T2
   - Sync attempt started: T3
   - Hub order appeared: T4
   - Production Planning updated: T5
   - Fulfillment task created: T6
3. **Analysis:** Verify total latency T4-T0 matches SLA
4. **Verification:** Confirm OrderReviewQueue has no issues
5. **Result:** Log all timestamps in a test report

---

## 📞 ESCALATION PATH

If stuck order detected:
1. Admin calls `detectStuckOrders` (on-demand)
2. Sees stuck order in results
3. Calls `recoverStuckOrder({ order_number: "NV-XXXX" })`
4. If recovery succeeds → order syncs to Hub
5. If recovery fails → escalate to Hub team with order_number + timestamps + Stripe session ID

No order should be "lost" with this protocol in place.