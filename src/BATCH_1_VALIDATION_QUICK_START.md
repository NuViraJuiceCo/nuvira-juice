# Batch 1 Validation: Quick Start Guide
## Execute in Next 2-3 Hours, Monitor for 24 Hours

**Status:** Ready to test  
**Deleted Functions:** shopifyGetAccessToken, zone3LiveApprovalTestHelper, monitorLiveCheckoutTest  
**Expected Result:** All tests PASS → Proceed to Batch 2  

---

## EXECUTE NOW (Next 2-3 Hours)

### Top 5 Critical Tests (Run These First)

Run in this order on desktop + mobile:

| # | Test | Device | Expected | Notes |
|---|------|--------|----------|-------|
| 1 | Homepage loads | Desktop + Mobile | ✅ No errors | Check console (F12) |
| 2 | Products load | Desktop | ✅ Images + prices | /shop |
| 3 | Add to cart | Desktop | ✅ Count updates | Click "Add to Cart" |
| 4 | Checkout session | Desktop | ✅ Stripe opens | Should see payment form |
| 5 | Complete order | Desktop | ✅ Confirmation page | Use test card: 4242 4242 4242 4242 |

**Time estimate:** 30 min for all 5 tests

---

### After Top 5, Run These 9 Tests

6. Order confirmation page displays correctly
7. Order tracker shows status
8. Subscription checkout works
9. Customer dashboard (order history) loads
10. Rewards & loyalty pages load
11. Health advisory appears + can be acknowledged
12. Chrome scrolling is smooth (carousel + page scroll)
13. Backend logs show zero errors about deleted functions
14. Integration credit burn is normal (< 20% increase)

**Time estimate:** 1.5-2 hours for all 9

---

## FULL CHECKLIST

→ See **BATCH_1_VALIDATION_CHECKLIST.md** for detailed steps, pass/fail criteria, and logs to check

---

## MONITORING (24 Hours: 2026-05-15 → 2026-05-16)

### What to Track Every 4-6 Hours

```
1. Order Sync Success Rate
   Query: SELECT hub_action, COUNT(*) FROM OrderSyncLog 
          WHERE created_date > NOW() - INTERVAL 4 HOURS
          GROUP BY hub_action;
   
   Expected: success >= 95%, error < 5%
   Alert if: error > 10%

2. New Errors in Logs
   Search: grep -i "shopifyGetAccessToken\|zone3LiveApprovalTestHelper\|monitorLiveCheckoutTest" logs/*
   Expected: [empty]
   Alert if: Any matches

3. Critical Function Status
   Functions to check: stripeWebhook, syncOrderToHub, createCheckoutSession
   Expected: Zero new errors
   Alert if: Any function failing

4. Integration Credit Usage
   Compare: Daily burn rate vs. baseline
   Expected: Baseline ±10%
   Alert if: > 20% increase
```

### Simple Monitoring Checklist

**Hour 0 (Now):** Run 5 critical tests  
**Hour 1-2:** Run 9 secondary tests  
**Hour 6:** Check logs + metrics ☐ OK ☐ Issues  
**Hour 12:** Check logs + metrics ☐ OK ☐ Issues  
**Hour 18:** Check logs + metrics ☐ OK ☐ Issues  
**Hour 24:** Final check + sign-off ☐ PASS ☐ FAIL  

---

## DECISION TREE

**After 24h monitoring, choose:**

```
Did all 14 tests PASS?
  ├─ YES → Check logs for any errors
  │         ├─ Zero deleted function errors? 
  │         │  ├─ YES → ✅ PROCEED TO BATCH 2
  │         │  └─ NO  → 🔴 ROLLBACK
  │         └─ Any other critical errors?
  │            ├─ YES → ⚠️  INVESTIGATE (may not be Batch 1 related)
  │            └─ NO  → ✅ PROCEED TO BATCH 2
  │
  └─ NO → 🔴 ROLLBACK IMMEDIATELY
          ├─ Restore 3 functions from FUNCTION_BACKUP_ARCHIVE.md
          ├─ Deploy
          └─ Re-test
```

---

## QUICK REFERENCE: Logs to Check

**Check these locations for errors:**

1. **Browser Console** (F12 → Console tab)
   - Should show zero errors about deleted functions
   - Note any other errors

2. **Backend Function Logs** (Dashboard → Code → Logs)
   - stripeWebhook errors
   - syncOrderToHub errors
   - createCheckoutSession errors

3. **OrderSyncLog** (Database)
   ```sql
   SELECT * FROM OrderSyncLog 
   WHERE created_date > NOW() - INTERVAL 24 HOURS
   ORDER BY created_date DESC;
   ```
   Expected: Most recent orders have hub_action='created' or 'updated' (not 'error')

4. **Search for Deleted Function Names**
   ```bash
   grep -r "shopifyGetAccessToken" logs/
   grep -r "zone3LiveApprovalTestHelper" logs/
   grep -r "monitorLiveCheckoutTest" logs/
   ```
   Expected: [empty] — no results

---

## IF YOU FIND ISSUES

**Issue detected?**

1. **Check if it's Batch 1 related:**
   - Does error mention deleted function names? → YES = Batch 1 issue
   - Is it a new error pattern? → Compare to baseline
   - Did it start after Batch 1? → Check timestamp

2. **If Batch 1 related:**
   - ROLLBACK immediately (< 5 min)
   - Restore from FUNCTION_BACKUP_ARCHIVE.md
   - Re-test

3. **If NOT Batch 1 related:**
   - Document issue
   - Continue monitoring (may be pre-existing)
   - Proceed to Batch 2 if test pass otherwise

---

## ROLLBACK (If Needed)

**Steps:** (< 5 minutes)

1. Get code from FUNCTION_BACKUP_ARCHIVE.md
2. Recreate files:
   - functions/shopifyGetAccessToken.js
   - functions/zone3LiveApprovalTestHelper.js
   - functions/monitorLiveCheckoutTest.js
3. Deploy
4. Re-test top 5 critical tests
5. Verify logs clear

---

## READY? START HERE

### Step 1: Run 5 Critical Tests (30 min)

**Desktop:**
1. Homepage / → check console
2. /shop → verify products load
3. Add item to cart → verify count badge updates
4. Click cart → /checkout → verify form loads
5. Complete payment (test card) → check order confirmation

**Mobile:**
1. Homepage / → check for layout breaks
2. /shop → verify mobile layout
3. Add item → verify cart works
4. Click checkout → verify mobile checkout

### Step 2: Run 9 Secondary Tests (1.5-2 hours)

→ Follow BATCH_1_VALIDATION_CHECKLIST.md for detailed steps

### Step 3: Monitor 24 Hours

→ Track metrics every 4-6 hours (see Monitoring section above)

### Step 4: Sign-Off

After 24h, document:
- ✅ All tests passed
- ✅ Zero deleted function errors
- ✅ Metrics stable
- ✅ Ready for Batch 2 (or rollback if issues)

---

**⏱️ Timeline:**
- Tests: 2-3 hours
- Monitoring: 24 hours
- Total: ~27 hours before Batch 2 approval

**🚀 Ready to start?** Open BATCH_1_VALIDATION_CHECKLIST.md and begin with Test 1.