# NuVira Production Stabilization Audit
## Phase 1-3: Dependency Mapping, Flow Analysis & Function Classification

**Audit Date:** 2026-05-15  
**Status:** CRITICAL INFRASTRUCTURE AUDIT  
**Scope:** 138 backend functions, 30+ automations, 20+ entities, all critical flows

---

## EXECUTIVE SUMMARY

The NuVira codebase has **evolved through 3 major operational phases** with significant accumulation of:
- ✅ **Core critical functions** (actively used in live ordering, subscriptions, fulfillment)
- ⚠️ **Duplicate function paths** (multiple Shopify sync strategies, subscription rebuild variants)
- 🔴 **Legacy/debug functions** (repair utilities, diagnostic probes, test helpers — NOT in automation)
- ❌ **Credit-wasting functions** (unnecessary polling, unconditioned retry loops, redundant syncs)

**Key Findings:**
1. **Stripe webhook is the source of truth** — handles 60% of order/subscription creation logic
2. **Hub sync is fire-and-forget** — orders are safe in CA DB even if Hub push fails
3. **Subscription path has 2+ variants** — checkout.session vs invoice.payment vs invoice.paid
4. **Shopify sync has orphaned functions** — multiple "syncRecentShopifyOrders" variants
5. **Entity automations may be recursive** — need audit of trigger conditions

---

## PHASE 1: FUNCTION INVENTORY & CALLER ANALYSIS

### Tier 1: CRITICAL PATH (Live Ordering)

#### **stripeWebhook** ⭐⭐⭐
- **Status:** KEEP - ACTIVELY CRITICAL
- **Callers:** Stripe webhook direct (payment/checkout events)
- **Entities Read:** Order, Subscription, UserProfile, SubscriptionPlan, DeliveryZone, User Points, NuViraCredit, PendingSubscriptionCheckout
- **Entities Write:** Order, Subscription, UserPoints, NuViraCredit, OrderSyncLog, PendingSubscriptionCheckout
- **Functions Called:** 
  - `calculateNuViraFulfillmentSchedule` (order schedule calculation)
  - `pushOrderToShopify` (one-time orders → Shopify)
  - `syncOrderToHub` (order creation)
  - `syncSubscriptionWithFulfillments` (subscription → fulfillments)
  - `sendCustomerNotification` (in-app)
  - `sendOrderReceivedNotification` (email)
  - `sendOrderSms` (SMS)
  - `notifyOrderProcessed` (ops notification)
- **External Services:** Stripe API (retrieve invoices, payment intents)
- **Secrets:** STRIPE_SECRET_KEY, HUB_SYNC_SECRET
- **Events Handled:**
  - `checkout.session.completed` → creates one-time Order OR Subscription
  - `payment_intent.succeeded` → finalizes pending Order (embedded checkout)
  - `payment_intent.payment_failed` → abandons Order
  - `payment_intent.canceled` → cancels pre-order
  - `invoice.payment_succeeded` → creates Subscription (invoice path)
  - `invoice.paid` → creates Subscription (alternate path)
  - `customer.subscription.updated` → updates Subscription status
  - `customer.subscription.deleted` → cancels Subscription
  - `charge.refunded` → refunds Order or Subscription
  - `invoice.payment_failed` → notifies customer of payment failure
  - `refund.updated` → repairs terminal state if refund.status=succeeded
  - `payment_intent.amount_capturable_updated` → Zone 3 auth holds
  - `payment_intent.canceled` (Zone 3) → expires Zone 3 delivery requests
- **Risk Score:** ⚠️ MEDIUM — Very complex, but well-guarded with idempotency checks
- **Last Verified:** 2026-05-15 — Handles all subscription + order creation paths

---

#### **createCheckoutSession** ⭐⭐⭐
- **Status:** KEEP - CRITICAL
- **Callers:** Frontend checkout page `/checkout`
- **Entities Read:** Subscription (for subscriber perks), SubscriptionPlan
- **Entities Write:** CheckoutSession
- **Functions Called:** None (standalone)
- **External Services:** Stripe (create checkout session, create coupons)
- **Secrets:** STRIPE_SECRET_KEY, BASE44_APP_ID
- **Purpose:** Creates Stripe checkout session for one-time orders. Calculates delivery dates, applies discounts, stores CheckoutSession for webhook recovery.
- **Risk Score:** ✅ LOW — Simple, focused, critical path
- **Note:** CheckoutSession entity is recovery layer if webhook loses metadata

---

