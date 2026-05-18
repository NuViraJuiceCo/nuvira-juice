# NuVira Customer App - Critical Flows Verification

**Purpose:** Define verification procedures for all critical flows  
**When to Use:** Before any code change is merged to main  
**Required:** Yes - no merge without passing these checks

---

## Critical Flows Matrix

| Flow | Files Affected | Tests Required | Risk Level |
|------|----------------|---------------|-----------|
| Customer Checkout | `/checkout/*`, `/api/createCheckoutSession` | Checkout E2E, payment processing | HIGH |
| Stripe Payments | `/api/stripe*`, `/lib/stripe` | Payment capture, webhook handling, retry logic | HIGH |
| Order Creation | `/api/createOrder`, `/api/*Order*` | Order creation, state management | HIGH |
| Hub Sync | `/api/hubSyncProxy`, `/api/sync*ToHub` | Real-time sync, retry on failure | HIGH |
| Shopify POS | `/api/shopify*` | POS inventory, order sync | MEDIUM |
| Subscriptions | `/api/subscription*`, `/api/generateSubscriptionOrders` | Creation, renewal, pause, cancel, refunds | HIGH |
| Fulfillment | `/api/*FulfillmentSchedule`, `/api/assign*Window` | Production & delivery window assignment | MEDIUM |
| Delivery | `/api/getDeliveryEta`, `/driver/*` | ETA accuracy, driver assignment | MEDIUM |
| Notifications | `/api/send*Notification`, `/api/sendOrderSms` | Email, SMS, push delivery | MEDIUM |
| Loyalty | `/api/loyalty*`, `/api/reconcile*Loyalty` | Points accumulation, reconciliation, sync | MEDIUM |

---

## 1. Customer Checkout Flow

**Files:** `/pages/checkout`, `/components/checkout`, `/api/createCheckoutSession`, `/api/createPaymentIntent`

### Verification Steps

```
[ ] 1. Add item to cart
[ ] 2. Proceed to checkout
[ ] 3. Enter shipping address
[ ] 4. Select delivery window
[ ] 5. Apply discount code (if applicable)
[ ] 6. Proceed to payment
[ ] 7. Enter payment details (Stripe form)
[ ] 8. Confirm order
[ ] 9. Receive confirmation page
[ ] 10. Verify confirmation email sent within 2 min
[ ] 11. Verify order appears in customer account
[ ] 12. Verify order synced to Hub within 5 min
```

### Expected Outcomes

- Order created with correct items and quantities
- Payment captured successfully
- Order status = "pending_confirmation"
- Confirmation email received
- Order visible in Hub with matching metadata
- No duplicate orders created

### Failure Modes

- Orders created without payment
- Checkout form errors
- Payment failures on valid cards
- Orders not syncing to Hub
- Missing confirmation emails

---

## 2. Stripe Payment Processing

**Files:** `/api/createPaymentIntent`, `/api/stripeWebhook`, `/lib/stripe`

### Verification Steps

```
[ ] 1. Initiate payment with valid card
[ ] 2. Verify payment intent created
[ ] 3. Confirm payment (complete Stripe flow)
[ ] 4. Verify payment_intent.succeeded event received
[ ] 5. Verify webhook processed within 2 seconds
[ ] 6. Verify order status updated correctly
[ ] 7. Test declined card (use 4000000000000002)
[ ] 8. Verify error message shown to customer
[ ] 9. Verify no order created for failed payment
[ ] 10. Test payment retry on network failure
[ ] 11. Verify no duplicate charges
```

### Expected Outcomes

- All valid payments succeed
- All invalid payments fail gracefully
- Webhooks processed in real-time
- No duplicate charges
- Proper error messages shown to users
- Retry logic works correctly

### Failure Modes

- Duplicate charges
- Webhook timeouts
- Payment status not updating
- Retry loops
- Missing error messages

---

## 3. Order Sync to Hub

**Files:** `/api/hubSyncProxy`, `/api/syncOrderToHub`, `/api/manualSyncOrders`

### Verification Steps

