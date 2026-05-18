# Regression Test Checklist
## Post-Cleanup Verification (Run After Each Batch)

**Purpose:** Confirm no critical flows broken after function deletions/disables  
**Schedule:** After Batch 1 (immediate), Batch 2 (24h), Batch 3 (48h)  
**Owner:** QA / Product Team  

---

## CRITICAL PATH TESTS (MUST PASS - No Exceptions)

### ✅ Test 1: One-Time Order Checkout

**Scenario:** Customer places a one-time order (no subscription)

```
Step 1: Open app → /shop
Step 2: Add item to cart (any juice)
Step 3: Click "Checkout" → /checkout
Step 4: Fill delivery address (Zone 1A - within service area)
Step 5: Select delivery date (closest available)
Step 6: Click "Checkout" button → Stripe hosted checkout
Step 7: Complete payment (use test card 4242 4242 4242 4242)
Step 8: Redirect to /order-confirmation
```

**Expected Results:**
- [ ] Order created in database (visible in /account/orders)
- [ ] Order status = 'scheduled_for_juicing'
- [ ] Payment status = 'paid'
- [ ] OrderSyncLog has entry with hub_action = 'created' (not 'error')
- [ ] Customer receives confirmation email (check inbox / Resend logs)
- [ ] In-app notification created (Notification entity)
- [ ] Delivery date is valid (Wed or Sat)
- [ ] Order total matches amount paid to Stripe

**Failure Handling:**
- If ❌ Order not created: Check stripeWebhook logs for errors
- If ❌ Hub sync failed: Check syncOrderToHub logs, verify HUB_API_URL is reachable
- If ❌ Email not sent: Check sendOrderReceivedNotification function
- If ❌ Invalid delivery date: Check calculateNuViraFulfillmentSchedule

**Logs to Check:**
```
// Look for these patterns
stripeWebhook: ✅ Checkout session ... created after payment completed
syncOrderToHub: ✅ Order ... synced to Hub successfully
sendOrderReceivedNotification: Email sent to ...
Notification: In-app notification created
```

---

### ✅ Test 2: Subscription Creation (Stripe Hosted)

**Scenario:** Customer creates a subscription (weekly or monthly)

```
Step 1: Open app → /subscribe
Step 2: Select plan (e.g., "Weekly Fresh")
Step 3: Click "Subscribe" → Stripe hosted checkout
Step 4: Complete payment
Step 5: Redirect to confirmation
```

**Expected Results:**
- [ ] Subscription created in database
- [ ] Subscription status = 'active'
- [ ] Stripe subscription ID stored (stripe_subscription_id)
- [ ] 4 FulfillmentTasks created (weekly deliveries per billing cycle)
- [ ] Hub received subscription.created event
- [ ] OrderSyncLog shows 'success' for subscription sync
- [ ] Customer receives subscription confirmation
- [ ] Loyalty points awarded (10 pts per $1)

**Failure Handling:**
- If ❌ Subscription not created: Check stripeWebhook (checkout.session.completed) logs
- If ❌ FulfillmentTasks missing: Check syncSubscriptionWithFulfillments logs
- If ❌ Hub sync failed: Check OrderSyncLog for error details

**Logs to Check:**
```
stripeWebhook: ✅ Subscription record created
syncSubscriptionWithFulfillments: Hub sync dispatched
OrderSyncLog: hub_action = 'created'
UserPoints: Points awarded
```

---

### ✅ Test 3: Refund Processing

**Scenario:** Admin issues refund via Stripe Dashboard

```
Step 1: Open Stripe Dashboard → last test order from Test 1
Step 2: Issue full refund
Step 3: Wait 30 sec for webhook
```

**Expected Results:**
- [ ] stripeWebhook receives charge.refunded event
- [ ] Order status = 'refunded'
- [ ] Order.payment_status = 'refunded'
- [ ] OrderSyncLog has refund entry
- [ ] syncRefundToHub sends order.refunded to Hub
- [ ] Loyalty points reversed (if full refund)
- [ ] Customer receives refund notification email

**Failure Handling:**
- If ❌ Webhook not received: Check STRIPE_WEBHOOK_SECRET is correct
- If ❌ Refund not synced to Hub: Check syncRefundToHub logs
- If ❌ Points not reversed: Check UserPoints update logic

**Logs to Check:**
```
stripeWebhook: [charge.refunded] Processing refund
syncRefundToHub: ✅ Order ... refund synced to Hub
UserPoints: Points reversed
```