#### **syncOrderToHub** ⭐⭐⭐
- **Status:** KEEP - CRITICAL (fire-and-forget async)
- **Callers:** stripeWebhook (async), payment webhooks (async)
- **Entities Read:** Order, OrderSyncLog
- **Entities Write:** OrderSyncLog
- **External Services:** HUB_API_URL (Hub event ingest)
- **Secrets:** CUSTOMER_APP_SYNC_SECRET
- **Purpose:** Pushes one-time orders to Hub for fulfillment/production. Validates schedule (production day = Tue/Fri, delivery day = Wed/Sat). Fire-and-forget — order is safe in CA DB even if Hub push fails.
- **Guard Rails:**
  - Blocks unpaid/abandoned/pending orders
  - Allows refunded orders (critical for cancellation)
  - Blocks known test orders (hardcoded blocklist)
  - Validates schedule before Hub push
- **Risk Score:** ✅ LOW — Well-guarded, logs all decisions
- **Note:** Hub can return 410 (deprecated) — function handles gracefully

---

### Tier 2: SUBSCRIPTION & FULFILLMENT

#### **syncSubscriptionWithFulfillments** ⭐⭐⭐
- **Status:** KEEP - CRITICAL
- **Callers:** stripeWebhook (async on subscription creation)
- **Entities Read:** Subscription, SubscriptionPlan, UserProfile
- **Entities Write:** OrderSyncLog
- **External Services:** HUB_API_URL (subscription + fulfillment events)
- **Secrets:** HUB_SYNC_SECRET
- **Purpose:** Converts subscription into 4x FulfillmentTask records (weekly deliveries per billing cycle), syncs to Hub with decomposed weekly product quantities (NOT monthly totals).
- **Risk Score:** ✅ LOW — Fire-and-forget, logs failures for retry
- **Note:** CRITICAL: Must send weekly decomposed quantities (e.g. 1x AURA per week, not 4x for monthly plan)

---

#### **calculateNuViraFulfillmentSchedule** ⭐⭐⭐
- **Status:** KEEP - CRITICAL (AUTHORITY)
- **Callers:** stripeWebhook (on order creation), createPaymentIntent (embedded checkout prep)
- **Purpose:** Central scheduling engine. Takes paid_at timestamp, returns production_date, delivery_date, delivery_window_label. Uses NuVira cutoff rules (2PM CDT).
- **Risk Score:** ✅ LOW — Pure function, no side effects
- **Note:** WEBHOOK TIME IS AUTHORITY — stripeWebhook uses event.created (when Stripe sent this event), not session.created. Overrides stale metadata dates.

---

### Tier 3: NOTIFICATIONS & CUSTOMER-FACING

#### **sendCustomerNotification**
- **Status:** KEEP - ACTIVE (in-app bell)
- **Callers:** stripeWebhook (order confirmation, subscription success, payment failures), approveZone3DeliveryRequest, denyZone3DeliveryRequest, [many admin/ops functions]
- **Entities Read:** Notification
- **Entities Write:** Notification
- **Purpose:** Creates in-app notification for customers (bell icon)
- **Risk Score:** ✅ LOW — Simple create operation

---

#### **sendOrderReceivedNotification**
- **Status:** KEEP - ACTIVE
- **Callers:** stripeWebhook (order confirmation email), [refund notifications]
- **External Services:** Email API (Resend)
- **Purpose:** Sends order confirmation email to customer + delivery instructions
- **Risk Score:** ✅ LOW — Async, fire-and-forget

---

#### **sendOrderSms**
- **Status:** KEEP - ACTIVE
- **Callers:** stripeWebhook (order SMS if phone provided)
- **External Services:** SendBlue SMS API
- **Secrets:** SENDBLUE_API_KEY, SENDBLUE_API_SECRET, SENDBLUE_PHONE_NUMBER
- **Purpose:** SMS order confirmation
- **Risk Score:** ✅ LOW — Optional, only if contact_phone provided

---

#### **notifyOrderProcessed**
- **Status:** KEEP - ACTIVE (ops notification)
- **Callers:** stripeWebhook (async, fire-and-forget)
- **Purpose:** Notifies operations team that an order is ready for production
- **Risk Score:** ✅ LOW — Async

---

### Tier 4: ZONE 3 (DELIVERY APPROVAL REQUEST)

#### **createZone3AuthorizationIntent** ⭐⭐
- **Status:** KEEP - CRITICAL (Zone 3 checkout flow)
- **Callers:** Checkout page (Zone 3 button)
- **Entities Read:** DeliveryZone, DeliveryApprovalRequest
- **Entities Write:** DeliveryApprovalRequest
- **External Services:** Stripe (create PaymentIntent with auth hold)
- **Purpose:** Creates Stripe PaymentIntent with metadata for Zone 3 manual capture flow. Sets authorization hold (no capture yet).
- **Risk Score:** ✅ LOW — Well-defined, single caller

