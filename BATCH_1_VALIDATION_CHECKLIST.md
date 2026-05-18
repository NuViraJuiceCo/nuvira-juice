# Batch 1 Validation Checklist
## Customer App Post-Cleanup Testing

**Validation Window:** 24 hours (2026-05-15 to 2026-05-16)  
**Deleted Functions:** shopifyGetAccessToken, zone3LiveApprovalTestHelper, monitorLiveCheckoutTest  
**Status:** Ready for Testing  
**Approval Gate:** All tests must PASS before proceeding to Batch 2  

---

## TEST EXECUTION LOG

**Tester:** _____  
**Date Started:** 2026-05-15  
**Time Started:** _____  
**Browser/Device:** _____  

---

## CRITICAL PATH TESTS (Must Pass)

### Test 1: Homepage Load (Desktop)

**Objective:** Verify homepage renders without errors on desktop

**Steps:**
```
1. Open app in desktop browser (Chrome, Firefox, Safari)
2. Navigate to / (homepage)
3. Wait for full load (all images, cards visible)
4. Scroll through entire page
5. Check browser console for errors (F12 → Console)
```

**Expected Results:**
- [ ] Page loads within 3 seconds
- [ ] All hero banner images display
- [ ] Product rows visible and scrollable
- [ ] Navigation bar responsive and clickable
- [ ] Zero red errors in browser console
- [ ] Zero 404 errors for resources
- [ ] No function errors mentioning deleted functions

**Failure Handling:**
- If errors appear, note exact error message
- Check if error mentions: `shopifyGetAccessToken`, `zone3LiveApprovalTestHelper`, `monitorLiveCheckoutTest`
- If yes → potential issue, investigate. If no → likely existing error, not caused by cleanup

**Result:** ☐ PASS ☐ FAIL  
**Notes:** _____

---

### Test 2: Homepage Load (Mobile)

**Objective:** Verify homepage renders correctly on mobile devices

**Steps:**
```
1. Use mobile device OR desktop browser in mobile mode (F12 → toggle device toolbar)
2. Set viewport to iPhone 14 Pro (390x844)
3. Navigate to / (homepage)
4. Wait for full load
5. Scroll top to bottom
6. Check console for errors
```

**Expected Results:**
- [ ] Page loads within 4 seconds on mobile
- [ ] No layout breaks or overlapping elements
- [ ] Horizontal scrolling works smoothly
- [ ] Touch interactions responsive
- [ ] Zero console errors
- [ ] Safe area insets respected (notch on iPhone)

**Failure Handling:**
- Note specific layout breaks
- Check if related to deleted functions

**Result:** ☐ PASS ☐ FAIL  
**Notes:** _____

---

### Test 3: Products Load

**Objective:** Verify product data fetches and displays correctly

**Steps:**
```
1. From homepage, click "Shop" or navigate to /shop
2. Wait for product grid to load
3. Verify product cards display: image, name, price, "Add to Cart" button
4. Scroll through product list
5. Click on one product → /shop/{id}
6. Verify product detail page loads with: image gallery, description, price, reviews
```

**Expected Results:**
- [ ] Product grid loads within 2 seconds
- [ ] All product cards have images
- [ ] All products have correct pricing
- [ ] "Add to Cart" button visible and clickable
- [ ] Product detail page loads correctly
- [ ] No 404 errors or missing data
- [ ] Zero console errors

**Failure Handling:**
- If products don't load: Check if base44.entities.Product.list() is working
- If images missing: Check image URLs in product data
- If prices missing: Check if price field is populated

**Result:** ☐ PASS ☐ FAIL  
**Notes:** _____

---

### Test 4: Cart Functionality

**Objective:** Verify cart add, remove, and update operations work

**Steps:**
```
1. Click "Add to Cart" on any product
2. Verify cart icon shows count (1)
3. Click cart icon or navigate to /cart
4. Verify item appears in cart with: image, price, quantity selector
5. Click "+" to increase quantity → verify total updates
6. Click "-" to decrease quantity → verify total updates
7. Click "Remove" (trash icon) → verify item removed
8. Add 3 items to cart
9. Verify subtotal and "from $3.99" delivery fee displayed
```

**Expected Results:**
- [ ] Items add to cart successfully
- [ ] Cart count badge updates
- [ ] Quantity controls work (+ and -)
- [ ] Total price recalculates correctly
- [ ] Remove button deletes item
- [ ] Subtotal calculation correct
- [ ] Delivery fee message displays
- [ ] Cart persists on page reload
- [ ] Zero console errors

