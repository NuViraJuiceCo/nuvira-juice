# Function Backup Archive
## Deleted/Archived Functions with Full Code for Rollback

**Archive Date:** 2026-05-15  
**Total Functions:** 3 (Batch 1 DELETE_NOW)  
**Storage Purpose:** Rollback if needed during monitoring windows  

---

## Batch 1: DELETE_NOW Functions

### 1. shopifyGetAccessToken

**Status:** Backup for rollback  
**Reason for Deletion:** OAuth token exchange deprecated; token now stored in SHOPIFY_API_TOKEN secret  
**Risk:** ZERO — No callers found  

```javascript
import Stripe from 'npm:stripe@14.21.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

/**
 * DEPRECATED: OAuth token exchange for Shopify
 * Token is now stored directly in SHOPIFY_API_TOKEN secret
 * This function is no longer called and can be safely deleted
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    
    const { code, state } = body;

    if (!code) {
      return Response.json({ error: 'Missing code' }, { status: 400 });
    }

    // OAuth flow (deprecated)
    const response = await fetch('https://your-shopify-store.myshopify.com/admin/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: Deno.env.get('SHOPIFY_CLIENT_ID'),
        client_secret: Deno.env.get('SHOPIFY_CLIENT_SECRET'),
        code: code,
      }),
    });

    const data = await response.json();
    return Response.json(data);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
```

---

### 2. zone3LiveApprovalTestHelper

**Status:** Backup for rollback  
**Reason for Deletion:** QA test helper with hardcoded test values, no production use  
**Risk:** ZERO — No callers found  

```javascript
/**
 * DEPRECATED: Zone 3 approval testing helper
 * Used only for QA of Zone 3 manual approval flow
 * Hardcoded test values for customer, address, amounts
 * Can be safely deleted after QA phase
 */

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  try {
    // Create test Zone 3 DAR
    const testDAR = await base44.asServiceRole.entities.DeliveryApprovalRequest.create({
      request_number: `DAR-TEST-${Date.now()}`,
      request_type: 'one_time_order',
      customer_name: 'Test Customer',
      customer_email: 'test@nuvirajuice.com',
      customer_phone: '555-0123',
      delivery_address: '123 Test St, Outside Zone, MO 12345',
      address_line1: '123 Test St',
      address_city: 'Outside Zone',
      address_state: 'MO',
      address_postal_code: '12345',
      address_country: 'US',
      zone_key: 'zone_3_route_review_25_30',
      zone_name: 'Zone 3: Route Review 25-30 miles',
      zone_type: 'route_review',
      status: 'draft',
      cart_items: [{ product_id: 'test-product', title: 'Test Juice', price: 15, quantity: 2 }],
      cart_subtotal: 30,
      estimated_delivery_fee: 25,
      estimated_total: 55,
      estimated_distance_miles: 28,
      requested_delivery_date: new Date().toISOString().split('T')[0],
    });

    return Response.json({ success: true, dar_id: testDAR.id, message: 'Test DAR created for QA approval flow' });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
```

---

### 3. monitorLiveCheckoutTest

**Status:** Backup for rollback  
**Reason for Deletion:** QA embedded checkout test function, hardcoded test values  
**Risk:** ZERO — No callers found  

```javascript
/**
 * DEPRECATED: Live embedded checkout test function
 * Used only for QA of PaymentElement flow
 * Creates test orders with hardcoded payment intent flow
 * Can be safely deleted after QA phase
 */

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  try {
    const Stripe = (await import('npm:stripe@14.21.0')).default;
    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

    // Create test PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: 5000, // $50.00
      currency: 'usd',
      metadata: {
        order_number: `NV-TEST-${Date.now()}`,
        customer_email: 'test@nuvirajuice.com',
        checkout_version: '3.0_embedded',
      },
    });

    // Create corresponding pending Order
    const order = await base44.asServiceRole.entities.Order.create({
      order_number: `NV-TEST-${Date.now()}`,
      customer_email: 'test@nuvirajuice.com',
      customer_name: 'Test Customer',
      items: [{ title: 'Test Juice', quantity: 1, price: 15 }],
      subtotal: 15,
      delivery_fee: 5,
      total: 20,
      fulfillment_type: 'delivery',
      delivery_address: '123 Test St, Wentzville, MO 63385',
      status: 'pending_payment',
      payment_status: 'pending',
      stripe_payment_intent_id: paymentIntent.id,
    });

    return Response.json({
      success: true,
      payment_intent_id: paymentIntent.id,
      order_id: order.id,
      message: 'Test PaymentIntent created for embedded checkout QA',
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
```

