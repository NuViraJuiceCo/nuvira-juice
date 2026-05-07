# 📋 SUBSCRIPTION LOYALTY TEST EXECUTION PLAN

**Test Objective:** Verify subscription-specific loyalty point behavior during controlled live purchase test  
**Test Date:** 2026-05-07  
**Test Customer:** Amar Kahlon (amark@nuvisionarymedia.com)  
**Current Loyalty State:** 250 points (pre-order bonus only, zero valid orders)  
**Status:** READY FOR EXECUTION

---

## 🎯 TEST STEPS

### Phase 1: Pre-Test Snapshot
**Goal:** Capture baseline loyalty state before purchase

```bash
# Step 1.1: Verify customer loyalty before purchase
Call: base44.functions.invoke('monitorSubscriptionLoyalty', {
  customer_email: 'amark@nuvisionarymedia.com'
})

Expected Output:
- Points before: 250
- Stripe subscription: null (not created yet)
- Customer App Subscription: null (not created yet)
- Overall status: 'No active subscription'
```

**Record:**
- Points Before: ___________
- Last Point Entry: ___________
- Last Point Entry Timestamp: ___________

---

### Phase 2: Execute Subscription Purchase
**Goal:** Customer purchases a subscription (e.g., Monthly Ritual @ $144.00/month)

**Manual Steps:**
1. Open app in published mode (not iframe)
2. Navigate to `/subscribe`
3. Select a subscription plan (e.g., "Monthly Ritual")
4. Complete delivery info
5. Proceed to Stripe checkout
6. Complete payment with test card (or real card if using live mode)
7. Confirm payment success

**Expected Outcomes:**
- Stripe subscription created
- First invoice generated
- Payment captured
- Customer App Subscription record created
- Stripe webhook fires: `checkout.session.completed` or subscription invoice paid

**Record:**
- Subscription Selected: ___________
- Amount: $___________
- Payment Method: ___________
- Payment Time: ___________

---

### Phase 3: Immediate Post-Purchase Verification (within 5 minutes)
**Goal:** Verify first payment and point award were processed correctly

```bash
# Step 3.1: Monitor subscription and loyalty immediately after purchase
Call: base44.functions.invoke('monitorSubscriptionLoyalty', {
  customer_email: 'amark@nuvisionarymedia.com'
})

Expected Output:
{
  "stripe_subscription": {
    "id": "sub_XXXXXXXX",
    "status": "active",
    "customer_id": "cus_XXXXXXXX"
  },
  "first_invoice": {
    "id": "in_XXXXXXXX",
    "status": "paid",
    "amount_paid": 144.00,
    "payment_intent_id": "pi_XXXXXXXX",
    "payment_status": "paid"
  },
  "customer_app_subscription": {
    "id": "XXXXXXXX",
    "plan_id": "XXXXXXXX",
    "status": "active",
    "next_delivery_date": "YYYY-MM-DD"
  },
  "loyalty_points": {
    "before": 250,
    "after": 1690,
    "change": 1440,
    "subscription_point_entries": 1,
    "unique_subscription_awards": 1,
    "expected_points_from_invoice": 1440,
    "actual_points_awarded": 1440,
    "points_duplicated": false
  },
  "checks": {
    "stripe_subscription_created": "PASS",
    "first_invoice_paid": "PASS",
    "app_subscription_created": "PASS",
    "points_awarded_once": "PASS",
    "points_amount_correct": "PASS",
    "final_points_correct": "PASS"
  },
  "overall_status": "PASS - Subscription loyalty behavior correct"
}
```

**Record from Response:**
- Stripe Subscription ID: `sub_____________________`
- Invoice ID: `in_____________________`
- Payment Intent ID: `pi_____________________`
- Invoice Amount: $___________
- Invoice Status: ___________
- Points Before: ___________
- Points After: ___________
- Points Awarded: ___________
- Points Duplicated: ___________

---

### Phase 4: Frontend Verification
**Goal:** Verify customer-facing pages display correct loyalty state

**Step 4.1: Rewards Page**
- Navigate to `/rewards`
- Verify points display: Should show new total (250 + (10 × $144))
- Verify tier upgrade: Should show next tier threshold
- Verify points history entry appears
- ✅ Expected: 1690 points (250 pre-order + 1440 from subscription)

**Record:**
- Points Displayed: ___________
- Tier Shown: ___________
- Recent Entry Visible: YES / NO
- Entry Text: ___________

**Step 4.2: Account Page**
- Navigate to `/account`
- Verify account stats match
- Stats should show:
  - Orders: Still 0 (subscription != order in UI)
  - Points: 1690
  - Tier: Gold / Platinum (depending on 1690 pts)
- ✅ Expected: Consistent with Rewards page

**Record:**
- Orders Count: ___________
- Points Count: ___________
- Tier Display: ___________

**Step 4.3: Order History Page**
- Navigate to `/account/orders`
- Verify subscription-related order records (if any created by Hub)
- Should show only valid paid orders
- ✅ Expected: May be empty (depends on Hub order generation for subscriptions)

**Record:**
- Orders Shown: ___________
- First Order (if shown): ___________

