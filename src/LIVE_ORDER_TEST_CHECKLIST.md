# 🧪 LIVE ORDER TEST CHECKLIST — Customer App to Hub Sync

**Test Type:** Regular One-Time Purchase (Non-Subscription)  
**Test Mode:** LIVE MODE (Real Payment)  
**Date:** 2026-05-07  
**Priority:** CRITICAL

---

## ✅ BEFORE PURCHASE CHECKS

### Stripe Configuration
- [ ] **Stripe Mode:** Confirm using LIVE keys (`pk_live_*`, `sk_live_*`)
  - Check: `STRIPE_PUBLISHABLE_KEY` env var starts with `pk_live_`
  - Check: `STRIPE_SECRET_KEY` env var starts with `sk_live_`
  
- [ ] **Webhook Endpoint Active:** 
  - URL: `https://[your-app].base44.app/functions/stripeWebhook`
  - Events enabled: `checkout.session.completed`, `payment_intent.succeeded`, `payment_intent.payment_failed`
  - Status: Active in Stripe Dashboard → Developers → Webhooks

- [ ] **payment_intent.succeeded Webhook:** 
  - ✅ ENABLED (critical for embedded checkout flow)

### Customer App Sync Configuration
- [ ] **syncOrderToHub Function:** Active and deployed
  - Endpoint: `/functions/syncOrderToHub`
  - Status: No errors in function logs

- [ ] **Hub Sync Mode:** Automatic (not manual pull only)
  - Hub receives orders via `syncOrderToHub` on payment success

- [ ] **Abandoned Checkout Cleanup:** Active
  - Function: `cancelAbandonedCheckouts`
  - Schedule: Running every 15-30 minutes

- [ ] **pending_payment Orders Blocked:**
  - Orders with `status: 'pending_payment'` do NOT sync to Hub
  - Orders do NOT appear in Driver Portal until `payment_captured: true`

- [ ] **Hub Driver Portal Only:**
  - ✅ Customer App Driver Portal REMOVED/DISABLED
  - Only Hub Driver Portal is in use for delivery operations

---

## 🛒 PURCHASE STEPS

### Test Order Configuration
**Product:** Single regular bottle (simplest product)  
**Fulfillment:** Delivery  
**Address:** Real delivery address  
**Payment:** Real payment method (card/Apple Pay/Google Pay)

### Execution Steps
1. [ ] Open LIVE Customer App (published URL, not preview)
2. [ ] Add **1 regular juice bottle** to cart (no subscriptions, no programs)
3. [ ] Proceed to Checkout
4. [ ] Enter customer info:
   - Name: [Test Customer Name]
   - Email: [test@example.com]
   - Phone: [Real phone number]
   - Delivery Address: [Complete real address]
5. [ ] Select delivery date (accept default)
6. [ ] **DO NOT** use:
   - ❌ Subscription
   - ❌ Rewards/Points
   - ❌ NuVira Credits
   - ❌ Bag Return
   - ❌ Referral Code
   - ❌ 3-Day Program
7. [ ] Complete payment with real card
8. [ ] Wait for Order Confirmation screen
9. [ ] **DO NOT** manually refresh/sync Hub yet
10. [ ] **DO NOT** manually edit any records

---

## 📊 VERIFICATION CHECKLIST

### 1. Customer App (Immediate — Within 1 Minute)

Navigate to: `/account/orders`

- [ ] **Order Appears in Order History**
  - Order Number: `NV-________`
  - Status: Should NOT be `pending_payment`
  - Expected Status: `scheduled_for_juicing` or `order_received`

- [ ] **Payment Status Correct**
  - `payment_status`: `paid` ✅
  - `payment_captured`: `true` ✅
  - `financial_status`: `paid` ✅ (if field exists)

- [ ] **Order Details Correct**
  - Product: [Correct juice name]
  - Quantity: 1
  - Total: $[Correct amount]
  - Delivery Date: [Correct date]
  - Address: [Complete address matches input]
  - Customer Name: [Correct name]
  - Phone: [Correct phone]