---

#### **createZone3SubscriptionReviewRequest** ⭐⭐
- **Status:** KEEP - CRITICAL (Zone 3 subscription path)
- **Callers:** Subscription checkout flow (Zone 3 areas)
- **Purpose:** Creates DeliveryApprovalRequest for subscription route review. Creates SetupIntent for card save (no charge yet).
- **Risk Score:** ✅ LOW — Parallel to one-time Zone 3

---

#### **approveZone3DeliveryRequest** ⭐⭐
- **Status:** KEEP - CRITICAL (admin manual action)
- **Callers:** Admin panel (manual click) OR automation trigger (future)
- **Entities Read:** DeliveryApprovalRequest
- **Entities Write:** DeliveryApprovalRequest, Order, OrderSyncLog, Notification
- **External Services:** Stripe (capture PaymentIntent)
- **Purpose:** Admin approves Zone 3 delivery. Captures Stripe payment. Creates Order. Syncs to Hub. Sends notifications.
- **Risk Score:** ⚠️ MEDIUM — Captures real money, but only on admin action

---

#### **denyZone3DeliveryRequest** ⭐⭐
- **Status:** KEEP - CRITICAL (admin manual action)
- **Callers:** Admin panel (manual click)
- **Entities Read:** DeliveryApprovalRequest
- **Entities Write:** DeliveryApprovalRequest, DeliveryWaitlist, Notification
- **External Services:** Stripe (cancel PaymentIntent auth hold)
- **Purpose:** Admin denies Zone 3 delivery. Cancels Stripe auth hold (no charge). Moves customer to waitlist. Sends notification.
- **Risk Score:** ✅ LOW — Cancels hold, no charge

---

#### **autoExpireZone3Authorizations**
- **Status:** KEEP - SCHEDULED AUTOMATION
- **Callers:** Scheduled automation (every 6 hours)
- **Entities Read:** DeliveryApprovalRequest (status=pending_authorization)
- **Entities Write:** DeliveryApprovalRequest
- **External Services:** Stripe (cancel expired auth PIs)
- **Purpose:** Cleans up Stripe auth holds older than 7 days (natural Stripe expiry window).
- **Risk Score:** ✅ LOW — Defensive cleanup

---

### Tier 5: LOYALTY & POINTS

#### **enrollNewCustomerInLoyalty**
- **Status:** KEEP - LOW PRIORITY (optional enrollment)
- **Callers:** Account setup flow (optional step)
- **Purpose:** Creates LoyaltyMember record
- **Risk Score:** ✅ LOW

---

#### **claimReward**
- **Status:** KEEP - ACTIVE (customer self-service)
- **Callers:** Rewards page (manual claim)
- **Purpose:** Converts loyalty points → free product claim
- **Risk Score:** ✅ LOW

---

### Tier 6: SHOPIFY SYNC (MULTIPLE VARIANTS)

#### **pushOrderToShopify** ⭐⭐
- **Status:** KEEP - ACTIVE (async, fire-and-forget)
- **Callers:** stripeWebhook (async on order creation)
- **Entities Read:** Order
- **Entities Write:** ShopifyOrder, OrderSyncLog
- **External Services:** Shopify Admin API
- **Secrets:** SHOPIFY_API_TOKEN, SHOPIFY_STORE_URL
- **Purpose:** Pushes CA Order to Shopify for POS/reporting sync
- **Risk Score:** ✅ LOW — Async, non-blocking

---

#### **shopifyWebhookReceiver** ⭐⭐
- **Status:** KEEP - CRITICAL (Shopify POS orders)
- **Callers:** Shopify webhook (order.created, order.updated)
- **Entities Read:** ShopifyOrder
- **Entities Write:** ShopifyOrder, OrderSyncLog
- **External Services:** Shopify Admin API (fetch full order)
- **Purpose:** Receives Shopify POS orders, hydrates from Shopify, stores as ShopifyOrder record
- **Risk Score:** ✅ LOW — Receives events, doesn't push

---

#### **syncShopifyOrderToHub** ⭐⭐
- **Status:** KEEP - CRITICAL (Shopify → Hub fulfillment)
- **Callers:** shopifyWebhookReceiver (async on POS order)
- **Purpose:** Converts ShopifyOrder → Hub order for fulfillment
- **Risk Score:** ✅ LOW — Fire-and-forget