---

### Phase 5: Final Verification (15+ minutes after purchase)
**Goal:** Confirm all systems settled and no delayed duplication occurred

```bash
# Step 5.1: Final loyalty check
Call: base44.functions.invoke('monitorSubscriptionLoyalty', {
  customer_email: 'amark@nuvisionarymedia.com'
})

Expected Output: Same as Phase 3 (no changes)
```

**Record:**
- Points Final: ___________
- Subscription Records Count: ___________
- Point Entries for This Invoice: ___________
- Duplicates Detected: ___________

---

## ✅ PASS CRITERIA

All of the following must be true:

- [ ] Stripe subscription created (status = active)
- [ ] First invoice paid (status = paid, amount > 0)
- [ ] Customer App Subscription record created (status = active)
- [ ] Points awarded exactly once (no duplicates)
- [ ] Points amount correct: 10 × invoice amount
- [ ] Final points = before + (10 × invoice amount)
- [ ] Rewards page shows correct new total
- [ ] Account stats consistent with Rewards page
- [ ] Order History shows only valid orders
- [ ] No duplicate point entries after 15+ min delay
- [ ] overall_status from monitorSubscriptionLoyalty = "PASS"

---

## ❌ FAILURE SCENARIOS & REMEDIATION

### Scenario A: Stripe subscription created but first invoice not paid
**Diagnosis:** Payment failed or pending  
**Action:** Check Stripe dashboard for payment status. If failed, retry payment. If pending, wait for webhook.  
**Do NOT proceed** to Phase 4 until invoice is paid.

### Scenario B: Points duplicated (multiple entries for same invoice)
**Diagnosis:** Both `checkout.session.completed` and `invoice.payment_succeeded` fired, or webhook retried  
**Action:** Use `reconcileCustomerLoyalty` function to recalculate and correct  
**Log:** Document which events fired with timestamps

### Scenario C: Points amount incorrect
**Diagnosis:** Logic error in points calculation  
**Action:** Check stripeWebhook code (lines 341-373 and 476-490)  
**Verify:** formula = `Math.floor(amountPaid * 10)`

### Scenario D: Customer App Subscription not created
**Diagnosis:** Webhook failed or Subscription creation has error  
**Action:** Check stripeWebhook logs for subscription creation (lines 66-122)  
**Check:** Error in `syncCustomerToHub`

### Scenario E: Final points != before + (10 × invoice amount)
**Diagnosis:** Reconciliation issue or untracked point award  
**Action:** Run `reconcileCustomerLoyalty(amark@nuvisionarymedia.com)` to verify and correct  
**Log:** Document points before and after

---

## 📝 TEST EXECUTION LOG

### Test Start
- **Date/Time:** _______________________
- **Executed By:** _______________________
- **Environment:** LIVE
- **Test Customer:** amark@nuvisionarymedia.com

### Test Results

#### Phase 1: Pre-Test Snapshot
- Points Before Purchase: ___________
- Status: ✅ PASS / ❌ FAIL

#### Phase 2: Subscription Purchase
- Subscription Plan: ___________
- Amount: $___________
- Payment Status: ✅ SUCCESS / ❌ FAILED
- Stripe Subscription ID: ___________

#### Phase 3: Immediate Post-Purchase
- Stripe Sub Status: ___________
- Invoice Paid: ✅ YES / ❌ NO
- App Subscription Created: ✅ YES / ❌ NO
- Points Awarded: ___________
- Duplication Detected: ✅ NO / ❌ YES
- Overall Status: ✅ PASS / ❌ FAIL

#### Phase 4: Frontend Verification
- Rewards Page Points: ___________
- Account Page Points: ___________
- Consistent: ✅ YES / ❌ NO
- Order History Status: ___________

#### Phase 5: Final Verification
- Points Final: ___________
- No Delayed Duplication: ✅ YES / ❌ NO
- Overall: ✅ PASS / ❌ FAIL

### Final Result
**OVERALL TEST STATUS:** ✅ PASS / ❌ FAIL

**Notes:**
```
_____________________________________________________________________________
_____________________________________________________________________________
_____________________________________________________________________________
```

---

## 🎯 NEXT STEPS

### If PASS:
1. ✅ Subscription loyalty verified
2. ✅ Ready to test subscription pause/skip/cancel (in separate test run)
3. ✅ Ready to test refund (in separate test run)
4. ✅ Ready for customer-facing subscription feature launch

### If FAIL:
1. ❌ Identify failure scenario above
2. ❌ Apply remediation
3. ❌ Re-execute Phase 3 and Phase 5
4. ❌ Do NOT proceed to refund/pause tests

---

## 📊 METRICS TO TRACK

- **Time from payment to point award:** _________ seconds
- **Time from first webhook to all systems settled:** _________ seconds
- **Total point entries created:** _________
- **Total unique point entries:** _________
- **Duplicate rate:** _________% (should be 0%)
- **Webhook retry count:** _________

---

**Test Execution Date:** 2026-05-07  
**Test Completed:** ___________  
**Result:** ✅ PASS / ❌ FAIL  
**Signature:** ___________