---

## Batch 2: DEBUG-ONLY Functions (Archive for Later Deletion)

### Audit Functions (No Callers, Safe to Delete After Batch 2 Monitoring)

These are readonly diagnostic functions. Safe to delete after confirming no automations call them.

#### auditAmarkSubscriptions
- **Purpose:** Customer name audit for Amark customer
- **Readonly:** YES
- **Callers:** None (manual admin only)
- **Code Status:** Backed up in git history
- **Action:** Delete after Batch 2

#### auditCustomerAppLoyaltyAfterPhase2
- **Purpose:** Phase 2 loyalty reconciliation audit
- **Readonly:** YES
- **Callers:** None
- **Code Status:** Backed up in git history
- **Action:** Delete after Batch 2

#### auditLatestStripePaymentForAmark
- **Purpose:** Stripe payment audit for specific customer
- **Readonly:** YES
- **Callers:** None
- **Code Status:** Backed up in git history
- **Action:** Delete after Batch 2

#### auditNewSubscriptions
- **Purpose:** Subscription creation audit
- **Readonly:** YES
- **Callers:** None
- **Code Status:** Backed up in git history
- **Action:** Delete after Batch 2

#### auditSubscriptionFulfillments
- **Purpose:** Fulfillment task audit
- **Readonly:** YES
- **Callers:** None
- **Code Status:** Backed up in git history
- **Action:** Delete after Batch 2

#### auditSubscriptionPayloadToHub
- **Purpose:** Hub sync payload audit
- **Readonly:** YES
- **Callers:** None
- **Code Status:** Backed up in git history
- **Action:** Delete after Batch 2

#### auditWindow3Orders
- **Purpose:** Saturday threshold audit
- **Readonly:** YES
- **Callers:** None
- **Code Status:** Backed up in git history
- **Action:** Delete after Batch 2

#### auditStripeAndIntegrationInventory
- **Purpose:** Stripe API inventory audit
- **Readonly:** YES
- **Callers:** None
- **Code Status:** Backed up in git history
- **Action:** Delete after Batch 2

#### stabilizationDiagnostic
- **Purpose:** General diagnostics tool
- **Readonly:** YES
- **Callers:** None
- **Code Status:** Backed up in git history
- **Action:** Delete after Batch 2

#### debugHubSyncPayload
- **Purpose:** Hub sync payload debugging
- **Readonly:** YES
- **Callers:** None
- **Code Status:** Backed up in git history
- **Action:** Delete after Batch 2

#### debugAndRetryHubSync
- **Purpose:** Manual Hub sync retry
- **Readonly:** NO (modifies OrderSyncLog)
- **Callers:** None (manual only)
- **Code Status:** Backed up in git history
- **Action:** Delete after Batch 2

---

## Rollback Instructions

### To Restore a Deleted Function:

1. **Get the backup code from this document**
2. **Create the function file in `/functions/{function_name}.js`**
3. **Deploy** (automatic via platform)
4. **Verify** the function is accessible via test invocation
5. **Re-enable any automations** that called it

### Example Rollback (shopifyGetAccessToken):

```bash
# 1. Create file functions/shopifyGetAccessToken.js
# 2. Paste backup code from FUNCTION_BACKUP_ARCHIVE.md section
# 3. Deploy
# 4. Test: curl -X POST https://app.base44.com/api/functions/shopifyGetAccessToken -d '{"code":"test"}'
# 5. Verify success response
```

---

## Archive Maintenance

**Last Updated:** 2026-05-15  
**Next Review:** After Batch 3 deletion (48h monitoring window complete)  
**Retention:** Keep indefinitely for rollback purposes