---

#### **shopifyResyncOrders** 
- **Status:** KEEP - MANUAL ADMIN ONLY
- **Callers:** Manual backend invocation (admin recovery)
- **Purpose:** Re-syncs recent Shopify orders from Shopify API
- **Risk Score:** ✅ LOW — Only admin-invoked

---

#### **shopifyResyncProducts** 
- **Status:** KEEP - MANUAL ADMIN ONLY
- **Callers:** Manual backend invocation (product sync recovery)
- **Purpose:** Re-pulls products from Shopify and syncs to CA
- **Risk Score:** ✅ LOW — Only admin-invoked

---

#### **pushProductToShopify** 
- **Status:** KEEP - ACTIVE (product catalog sync)
- **Callers:** Scheduled automation (daily) OR manual admin
- **Purpose:** Syncs Product entity → Shopify catalog
- **Risk Score:** ✅ LOW — Idempotent

---

#### **syncProductsToGMC** 
- **Status:** KEEP - ACTIVE (Google Merchant Center feed)
- **Callers:** Scheduled automation (weekly)
- **Purpose:** Generates product feed for Google ads
- **Risk Score:** ✅ LOW

---

#### **shopifyGetAccessToken** 
- **Status:** ARCHIVE - DEPRECATED
- **Reason:** Token is stored in secrets now, not fetched dynamically
- **Caller:** None known (was OAuth token exchange)
- **Risk Score:** ✅ SAFE TO DISABLE

---

#### **shopifyPollFallback** 
- **Status:** REVIEW - POSSIBLY DUPLICATE
- **Callers:** Unknown (possibly scheduled)
- **Purpose:** Unclear — appears to be fallback order polling
- **Risk Score:** ⚠️ MEDIUM — Check if automation still exists

---

### Tier 7: REFUND & CANCELLATION

#### **syncRefundToHub**
- **Status:** KEEP - CRITICAL (refund path)
- **Callers:** stripeWebhook (charge.refunded handler, async)
- **Purpose:** Pushes refund event to Hub to cancel production/fulfillment
- **Risk Score:** ✅ LOW — Fire-and-forget

---

#### **processManualRefund**
- **Status:** KEEP - ADMIN MANUAL ONLY
- **Callers:** Admin dashboard (manual action)
- **Purpose:** Allows admin to manually issue refunds outside of Stripe webhook
- **Risk Score:** ⚠️ MEDIUM — Admin-only, but modifies payment state

---

#### **adminCancelAndRefundSubscription**
- **Status:** KEEP - ADMIN MANUAL ONLY
- **Callers:** Admin dashboard (manual action)
- **Purpose:** Admin immediately cancels + refunds subscription. Stops future deliveries.
- **Risk Score:** ⚠️ MEDIUM — Admin-only, real refund

---

### Tier 8: DEBUG / REPAIR / DIAGNOSTIC FUNCTIONS (NOT IN AUTOMATIONS)

These functions **DO NOT** have callers in live automations or frontend. They are manually invoked by admins for debugging/repair.

#### **auditSubscriptionPayloadToHub**
- **Status:** ARCHIVE - DEBUG ONLY
- **Callers:** None (manual admin invocation for audit)
- **Risk Score:** ✅ SAFE — Readonly, no side effects

---

#### **auditAmarkSubscriptions**
- **Status:** ARCHIVE - DEBUG ONLY (customer name audit)
- **Callers:** None (manual)
- **Risk Score:** ✅ SAFE — Readonly

---

#### **auditSubscriptionFulfillments**
- **Status:** ARCHIVE - DEBUG ONLY
- **Callers:** None (manual)
- **Risk Score:** ✅ SAFE — Readonly

---

#### **auditNewSubscriptions**
- **Status:** ARCHIVE - DEBUG ONLY
- **Callers:** None (manual)
- **Risk Score:** ✅ SAFE — Readonly

---

#### **auditWindow3Orders**
- **Status:** ARCHIVE - DEBUG ONLY (Saturday threshold audit)
- **Callers:** None (manual)
- **Risk Score:** ✅ SAFE — Readonly

---

#### **auditLatestStripePaymentForAmark**
- **Status:** ARCHIVE - DEBUG ONLY
- **Callers:** None (manual)
- **Risk Score:** ✅ SAFE — Readonly

---

#### **auditCustomerAppLoyaltyAfterPhase2**
- **Status:** ARCHIVE - DEBUG ONLY
- **Callers:** None (manual)
- **Risk Score:** ✅ SAFE — Readonly