- [ ] **No Duplicate Orders**
  - Only ONE active order with this order number
  - No abandoned/pending duplicate orders

---

### 2. Stripe Dashboard (Within 2 Minutes)

Navigate to: Stripe Dashboard → Payments

- [ ] **PaymentIntent Status:** `succeeded` ✅
- [ ] **Charge Status:** Captured ✅
- [ ] **Mode:** LIVE (not TEST) ✅
- [ ] **PaymentIntent ID:** `pi________________`
- [ ] **Amount:** $[Correct amount] ✅
- [ ] **Metadata Includes:**
  - `order_number`: NV-________
  - `customer_email`: test@example.com
  - `customer_name`: [Name]
  - `base44_app_id`: [App ID]

- [ ] **No Duplicate PaymentIntents**
  - Only ONE successful PI for this order

---

### 3. Hub Orders (Within 3-5 Minutes)

Navigate to: Hub Driver Portal → Orders

**CRITICAL:** Do not manually pull orders — verify automatic sync

- [ ] **Order Appears Automatically**
  - Order Number: NV-________
  - Hub Order ID: [Hub-assigned ID]

- [ ] **Payment Status:** `paid` ✅
- [ ] **Production Status:** `awaiting_production` or equivalent ✅
- [ ] **Order Lock Status:** Not broken/incorrectly fulfilled ✅

- [ ] **Customer Information Correct:**
  - Name: ✅
  - Email: ✅
  - Phone: ✅
  - Address: ✅

- [ ] **Line Items Correct:**
  - Product: [Correct juice]
  - Quantity: 1
  - Price: $[Correct]

- [ ] **Delivery Date:** Correct ✅
- [ ] **No Duplicates:** Order appears only ONCE ✅

---

### 4. Production Batch (Within 5 Minutes)

Navigate to: Hub → Production

- [ ] **Production Batch Created/Updated**
  - Batch includes this order
  - Correct production date assigned

- [ ] **Planned Units Increased**
  - Units increased by exactly 1 (the quantity purchased)

- [ ] **Order Sources Correct**
  - New live order appears in batch order sources

- [ ] **No Duplicate Demand**
  - No duplicate batch demand created

- [ ] **No Cancelled/Refunded Orders in Batch**
  - Only paid, active orders included

---

### 5. Fulfillment Task (Within 5 Minutes)

Navigate to: Hub → Fulfillment

- [ ] **FulfillmentTask Created**
  - Task ID: [ID]
  - Linked to correct Hub order ID

- [ ] **Customer Name:** Correct ✅
- [ ] **Delivery Address:** Correct ✅
- [ ] **Delivery Date:** Correct ✅
- [ ] **Task Status:** `Scheduled` or pre-delivery status ✅

- [ ] **No Duplicate Tasks**
  - Only ONE task for this order

---

### 6. Driver Portal (Within 5 Minutes)

Navigate to: Hub Driver Portal → [Delivery Date]

- [ ] **Task Appears for Correct Date**
  - Date: [Delivery date]
  - Stop includes this order

- [ ] **Customer Details Visible:**
  - Name: ✅
  - Address: ✅
  - Phone: ✅

- [ ] **No Duplicate Stops**
  - Order appears only once

---

## 🚨 FAIL CONDITIONS (Immediate Investigation Required)

If ANY of the following occur, **STOP** and investigate:

- [ ] Order stays `pending_payment` after successful charge ❌
- [ ] Order does NOT appear in Hub automatically ❌
- [ ] Order appears MULTIPLE times (duplicate) ❌
- [ ] Production units do NOT update ❌
- [ ] FulfillmentTask is MISSING ❌
- [ ] Driver Portal does NOT show the task ❌
- [ ] Abandoned/pending duplicate appears ACTIVE ❌
- [ ] Customer info or address is MISSING ❌
- [ ] PaymentIntent shows FAILED or incomplete ❌

---

## 📝 TEST RESULTS LOG

### Test Execution