**Failure Handling:**
- If add to cart fails: Check useCart hook in cartContext
- If quantity doesn't update: Check updateQuantity function
- If total wrong: Check subtotal calculation logic

**Result:** ☐ PASS ☐ FAIL  
**Notes:** _____

---

### Test 5: Checkout Session Creation

**Objective:** Verify checkout session creates successfully

**Steps:**
```
1. From /cart with 3+ items, click "Checkout" button
2. Verify redirect to /checkout page
3. Verify form loads with: address field, delivery date picker, items summary
4. Fill address: "619 N Main St, O'Fallon, MO 63366" (Zone 1A)
5. Select delivery date (closest available)
6. Verify subtotal and delivery fee displayed
7. Scroll to bottom → click "Checkout" button
8. Wait for Stripe checkout to open (iframe or hosted page)
```

**Expected Results:**
- [ ] Checkout page loads
- [ ] Address autocomplete works
- [ ] Delivery date picker displays valid dates
- [ ] Order summary shows all items
- [ ] Total includes subtotal + delivery fee
- [ ] "Checkout" button is clickable
- [ ] Stripe checkout opens (either embedded or hosted)
- [ ] Zero console errors about deleted functions
- [ ] No errors in backend logs

**Failure Handling:**
- If checkout doesn't redirect: Check createCheckoutSession function
- If Stripe doesn't open: Check Stripe publishable key and session creation
- If address validation fails: Check validateDeliveryEligibility function

**Important Note:** Do NOT complete the payment yet. Just verify the checkout session opens.

**Result:** ☐ PASS ☐ FAIL  
**Notes:** _____

---

### Test 6: Stripe Payment Flow (Test or Controlled Live)

**Objective:** Verify order can be completed through payment

**Steps (Use Test Card):**
```
1. From Stripe checkout, fill payment details:
   - Card: 4242 4242 4242 4242
   - Expiry: 12/25
   - CVC: 123
   - Name: Test Customer
   - Email: test@nuvirajuice.com
2. Click "Pay" or "Complete Payment"
3. Wait for redirect (should go to /order-confirmation)
4. Verify order confirmation page loads with order number
```

**Expected Results (After Payment):**
- [ ] Payment processed successfully
- [ ] Redirect to /order-confirmation with order ID
- [ ] Order confirmation page displays: order number, items, delivery date, total
- [ ] Order created in database (visible in /account/orders after login)
- [ ] stripeWebhook received and processed (check logs)
- [ ] OrderSyncLog has entry with hub_action='created' (not error)
- [ ] Customer receives confirmation email
- [ ] Zero console errors

**Failure Handling:**
- If payment fails: Check Stripe error in console
- If no confirmation page: Check stripeWebhook handler for errors
- If order not in dashboard: Check getCustomerOrdersWithHub function
- If Hub sync failed: Check syncOrderToHub logs

**Logs to Check:**
```
stripeWebhook: ✅ Payment intent ... succeeded
syncOrderToHub: ✅ Order synced to Hub
CustomerNotification: Order confirmation email sent
```

**Result:** ☐ PASS ☐ FAIL  
**Notes:** _____

---

### Test 7: Order Confirmation Page

**Objective:** Verify order confirmation displays correct details

**Steps:**
```
1. From order confirmation page (after payment)
2. Verify displays: order number, customer info, items, delivery date, total
3. Verify "Track Order" button is clickable
4. Verify "Back to Shop" button navigates to /shop
5. Verify thank you message displays
```

**Expected Results:**
- [ ] Order number displayed (NV-XXXXXXXX format)
- [ ] Customer name and address shown
- [ ] All ordered items listed with quantities and prices
- [ ] Delivery date and time window displayed
- [ ] Total matches amount paid
- [ ] "Track Order" button clickable
- [ ] "Back to Shop" button works
- [ ] Health advisory notice appears if required
- [ ] Zero console errors

**Result:** ☐ PASS ☐ FAIL  
**Notes:** _____

---

### Test 8: Order Tracker (Order Status)

**Objective:** Verify order tracker shows correct status updates

**Steps:**
```
1. Click "Track Order" from confirmation, or navigate to /order-tracker/{order_id}
2. Verify order status displays (should be "scheduled_for_juicing")
3. Verify timeline shows: Order Received → Scheduled → In Production → Delivered
4. Verify delivery date and window shown
5. Verify customer contact info displayed
```