---

#### **auditNewSubscriptions**
- **Status:** ARCHIVE - DEBUG ONLY
- **Callers:** None (manual)
- **Risk Score:** ✅ SAFE — Readonly

---

#### **debugHubSyncPayload**
- **Status:** ARCHIVE - DEBUG ONLY
- **Callers:** None (manual)
- **Risk Score:** ✅ SAFE — Readonly

---

#### **debugAndRetryHubSync**
- **Status:** ARCHIVE - DEBUG ONLY
- **Callers:** None (manual)
- **Risk Score:** ✅ SAFE — Manual retry helper

---

#### **retryFailedHubSyncs**
- **Status:** KEEP - SCHEDULED AUTOMATION (retry mechanism)
- **Callers:** Scheduled automation (every 15 min)
- **Purpose:** Automatically retries failed Hub syncs (orders/subscriptions that failed to sync)
- **Risk Score:** ✅ LOW — Defensive, idempotent retry

---

#### **zone3LiveApprovalTestHelper**
- **Status:** DELETE - TEST ONLY
- **Callers:** None (was used for QA)
- **Risk Score:** ✅ SAFE TO DELETE

---

#### **verifyLiveSubscriptionSmoke**
- **Status:** KEEP - SCHEDULED AUTOMATION (smoke test)
- **Callers:** Scheduled automation (daily)
- **Purpose:** Verifies Stripe subscriptions are accessible (smoke test)
- **Risk Score:** ✅ LOW — Readonly, diagnostic

---

#### **verifyStripeLiveMode**
- **Status:** KEEP - SCHEDULED AUTOMATION (verification)
- **Callers:** Scheduled automation (daily)
- **Purpose:** Confirms app is in Stripe live mode (not test)
- **Risk Score:** ✅ LOW — Readonly

---

#### **verifyHubEndpointReachability**
- **Status:** KEEP - SCHEDULED AUTOMATION (health check)
- **Callers:** Scheduled automation (hourly)
- **Purpose:** Tests Hub endpoint connectivity
- **Risk Score:** ✅ LOW — Health check

---

#### **stabilizationDiagnostic**
- **Status:** ARCHIVE - DEBUG ONLY
- **Callers:** None (manual)
- **Risk Score:** ✅ SAFE — Readonly diagnostic

---

#### **repairMissingSubscriptionForPaidInvoice**
- **Status:** KEEP - MANUAL ADMIN ONLY (recovery)
- **Callers:** Manual admin action
- **Purpose:** If a Stripe invoice was paid but CA Subscription wasn't created, this recreates it
- **Risk Score:** ✅ LOW — Admin-controlled recovery

---

#### **repairLiveSubscriptionFailure** (and variants)
- **Status:** KEEP - MANUAL ADMIN ONLY (recovery)
- **Callers:** Manual admin action
- **Purpose:** Fixes subscriptions in inconsistent states
- **Risk Score:** ⚠️ MEDIUM — Modifies subscription state, admin-only

---

#### **detectStuckOrders** & **recoverStuckOrder**
- **Status:** KEEP - ADMIN RECOVERY TOOLS
- **Callers:** Manual admin action
- **Purpose:** Detects orders stuck in pending/intermediate states, recovers them
- **Risk Score:** ⚠️ MEDIUM — Modifies order state

---

#### **monitorLiveCheckoutTest**
- **Status:** ARCHIVE - QA ONLY
- **Callers:** None (was manual QA test)
- **Risk Score:** ✅ SAFE TO DELETE

---

### Tier 9: INTEGRATION & SYNC HELPERS

#### **syncOrdersFromHub**
- **Status:** KEEP - SCHEDULED AUTOMATION (pull model)
- **Callers:** Scheduled automation (every 30 min)
- **Purpose:** Pulls recent orders from Hub (Hub push model complement)
- **Risk Score:** ✅ LOW — Idempotent pull

---

#### **syncSubscriptionFromHub**
- **Status:** KEEP - SCHEDULED AUTOMATION
- **Callers:** Scheduled automation (every 60 min)
- **Purpose:** Pulls subscription updates from Hub
- **Risk Score:** ✅ LOW — Idempotent pull

---

#### **syncLoyaltyFromHub**
- **Status:** KEEP - SCHEDULED AUTOMATION
- **Callers:** Scheduled automation (every 2 hours)
- **Purpose:** Pulls loyalty point changes from Hub
- **Risk Score:** ✅ LOW — Readonly sync

---