| Field | Value |
|-------|-------|
| **Test Date** | 2026-05-07 |
| **Test Time** | [HH:MM CST] |
| **Order Number** | NV-________ |
| **Stripe PaymentIntent ID** | `pi________________` |
| **Product Purchased** | [Juice Name] |
| **Total Amount** | $_______ |
| **Customer Email** | [email] |
| **Delivery Date** | [Date] |

### Status After Payment (Customer App)

| Field | Expected | Actual | Pass/Fail |
|-------|----------|--------|-----------|
| Order Status | `scheduled_for_juicing` | | |
| payment_status | `paid` | | |
| payment_captured | `true` | | |
| financial_status | `paid` | | |

### Hub Sync Verification

| Field | Expected | Actual | Pass/Fail |
|-------|----------|--------|-----------|
| Order in Hub? | Yes (auto) | | |
| Hub Order ID | [ID] | | |
| payment_status | `paid` | | |
| production_status | `awaiting_production` | | |
| Customer Name | Correct | | |
| Address | Correct | | |
| Line Items | Correct | | |
| Delivery Date | Correct | | |
| Duplicates? | None | | |

### Production & Fulfillment

| Field | Expected | Actual | Pass/Fail |
|-------|----------|--------|-----------|
| Production Batch Updated? | Yes | | |
| Planned Units Increased? | +1 | | |
| FulfillmentTask Created? | Yes | | |
| Task ID | [ID] | | |
| Task in Driver Portal? | Yes | | |
| Driver Portal Date | [Date] | | |

### Stripe Verification

| Field | Expected | Actual | Pass/Fail |
|-------|----------|--------|-----------|
| PaymentIntent Status | `succeeded` | | |
| Charge Captured? | Yes | | |
| Mode | LIVE | | |
| Metadata Complete? | Yes | | |
| Duplicates? | None | | |

---

## 🔧 TROUBLESHOOTING

### If Order Stays pending_payment

1. Check Stripe webhook logs: Did `payment_intent.succeeded` fire?
2. Check `stripeWebhook` function logs for errors
3. Verify webhook signature validation passed
4. Check if order was marked as `is_abandoned_checkout`

### If Order Doesn't Appear in Hub

1. Check `syncOrderToHub` function logs
2. Verify Hub API credentials are valid
3. Check `OrderSyncLog` entity for sync errors
4. Manually trigger sync: `base44.functions.invoke('syncOrderToHub', { order_id: '___' })`

### If Duplicate Orders Appear

1. Check webhook retry logs (Stripe may retry failed deliveries)
2. Verify idempotency logic in `stripeWebhook` function
3. Check if multiple PaymentIntents were created

### If Production Units Don't Update

1. Check if order was excluded (pending_payment, cancelled, refunded)
2. Verify production batch logic includes this order
3. Check batch date alignment with order delivery date

---

## ✅ PASS CRITERIA (ALL Must Be True)

- [ ] Payment succeeds in Stripe (LIVE mode)
- [ ] Customer App order becomes `paid`/`captured`
- [ ] Hub receives the order AUTOMATICALLY (no manual sync)
- [ ] Production demand updates correctly (+1 unit)
- [ ] FulfillmentTask is created correctly
- [ ] Driver Portal shows the correct delivery task
- [ ] NO duplicate active orders
- [ ] NO abandoned checkout enters operations

---

## 📞 SUPPORT CONTACTS

If test fails, contact:
- **Developer:** [Your contact]
- **Hub Support:** [Hub support contact]
- **Stripe Support:** https://support.stripe.com

---

## 🎯 NEXT STEPS AFTER SUCCESS

Once this test passes:

1. ✅ Test with subscription order
2. ✅ Test with rewards/points redemption
3. ✅ Test with bag returns
4. ✅ Test with 3-day program
5. ✅ Test refund/cancellation flow
6. ✅ Test high-volume scenario (multiple simultaneous orders)

---

**Test Status:** ⏳ PENDING EXECUTION  
**Last Updated:** 2026-05-07