---

### ✅ Test 4: Shopify POS Order

**Scenario:** Order created in Shopify POS (if available)

```
Step 1: Create order in Shopify POS
Step 2: Verify webhook received
```

**Expected Results:**
- [ ] shopifyWebhookReceiver receives order.created
- [ ] ShopifyOrder record created in database
- [ ] syncShopifyOrderToHub sends order to Hub
- [ ] OrderSyncLog shows successful sync

**Failure Handling:**
- If ❌ Webhook not received: Check Shopify webhook configuration
- If ❌ ShopifyOrder not created: Check shopifyWebhookReceiver logs
- If ❌ Hub sync failed: Check syncShopifyOrderToHub logs

**Logs to Check:**
```
shopifyWebhookReceiver: Order received
syncShopifyOrderToHub: ✅ ShopifyOrder synced
OrderSyncLog: status = 'success'
```

---

### ✅ Test 5: Order Dashboard

**Scenario:** Customer views their order history

```
Step 1: Login (if required) → /account/orders
Step 2: Verify all orders from Tests 1-4 are visible
```

**Expected Results:**
- [ ] All orders visible with correct status
- [ ] Delivery dates correct (Wed or Sat)
- [ ] Order totals correct
- [ ] Order timeline updated in real-time
- [ ] No missing orders

**Failure Handling:**
- If ❌ Orders not visible: Check getCustomerOrdersWithHub function
- If ❌ Status not updated: Check order sync status in database

---

### ✅ Test 6: Loyalty Points & Rewards

**Scenario:** Verify loyalty points earned and redemption

```
Step 1: Check UserPoints after order from Test 1
Step 2: Verify points = order_total * 10
Step 3: Go to /rewards → try to claim reward if available
```

**Expected Results:**
- [ ] Points awarded after successful order payment
- [ ] Points history updated with order details
- [ ] Redemption deducts points
- [ ] Free product claim works (if eligible)

**Failure Handling:**
- If ❌ Points not awarded: Check stripeWebhook loyalty logic
- If ❌ Redemption failed: Check claimReward function logs

---

### ✅ Test 7: Hub Sync Status

**Scenario:** Verify orders are syncing to Hub correctly

```
Step 1: Open database → OrderSyncLog
Step 2: Query last 24 hours of syncs
Step 3: Check status distribution
```

**Expected Results:**
- [ ] 95%+ of recent orders have hub_action = 'created' or 'updated'
- [ ] No spike in 'error' status (< 5% of recent)
- [ ] Sync latency < 5 minutes (order created to Hub created)
- [ ] No 'queued_for_review' stuck orders

**Failure Handling:**
- If ❌ High error rate: Check syncOrderToHub logs for pattern
- If ❌ High latency: Check Hub endpoint reachability

**Metrics Query:**
```sql
-- Recent sync status distribution
SELECT hub_action, COUNT(*) as count
FROM OrderSyncLog
WHERE created_date > NOW() - INTERVAL 24 HOURS
GROUP BY hub_action;

-- Expected output:
-- hub_action=created: 90%+
-- hub_action=error: < 5%
-- hub_action=skipped: < 5%
```

---

## SECONDARY TESTS (Should Pass)

### 🟡 Test 8: Zone 3 Delivery Request

**Scenario:** Customer requests delivery in Zone 3 (manual approval)

```
Step 1: Add item → /checkout
Step 2: Enter Zone 3 address (outside normal service area)
Step 3: Click "Request Route Review" (or similar)
Step 4: Complete payment with auth hold
```

**Expected Results:**
- [ ] PaymentIntent created with metadata
- [ ] Stripe sends payment_intent.amount_capturable_updated
- [ ] DAR (DeliveryApprovalRequest) created with status='pending_review'
- [ ] Admin notified of pending review
- [ ] Customer receives "submitted" notification
- [ ] Admin can approve/deny in admin panel

**Test Pass Condition:** No errors in logs, DAR created with auth hold

---

### 🟡 Test 9: Production Schedule

**Scenario:** Verify order scheduling is correct

```
Step 1: Create order on Monday
Step 2: Check assigned_delivery_date
```

**Expected Results:**
- [ ] Production date = Friday or Tuesday (next production window)
- [ ] Delivery date = Saturday or Wednesday (next delivery window)
- [ ] Delivery window correct for day (5 PM-8 PM for Wed, 12 PM-3 PM for Sat)