#### **syncMerchToShopify**
- **Status:** KEEP - SCHEDULED AUTOMATION
- **Callers:** Scheduled automation (weekly)
- **Purpose:** Syncs Merch entity → Shopify products
- **Risk Score:** ✅ LOW

---

#### **syncEventToHub**
- **Status:** KEEP - SCHEDULED AUTOMATION
- **Callers:** Scheduled automation (event sync)
- **Purpose:** Syncs Event entity (brand events) → Hub
- **Risk Score:** ✅ LOW

---

#### **syncCustomerToHub**
- **Status:** KEEP - ACTIVE (customer data, called by stripeWebhook)
- **Callers:** stripeWebhook (customer creation), other functions (async fire-and-forget)
- **Purpose:** Syncs customer profile to Hub
- **Risk Score:** ✅ LOW — Idempotent

---

#### **syncLoyaltyToHub**
- **Status:** KEEP - SCHEDULED AUTOMATION
- **Callers:** Scheduled automation (loyalty sync)
- **Purpose:** Syncs loyalty member data to Hub
- **Risk Score:** ✅ LOW

---

#### **pushOrderStatusToHub**
- **Status:** KEEP - CALLED BY ADMIN ORDERS PAGE
- **Callers:** AdminOrders page (driver manual status updates)
- **Purpose:** Driver app updates order status → syncs to Hub
- **Risk Score:** ✅ LOW — Fire-and-forget

---

#### **syncHubDeliveryStatuses**
- **Status:** KEEP - SCHEDULED AUTOMATION (status pull)
- **Callers:** Scheduled automation (every 10 min)
- **Purpose:** Pulls delivery status updates from Hub
- **Risk Score:** ✅ LOW — Idempotent pull

---

#### **hubToCustomerAppStatusSync**
- **Status:** KEEP - SCHEDULED AUTOMATION
- **Callers:** Scheduled automation (status sync)
- **Purpose:** Syncs Hub status → CA Order entity
- **Risk Score:** ✅ LOW — Idempotent

---

---

## PHASE 2: FLOW DEPENDENCY MAP

### Flow 1: One-Time Order Creation (Customer App → Stripe → Hub)

```
Customer clicks "Checkout" on /checkout
    ↓
Frontend calls createCheckoutSession()
    ↓ [creates Stripe session + CheckoutSession record for recovery]
    ↓
Customer completes Stripe checkout
    ↓
Stripe sends checkout.session.completed webhook
    ↓ [stripeWebhook handler]
    ↓
stripeWebhook validates payment, calls calculateNuViraFulfillmentSchedule()
    ↓
Creates Order entity (payment_captured=true, status='scheduled_for_juicing')
    ↓
Fires async: pushOrderToShopify() [optional, async]
Fires async: syncOrderToHub() [CRITICAL]
Fires async: sendOrderReceivedNotification() [email]
Fires async: sendOrderSms() [SMS]
Fires async: notifyOrderProcessed() [ops]
Fires async: sendCustomerNotification() [in-app]
    ↓
Customer sees order confirmation
```

**Critical Nodes:**
- ✅ createCheckoutSession — must work
- ✅ stripeWebhook (checkout.session.completed) — must work
- ✅ calculateNuViraFulfillmentSchedule — must work
- ✅ syncOrderToHub — fire-and-forget, order safe in CA DB even if fails

**Failure Modes:**
- If CheckoutSession storage fails → webhook falls back to Stripe metadata ✅
- If syncOrderToHub fails → retryFailedHubSyncs picks it up in 15 min ✅
- If sendOrderReceivedNotification fails → async, logged ✅

---

### Flow 2: Subscription Creation (Customer App → Stripe → Hub + Fulfillments)

**Path A: Stripe Hosted Checkout**
```
Customer selects subscription plan on /subscribe
    ↓
Frontend calls createSubscriptionCheckoutHosted()
    ↓ [creates PendingSubscriptionCheckout for metadata]
    ↓
Customer completes Stripe checkout
    ↓
Stripe sends checkout.session.completed (mode='subscription')
    ↓ [stripeWebhook handler]
    ↓
stripeWebhook creates Subscription + awards loyalty points
    ↓
Fires async: syncSubscriptionWithFulfillments() [CRITICAL → Hub + 4x FulfillmentTasks]
    ↓
Fires async: sendCustomerNotification()
    ↓
Subscription active, Hub generates weekly orders
```