```
[ ] 1. Create test order via checkout
[ ] 2. Monitor sync logs in real-time
[ ] 3. Verify order appears in Hub within 5 minutes
[ ] 4. Verify order metadata matches:
   [ ] - Items and quantities
   [ ] - Pricing and discounts
   [ ] - Delivery window
   [ ] - Customer info
[ ] 5. Verify sync status logged
[ ] 6. Trigger manual sync
[ ] 7. Verify manual sync completes successfully
[ ] 8. Test failed sync with Hub offline
[ ] 9. Verify retry queue created
[ ] 10. Bring Hub back online
[ ] 11. Verify retried orders sync successfully
[ ] 12. Verify no duplicate orders in Hub
```

### Expected Outcomes

- Orders sync within 5 minutes
- All metadata accurate in Hub
- Manual sync works
- Failed syncs retry automatically
- No duplicates

### Failure Modes

- Orders not syncing
- Metadata mismatches
- Duplicate orders
- Sync loops
- Manual sync failures

---

## 4. Subscription Lifecycle

**Files:** `/api/subscription*`, `/api/generateSubscriptionOrders`, `/api/pauseSubscription`, `/api/cancelSubscriptionFutureRenewal`

### Verification Steps

```
[ ] 1. Create subscription via checkout
[ ] 2. Verify subscription created in Stripe
[ ] 3. Verify subscription appears in customer account
[ ] 4. Verify first fulfillment order generated
[ ] 5. Verify first order synced to Hub
[ ] 6. Wait for renewal cycle (or manually trigger)
[ ] 7. Verify renewal order generated automatically
[ ] 8. Verify renewal payment captured
[ ] 9. Verify renewal order synced to Hub
[ ] 10. Pause subscription
[ ] 11. Verify pause status updated
[ ] 12. Verify no new renewal orders generated
[ ] 13. Resume subscription
[ ] 14. Verify next renewal scheduled
[ ] 15. Cancel subscription
[ ] 16. Verify cancellation processed
[ ] 17. Verify refund calculated correctly
[ ] 18. Verify no further orders generated
```

### Expected Outcomes

- Subscriptions created successfully
- Renewal orders generated automatically
- Renewal payments captured
- Pause/resume work correctly
- Cancellations refund accurately
- No orphaned subscriptions

### Failure Modes

- Missing renewal orders
- Duplicate renewal charges
- Pause not stopping renewals
- Incorrect refund amounts
- Payment failures on renewals

---

## 5. Loyalty & Points System

**Files:** `/api/loyalty*`, `/api/reconcileCustomerLoyalty`, `/api/monitorSubscriptionLoyalty`

### Verification Steps

```
[ ] 1. Create new customer account
[ ] 2. Enroll in loyalty program
[ ] 3. Verify loyalty profile created
[ ] 4. Complete purchase ($X)
[ ] 5. Verify points awarded (Y points)
[ ] 6. Verify points calculation: $X earns Y points
[ ] 7. Complete subscription purchase
[ ] 8. Verify subscription bonus points (if applicable)
[ ] 9. Verify loyalty synced to Hub
[ ] 10. Run loyalty reconciliation
[ ] 11. Verify reconciliation passed (0 mismatches)
[ ] 12. Trigger manual loyalty sync
[ ] 13. Verify manual sync successful
[ ] 14. Check loyalty member status in Hub
```

### Expected Outcomes

- Points awarded per transaction
- Points calculations accurate
- Loyalty data synced to Hub
- Reconciliation passes
- No orphaned records

### Failure Modes

- Points not awarded
- Incorrect calculations
- Loyalty not syncing
- Reconciliation failures
- Duplicate loyalty records

---

## Pre-Merge Sign-Off

**Before merging any change to main, verify:**

- [ ] All affected critical flows tested
- [ ] All verification steps passed
- [ ] No unexpected behavior observed
- [ ] Rollback steps documented
- [ ] CHANGELOG entry added
- [ ] Code diff reviewed on GitHub
- [ ] Regression tests passed

**Sign-Off:** _________________________ Date: _________

---

**Last Updated:** 2026-05-18  
**Review Schedule:** Update when new flows added