**Test Pass Condition:** Schedule matches NuVira rules (2 PM CDT cutoff)

---

### 🟡 Test 10: Mobile Checkout

**Scenario:** Test checkout on mobile browser

```
Step 1: Use mobile device or browser dev tools
Step 2: Navigate to /checkout
Step 3: Complete checkout
```

**Expected Results:**
- [ ] No layout breaks
- [ ] Form fields accessible
- [ ] Stripe checkout loads properly
- [ ] Payment succeeds

**Test Pass Condition:** No UI errors, successful payment

---

## MONITORING METRICS (Track During Windows)

### Metric 1: Integration Credit Burn

**Check:** Are we using more credits after changes?

```sql
-- Log invocation count per function per day
SELECT function_name, DATE(created_date), COUNT(*) as invocation_count
FROM FunctionLogs
WHERE created_date > NOW() - INTERVAL 48 HOURS
GROUP BY function_name, DATE(created_date)
ORDER BY invocation_count DESC;

-- Compare to baseline (same period last week)
```

**Alert if:**
- Invocation count increased > 20% for remaining functions
- New error patterns in logs

---

### Metric 2: Order Sync Success Rate

**Check:** Are orders reaching Hub?

```sql
-- Recent order sync status
SELECT 
  CASE 
    WHEN hub_action IN ('created', 'updated', 'dedupe_exact_match') THEN 'success'
    WHEN hub_action = 'error' THEN 'error'
    ELSE 'other'
  END as category,
  COUNT(*) as count
FROM OrderSyncLog
WHERE created_date > NOW() - INTERVAL 24 HOURS
GROUP BY category;

-- Expected: success >= 95%
```

**Alert if:** Error rate > 5% or unknown category > 10%

---

### Metric 3: Order Creation Latency

**Check:** How fast are orders going from payment to Hub?

```sql
-- Measure time from order.created to hub_action
SELECT 
  o.order_number,
  o.created_date as order_created,
  l.created_date as log_created,
  EXTRACT(MINUTE FROM (l.created_date - o.created_date)) as latency_minutes
FROM Order o
JOIN OrderSyncLog l ON o.order_number = l.order_number
WHERE o.created_date > NOW() - INTERVAL 24 HOURS
ORDER BY latency_minutes DESC;

-- Expected: latency < 5 minutes for 95% of orders
```

**Alert if:** 90th percentile latency > 10 minutes

---

### Metric 4: Subscription Fulfillment

**Check:** Are subscriptions creating correct FulfillmentTasks?

```sql
-- Count fulfillment tasks per subscription
SELECT 
  s.id as subscription_id,
  s.customer_email,
  COUNT(f.id) as fulfillment_count
FROM Subscription s
LEFT JOIN FulfillmentTask f ON s.id = f.subscription_id
WHERE s.created_date > NOW() - INTERVAL 24 HOURS
GROUP BY s.id, s.customer_email;

-- Expected: fulfillment_count = 4 for monthly, 1 for weekly
```

**Alert if:** Fulfillment count != expected (0 tasks for any subscription)

---

## ROLLBACK DECISION MATRIX

**Use this table to decide if you should rollback:**

| Metric | Expected | Actual | Decision |
|--------|----------|--------|----------|
| Order sync success | 95%+ | 100% | ✅ PASS |
| Order sync success | 95%+ | 90% | ⚠️ INVESTIGATE — may be acceptable |
| Order sync success | 95%+ | 80% | ❌ ROLLBACK |
| Function errors | 0 new errors | 0 | ✅ PASS |
| Function errors | 0 new errors | 1-3 | ⚠️ INVESTIGATE |
| Function errors | 0 new errors | 5+ | ❌ ROLLBACK |
| Credit burn | baseline | baseline ±10% | ✅ PASS |
| Credit burn | baseline | baseline +30% | ❌ INVESTIGATE |
| Subscription fulfillment | 100% correct | 100% | ✅ PASS |
| Subscription fulfillment | 100% correct | 95% | ⚠️ INVESTIGATE |
| Subscription fulfillment | 100% correct | 80% | ❌ ROLLBACK |

---

## SIGN-OFF

**Test Batch #:** _____  
**Date:** _____  
**Tested By:** _____  
**Result:** ☐ PASS ☐ FAIL  
**Issues Found:** _____  
**Resolution:** _____  
**Approved to Proceed:** ☐ YES ☐ NO