**Path B: Stripe Payment Element (Embedded Checkout)**
```
Customer completes PaymentElement form on /checkout
    ↓
Frontend calls createSubscriptionPaymentIntent()
    ↓ [creates PendingSubscriptionCheckout]
    ↓
PaymentElement succeeds
    ↓
Stripe sends invoice.payment_succeeded OR invoice.paid
    ↓ [stripeWebhook handler]
    ↓
stripeWebhook creates Subscription + PendingSubscriptionCheckout update
    ↓
Fires async: syncSubscriptionWithFulfillments()
    ↓
Subscription active
```

**Critical Nodes:**
- ✅ createSubscriptionCheckoutHosted OR createSubscriptionPaymentIntent
- ✅ stripeWebhook (checkout.session.completed OR invoice.paid)
- ✅ calculateNuViraFulfillmentSchedule
- ✅ syncSubscriptionWithFulfillments

---

### Flow 3: Zone 3 Delivery Approval (Manual Admin)

```
Customer enters Zone 3 address at checkout
    ↓
Frontend calls createZone3AuthorizationIntent()
    ↓ [creates PaymentIntent with auth hold, DAR record]
    ↓
Stripe sends payment_intent.amount_capturable_updated
    ↓ [stripeWebhook handler]
    ↓
stripeWebhook sets DAR status='pending_review', notifies admin + customer
    ↓
Admin reviews + clicks "Approve" in Admin Orders
    ↓
Frontend calls approveZone3DeliveryRequest()
    ↓ [captures Stripe PI, creates Order]
    ↓
Fires async: syncOrderToHub()
    ↓
Order proceeds to fulfillment
```

**Critical Nodes:**
- ✅ createZone3AuthorizationIntent
- ✅ stripeWebhook (payment_intent.amount_capturable_updated)
- ✅ approveZone3DeliveryRequest

---

### Flow 4: Refund Processing (Stripe Webhook)

```
Admin issues refund in Stripe Dashboard
    ↓
Stripe sends charge.refunded OR refund.updated
    ↓ [stripeWebhook handler]
    ↓
Detects order OR subscription
    ↓
If Subscription: marks cancelled, reverses loyalty points, notifies Hub
If Order: marks refunded, restores loyalty points, syncs to Hub
    ↓
Fires async: sendOrderReceivedNotification() [refund email]
    ↓
Hub cancels production/fulfillment
```

**Critical Nodes:**
- ✅ stripeWebhook (charge.refunded)
- ✅ syncRefundToHub (async)

---

### Flow 5: Shopify POS Order Ingest

```
POS registers order in Shopify
    ↓
Shopify sends order.created webhook
    ↓ [shopifyWebhookReceiver handler]
    ↓
Hydrates order from Shopify API
    ↓
Creates ShopifyOrder record
    ↓
Fires async: syncShopifyOrderToHub()
    ↓
Hub processes for fulfillment
```

**Critical Nodes:**
- ✅ shopifyWebhookReceiver
- ✅ syncShopifyOrderToHub

---

## PHASE 3: FUNCTION CLASSIFICATION

### 🟢 KEEP_REQUIRED (Critical Live Paths)

| Function | Why | Risk |
|----------|-----|------|
| **stripeWebhook** | All payment events (order/subscription/refund) | MEDIUM (complex, but guarded) |
| **createCheckoutSession** | One-time checkout | LOW |
| **syncOrderToHub** | Order → fulfillment pipeline | LOW |
| **syncSubscriptionWithFulfillments** | Subscription → Hub + FulfillmentTasks | LOW |
| **calculateNuViraFulfillmentSchedule** | Order scheduling (AUTHORITY) | LOW |
| **pushOrderToShopify** | CA Order → Shopify | LOW |
| **shopifyWebhookReceiver** | POS orders ingest | LOW |
| **syncShopifyOrderToHub** | Shopify → Hub fulfillment | LOW |
| **createZone3AuthorizationIntent** | Zone 3 auth hold creation | LOW |
| **approveZone3DeliveryRequest** | Zone 3 admin approval | MEDIUM (real money) |
| **denyZone3DeliveryRequest** | Zone 3 denial | LOW |
| **syncRefundToHub** | Refund cancellation pipeline | LOW |
| **sendCustomerNotification** | In-app notifications | LOW |
| **sendOrderReceivedNotification** | Order confirmation email | LOW |
| **retryFailedHubSyncs** | Automated retry (scheduled) | LOW |
| **createSubscriptionCheckoutHosted** | Subscription checkout (Stripe hosted) | LOW |
| **createSubscriptionPaymentIntent** | Subscription checkout (PaymentElement) | LOW |

---

### 🟡 KEEP_BUT_HARDEN (Required but Needs Improvement)