**Expected Results:**
- [ ] Order tracker page loads
- [ ] Current status displays with checkmark (Order Received)
- [ ] Timeline shows next steps grayed out
- [ ] Delivery date and window correct
- [ ] Refresh button or auto-refresh works
- [ ] Zero console errors

**Result:** ☐ PASS ☐ FAIL  
**Notes:** _____

---

### Test 9: Subscription Checkout

**Objective:** Verify subscription creation flow works

**Steps:**
```
1. Navigate to /subscribe
2. Select plan (e.g., "Weekly Fresh" $36/week)
3. Click "Subscribe" button
4. Verify Stripe checkout opens
5. Complete payment with test card (4242 4242 4242 4242)
6. Verify redirect to /order-confirmation or success page
```

**Expected Results:**
- [ ] Subscription plan page loads with options
- [ ] Plan descriptions display correctly
- [ ] Pricing shows accurately
- [ ] "Subscribe" button triggers Stripe checkout
- [ ] Stripe hosted checkout opens
- [ ] Payment succeeds with test card
- [ ] Subscription created in database
- [ ] FulfillmentTasks created (4 for monthly, 1 for weekly)
- [ ] Hub receives subscription.created event
- [ ] Zero console errors about deleted functions

**Logs to Check:**
```
stripeWebhook: [checkout.session.completed] Subscription created
syncSubscriptionWithFulfillments: FulfillmentTasks dispatched
OrderSyncLog: hub_action = 'created'
```

**Result:** ☐ PASS ☐ FAIL  
**Notes:** _____

---

### Test 10: Customer Dashboard (Order History)

**Objective:** Verify customer can view order history after login

**Steps:**
```
1. Navigate to /account/orders (will trigger login if not authenticated)
2. Login with test account (email used in checkout)
3. Verify order history loads
4. Verify orders from Tests 6 and 9 appear in list
5. Click on one order → verify detail loads
6. Verify status matches what's in tracker
```

**Expected Results:**
- [ ] Login redirects to order history
- [ ] All orders visible in list
- [ ] Each order shows: order number, status, delivery date, total
- [ ] Order detail page loads with full information
- [ ] "Track Order" and "Reorder" buttons visible
- [ ] Statuses match Hub sync status
- [ ] Zero console errors

**Result:** ☐ PASS ☐ FAIL  
**Notes:** _____

---

### Test 11: Rewards & Loyalty Pages

**Objective:** Verify rewards and loyalty pages load without errors

**Steps:**
```
1. Navigate to /rewards
2. Wait for page to load
3. Verify points display (should show points earned from orders)
4. Verify reward options display (if available)
5. Navigate to /account/settings → check notification preferences
6. Verify loyalty-related UI renders correctly
```

**Expected Results:**
- [ ] Rewards page loads
- [ ] Loyalty points balance displays
- [ ] Points history visible
- [ ] Reward cards display (if any available)
- [ ] Settings page loads
- [ ] Notification preferences toggle work
- [ ] Zero console errors

**Result:** ☐ PASS ☐ FAIL  
**Notes:** _____

---

### Test 12: Health Advisory Acknowledgment

**Objective:** Verify health advisory appears and can be acknowledged

**Steps:**
```
1. During checkout, look for health advisory notice
2. Verify notice displays before payment
3. Verify checkbox appears: "I understand health advisory..."
4. Attempt checkout WITHOUT checking box → should see error or warning
5. Check the box
6. Complete payment
7. Verify acknowledgment is saved
```

**Expected Results:**
- [ ] Health advisory appears on checkout
- [ ] Checkbox required before payment
- [ ] Error shows if unchecked
- [ ] After checking, payment proceeds
- [ ] Acknowledgment saved to Order entity (health_advisory_acknowledged=true)
- [ ] Version number stored (health_advisory_version)

**Result:** ☐ PASS ☐ FAIL  
**Notes:** _____

---

## SECONDARY TESTS (Should Pass)

### Test 13: Chrome Scrolling Issue Re-Test

**Objective:** Verify Chrome scrolling issue doesn't reappear

**Steps:**
```
1. Open app in Chrome on desktop
2. Navigate to /shop
3. Scroll product list left/right (carousel)
4. Scroll page up/down
5. Try to scroll while payment modal open
6. Check for any jank, stuttering, or unresponsive scrolling
```

**Expected Results:**
- [ ] Smooth scrolling on carousel
- [ ] No page-level scroll interference
- [ ] No lag or stuttering
- [ ] Modal scroll independent from page scroll