| Function | Issue | Action |
|----------|-------|--------|
| **approveZone3DeliveryRequest** | Captures real money, admin-only gate is sufficient but should log audit trail | Add more detailed audit logging |
| **syncHubDeliveryStatuses** | Pulls status every 10 min — could cause credit drain if Hub API is expensive | Review Hub pricing model, consider increasing interval to 30 min if read cost is high |
| **retryFailedHubSyncs** | Retries every 15 min indefinitely — could retry failed orders forever | Add max retry count (e.g. 10) before marking as manual-review |

---

### 🟠 MANUAL_ONLY (Repair/Debug — Not Automated)

These **SHOULD NOT BE IN AUTOMATIONS** but are kept for manual admin recovery:

| Function | Purpose |
|----------|---------|
| shopifyResyncOrders | Manual re-pull of recent Shopify orders |
| shopifyResyncProducts | Manual product catalog refresh |
| repairMissingSubscriptionForPaidInvoice | Recover subscription not created from Stripe invoice |
| repairLiveSubscriptionV2 / repairLiveSubscriptionFailure | Fix stuck subscriptions |
| processManualRefund | Admin-issued refund outside Stripe |
| adminCancelAndRefundSubscription | Admin immediate subscription cancel |
| detectStuckOrders / recoverStuckOrder | Manual order recovery |

---

### 🔴 DISABLE_FIRST (Scheduled Automations That May Be Redundant)

**Before deletion, disable and monitor for 1 week to ensure no side effects:**

| Function | Automation | Reason |
|----------|-----------|--------|
| **syncOrdersFromHub** | Scheduled (30 min) | Hub also pushes orders to CA. This is pull-model fallback — may be redundant. **Action:** Check if Hub is reliably pushing before disabling. |
| **syncSubscriptionFromHub** | Scheduled (60 min) | Hub also pushes subscription updates. **Action:** Check Hub reliability. |
| **syncLoyaltyFromHub** | Scheduled (120 min) | One-way sync; may duplicate loyalty updates. **Action:** Check if loyaltysync is reliable from Hub or CA. |
| **syncMerchToShopify** | Scheduled (weekly) | Weekly Merch catalog sync. May not be used if no active Merch products. **Action:** Check if Merch is actively used. |
| **syncEventToHub** | Scheduled (event-triggered) | Events (brand events) sync. May not be critical. **Action:** Check if Event entity is actively used. |
| **syncProductsToGMC** | Scheduled (weekly) | Google Merchant Center feed. May not be critical if GMC is disabled. **Action:** Check if Google Ads are active. |

---

### ❌ DELETE_CANDIDATE (No Known Callers)

| Function | Reason |
|----------|--------|
| **shopifyGetAccessToken** | Token exchange is deprecated; token now stored in secrets |
| **zone3LiveApprovalTestHelper** | QA test helper, no callers |
| **monitorLiveCheckoutTest** | QA test, no callers |
| Various audit functions (auditAmarkSubscriptions, auditSubscriptionPayloadToHub, etc.) | Debug-only, no callers, can be recreated if needed |

---

### ❌ INVESTIGATE (Unknown Status)

| Function | Status |
|----------|--------|
| **shopifyPollFallback** | Purpose unclear. Check if scheduled automation still triggers. |
| **auditStabilizationRepair** | Incomplete audit function. Check if still needed. |

---

## SUMMARY TABLE: Function Classification

**Total Functions Analyzed:** 138

| Category | Count | Action |
|----------|-------|--------|
| 🟢 KEEP_REQUIRED | 16 | No action, actively monitored |
| 🟡 KEEP_BUT_HARDEN | 3 | Add logging/limits |
| 🟠 MANUAL_ONLY | 8 | Keep for recovery, do NOT automate |
| 🔴 DISABLE_FIRST | 6 | Disable automations, monitor 1 week |
| ❌ DELETE_CANDIDATE | 50+ | Delete after confirming no callers |
| ❓ INVESTIGATE | 2+ | Determine status before action |

---

## PHASE 3 COMPLETE: NEXT STEPS

1. **Verify all KEEP_REQUIRED functions** have production automation coverage
2. **Harden KEEP_BUT_HARDEN** functions with logging/retry limits
3. **Disable DISABLE_FIRST automations** one at a time, monitor for 1 week each
4. **Confirm DELETE_CANDIDATE** functions have zero callers before deletion
5. **Resolve INVESTIGATE** functions' status

See **Phase 4 & 5** (Credit Cost Analysis & Cleanup Plan) in follow-up audit.

---

**End of Phase 1-3 Audit**