**Result:** ☐ PASS ☐ FAIL  
**Notes:** _____

---

### Test 14: Backend Function Errors

**Objective:** Verify no new errors from deleted functions

**Steps:**
```
1. Check app logs for errors
2. Search logs for: "shopifyGetAccessToken", "zone3LiveApprovalTestHelper", "monitorLiveCheckoutTest"
3. Check Stripe webhook logs
4. Check integration credit usage
```

**Expected Results:**
- [ ] Zero errors mentioning deleted functions
- [ ] No new error patterns
- [ ] Stripe webhook processing normally
- [ ] Integration credit usage stable (not increased > 20%)

**Logs to Check:**
```bash
grep -i "shopifyGetAccessToken\|zone3LiveApprovalTestHelper\|monitorLiveCheckoutTest" logs/*
# Should return: [empty]

grep -i "ERROR\|FAILED" logs/* | head -20
# Should show existing errors, not new ones
```

**Result:** ☐ PASS ☐ FAIL  
**Notes:** _____

---

## MONITORING METRICS (Track for 24 Hours)

### Metric 1: Order Sync Success Rate

**Check hourly:**
```sql
SELECT hub_action, COUNT(*) FROM OrderSyncLog 
WHERE created_date > NOW() - INTERVAL 1 HOUR
GROUP BY hub_action;
```

**Expected:** success/created >= 95%, error < 5%  
**Alert if:** Error rate spikes to > 10%

**Results:**
| Hour | Success | Error | Notes |
|------|---------|-------|-------|
| Hour 1 | ___% | ___% | |
| Hour 2 | ___% | ___% | |
| Hour 3 | ___% | ___% | |
| [24 hours total] | | | |

---

### Metric 2: Function Errors

**Check every 4 hours:**
```
New errors in logs?
YES ☐  NO ☐
Error patterns changed?
YES ☐  NO ☐
Any deleted function mentions?
YES ☐  NO ☐
```

---

### Metric 3: Integration Credit Burn

**Check every 6 hours:**
```
Baseline (pre-cleanup): [record value] credits/hour
Current burn rate: _____ credits/hour
Increase > 20%?
YES ☐ → ALERT  NO ☐ → OK
```

---

### Metric 4: Critical Function Status

**Check every 12 hours:**

| Function | Status | Notes |
|----------|--------|-------|
| stripeWebhook | ☐ OK ☐ ERROR | |
| syncOrderToHub | ☐ OK ☐ ERROR | |
| createCheckoutSession | ☐ OK ☐ ERROR | |
| syncSubscriptionWithFulfillments | ☐ OK ☐ ERROR | |

---

## VALIDATION SUMMARY

### Overall Result

**All Critical Tests:** ☐ PASS ☐ FAIL  
**All Secondary Tests:** ☐ PASS ☐ FAIL  
**Monitoring Metrics:** ☐ STABLE ☐ DEGRADED  

### Issues Found

```
Issue #1:
  Description: _____
  Severity: ☐ Critical ☐ High ☐ Medium ☐ Low
  Related to Batch 1? ☐ Yes ☐ No
  Action: _____

Issue #2:
  Description: _____
  Severity: ☐ Critical ☐ High ☐ Medium ☐ Low
  Related to Batch 1? ☐ Yes ☐ No
  Action: _____
```

---

## SIGN-OFF

**Validation Period:** 2026-05-15 to 2026-05-16 (24 hours)  
**Tested By:** _____  
**Date Completed:** _____  

### Final Decision

**Overall Status:**
- [ ] ✅ PASS — All tests passed, no issues, ready for Batch 2
- [ ] ⚠️ PASS WITH WARNINGS — Minor issues found, document and monitor
- [ ] ❌ FAIL — Critical issues found, ROLLBACK recommended

### Recommendation

**Proceed to Batch 2?**
- [ ] YES — Validation passed, ready to disable automations
- [ ] NO — Issues found, investigate before proceeding
- [ ] MAYBE — Wait for 24h monitoring to complete

---

**⏸️ VALIDATION CHECKPOINT**

Do NOT proceed to Batch 2 (disable automations) until:
1. ✅ All 14 tests PASS
2. ✅ 24-hour monitoring shows stable metrics
3. ✅ Zero new errors from deleted function names
4. ✅ Integration credit usage normal
5. ✅ Approval given by team lead

---

**Estimated Time to Complete:** 2-3 hours for all tests + 24h monitoring = ~27 hours total