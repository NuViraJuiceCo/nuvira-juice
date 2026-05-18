# Stripe Metadata for Customer App Profile & Order Recovery

**Date**: May 1, 2026  
**Purpose**: Enable Hub order rebuilds to recover customer_name, address, and delivery details from Stripe when Customer App or Hub records are incomplete.

---

## Overview

When the Customer App creates Stripe Checkout Sessions (one-time or subscription), it now embeds comprehensive customer profile and delivery metadata. This metadata serves as a **fallback recovery layer** for Hub rebuilds.

**Recovery Priority**:
1. Hub verified operational data (primary)
2. Customer App profile/order intent (secondary)
3. Stripe metadata (tertiary/recovery)
4. Shopify (if available)
5. OrderReviewQueue (if still incomplete)

---

## Metadata Structure

### Checkout Session Metadata (One-Time Orders)

**Applies to**: `stripe.checkout.sessions.create()` metadata + `payment_intent_data.metadata`

```json
{
  "base44_app_id": "app-id-from-env",
  "order_number": "NV-1ABCD1234",
  "is_preorder": "true" or "false",
  "customer_email": "customer@example.com",
  "customer_name": "John Doe",
  "customer_phone": "+1-555-1234",
  "delivery_method": "delivery" or "pickup",
  "delivery_address_line1": "123 Main St",
  "delivery_address_line2": "Apt 5",
  "delivery_city": "O'Fallon",
  "delivery_state": "MO",
  "delivery_postal_code": "63366",
  "requested_delivery_date": "2026-05-02",
  "production_date": "2026-05-01",
  "source_app": "customer_app",
  "checkout_version": "1.0"
}
```

**Key Fields for Recovery**:
- `customer_name` — Used if Customer App profile is missing name
- `customer_phone` — Used if Customer App profile is missing phone
- `delivery_address_*` — Used if order has no address (recovery address)
- `requested_delivery_date` — Validates delivery date calculation
- `client_reference_id` — Set to `order_number` for reconciliation

---

### Subscription Metadata

**Applies to**: `stripe.checkout.sessions.create()` metadata + `subscription_data.metadata`

```json
{
  "customer_email": "customer@example.com",
  "customer_name": "Sukhwant Kahlon",
  "customer_phone": "+1-314-288-9258",
  "subscription_plan": "monthly_ritual" or "vip_wellness",
  "order_type": "subscription",
  "fulfillment_mode": "multi_delivery",
  "frequency": "weekly" or "monthly",
  "weekly_delivery_count": "4",
  "items_summary": "Monthly Ritual: 1 Oasis, 1 Aura, 1 Re-Nu",
  "default_delivery_address_line1": "6930 Brassel Dr",
  "default_delivery_address_line2": "",
  "default_delivery_city": "O'Fallon",
  "default_delivery_state": "MO",
  "default_delivery_postal_code": "63368",
  "source_app": "customer_app"
}
```

**Key Fields for Recovery**:
- `customer_name` — Used if Subscription profile is missing name
- `subscription_plan` — Used to validate plan_id or rebuild subscription
- `weekly_delivery_count` — Validates number of fulfillments per cycle
- `items_summary` — Quick reference for expected items
- `default_delivery_address_*` — Default address for future fulfillments

---

### Stripe Customer Metadata

**Applies to**: `stripe.customers.create()` or `stripe.customers.update()` metadata

```json
{
  "customer_name": "Sukhwant Kahlon",
  "default_delivery_city": "O'Fallon",
  "default_delivery_state": "MO",
  "default_delivery_postal_code": "63368",
  "source_app": "customer_app"
}
```

**Used by**: Future subscriptions linked to this customer (for default address)

---

## Implementation Details

### One-Time Order Checkout Flow

**Function**: `createCheckoutSession`

```typescript
// Before Stripe session creation, gather customer/delivery data
const sessionMetadata = {
  customer_email,
  customer_name,      // From Customer App profile
  customer_phone,     // From Customer App profile
  delivery_address_line1,   // Selected at checkout (or profile default)
  delivery_address_line2,
  delivery_city,
  delivery_state,
  delivery_postal_code,
  requested_delivery_date,  // Calculated via backend rules
  source_app: "customer_app"
};

// Create Stripe Checkout Session
const session = await stripe.checkout.sessions.create({
  client_reference_id: orderNumber,  // For reconciliation
  metadata: sessionMetadata,          // Session-level metadata
  payment_intent_data: {
    metadata: sessionMetadata,        // Payment-level metadata
    capture_method: 'manual'          // For pre-orders
  }
});
```

**Result**: Metadata attached to:
- Checkout Session → PaymentIntent → Charge

---

### Subscription Order Checkout Flow

**Function**: `createSubscriptionSession`

```typescript
// Determine delivery address: selected checkout or profile default
const deliveryAddressLine1 = address_line1 || profile_address_line1;
const deliveryCity = address_city || profile_address_city;
// ... etc

const subscriptionMetadata = {
  customer_name,
  subscription_plan: "monthly_ritual",
  weekly_delivery_count: "4",
  default_delivery_address_line1: deliveryAddressLine1,
  default_delivery_city: deliveryCity,
  // ...
};

// Get or create Stripe Customer with profile metadata
const stripeCustomer = await stripe.customers.create({
  email: customer_email,
  name: customer_name,
  metadata: {
    customer_name,
    default_delivery_city,
    default_delivery_state,
    default_delivery_postal_code,
    source_app: "customer_app"
  }
});

// Create subscription checkout session
const session = await stripe.checkout.sessions.create({
  client_reference_id: `sub_${Date.now()}`,
  customer: stripeCustomer.id,
  subscription_data: {
    metadata: subscriptionMetadata
  },
  metadata: subscriptionMetadata
});
```

**Result**: Metadata attached to:
- Checkout Session → Subscription → Invoices

---

## Webhook Recovery (Stripe → Hub)

### Checkout Session Completion Webhook

When `checkout.session.completed` fires:

```typescript
const session = await stripe.checkout.sessions.retrieve(sessionId);

// Extract metadata for recovery
const metadata = session.metadata;
const {
  order_number,
  customer_name,
  customer_email,
  customer_phone,
  delivery_address_line1,
  delivery_city,
  // ... etc
} = metadata;

// Create or update Order with metadata fallback
const orderData = {
  order_number,
  customer_name: customer_name || existingProfile?.name,
  customer_email,
  contact_phone: customer_phone || existingProfile?.phone,
  delivery_address: `${delivery_address_line1}, ${delivery_city}...`,
  address_line1: delivery_address_line1,
  address_city: delivery_city,
  // ...
  metadata_recovery_source: 'stripe_checkout'
};
```

---

## Hub Rebuild Recovery

### safeSyncOrderUpdate Recovery Chain

When Hub rebuilds orders and finds missing customer_name or address:

```typescript
async function safeSyncOrderUpdate(order) {
  // 1. Try Hub verified data (primary)
  if (!order.customer_name && hub.verified_customer_name) {
    order.customer_name = hub.verified_customer_name;
  }

  // 2. Try Customer App profile (secondary)
  if (!order.customer_name && customerAppProfile?.full_name) {
    order.customer_name = customerAppProfile.full_name;
    recovery_source = 'customer_app_profile';
  }

  // 3. Try Stripe metadata (tertiary recovery)
  if (!order.customer_name) {
    const stripeCheckout = await getStripeCheckoutSession(order.order_number);
    if (stripeCheckout?.metadata?.customer_name) {
      order.customer_name = stripeCheckout.metadata.customer_name;
      recovery_source = 'stripe_checkout_metadata';
    }
  }

  // 4. Try Stripe Subscription/Invoice metadata
  if (!order.customer_name && order.subscription_id) {
    const stripeSub = await getStripeSubscription(order.subscription_id);
    if (stripeSub?.metadata?.customer_name) {
      order.customer_name = stripeSub.metadata.customer_name;
      recovery_source = 'stripe_subscription_metadata';
    }
  }

  // 5. If still missing, quarantine to OrderReviewQueue
  if (!order.customer_name) {
    await quarantineToOrderReviewQueue(order, 'missing_customer_name', recovery_source);
    return;
  }

  // Same for address recovery
  if (!order.address_line1) {
    const recovered = await recoverAddressFromStripe(order);
    if (recovered) {
      order.address_line1 = recovered.line1;
      order.address_city = recovered.city;
      // ...
      recovery_source = 'stripe_metadata_address';
    }
  }

  // Log recovery source
  console.log(`Order ${order.order_number} recovered from ${recovery_source}`);
  
  // Update Hub order with recovered data
  await updateHubOrder(order);
}
```

---

## Data Validation

### Pre-Checkout Validation (Customer App)

Before creating Stripe Checkout Session, Customer App must validate:

```typescript
// Required before checkout
✅ customer_name (from profile or input)
✅ customer_email (authenticated or form input)
✅ delivery_address_line1 (from profile or selected at checkout)
✅ delivery_city, delivery_state, delivery_postal_code
✅ phone (optional but recommended)

// Calculated before checkout
✅ estimated_delivery_date (via backend rules)
✅ fulfillment_type (delivery or pickup)
```

If any required field is missing, **block checkout** and show clear error.

---

## Testing

### Test 1: One-Time Order with Profile Address

**Steps**:
1. Customer signs in (has complete profile)
2. Customer does NOT select different address at checkout
3. Create Stripe Checkout Session
4. Verify metadata contains profile address

**Expected**:
```json
{
  "customer_name": "John Doe",
  "delivery_address_line1": "123 Main St",
  "delivery_city": "O'Fallon",
  "delivery_state": "MO",
  "delivery_postal_code": "63366"
}
```

---

### Test 2: One-Time Order with Selected Address

**Steps**:
1. Customer signs in (has profile address: 123 Main St)
2. Customer selects DIFFERENT address at checkout (456 Oak Ave)
3. Create Stripe Checkout Session
4. Verify metadata contains selected address (456 Oak Ave), not profile (123 Main St)

**Expected**:
```json
{
  "customer_name": "John Doe",
  "delivery_address_line1": "456 Oak Ave",   // Selected, not profile
  "delivery_city": "Saint Charles",
  "delivery_state": "MO",
  "delivery_postal_code": "63301"
}
```

---

### Test 3: Subscription with Monthly Ritual

**Steps**:
1. Customer selects Monthly Ritual subscription
2. Create Stripe Checkout Session
3. Verify subscription metadata contains plan, delivery count, items summary

**Expected**:
```json
{
  "customer_name": "Sukhwant Kahlon",
  "subscription_plan": "monthly_ritual",
  "weekly_delivery_count": "4",
  "items_summary": "Monthly Ritual: 1 Oasis, 1 Aura, 1 Re-Nu",
  "default_delivery_address_line1": "6930 Brassel Dr",
  "default_delivery_city": "O'Fallon"
}
```

---

### Test 4: Hub Rebuild with Stripe Recovery

**Steps**:
1. Create order with Stripe metadata but missing customer_name in Hub
2. Run `rebuildAllSubscriptionOrders`
3. Verify `safeSyncOrderUpdate` recovers customer_name from Stripe metadata
4. Verify order does NOT enter OrderReviewQueue
5. Verify recovery_source logged as "stripe_checkout_metadata"

**Expected**:
- Order updated in Hub with recovered customer_name
- Order no longer in OrderReviewQueue (if that was the only issue)
- Logs show recovery from Stripe metadata

---

## Limitations & Caveats

**Stripe Metadata Limits**:
- Each metadata value max 500 characters
- Keep addresses concise (no full delivery_address, only line1/line2/city/state/zip)
- No nested JSON objects

**Recovery vs Primary Data**:
- Stripe metadata is tertiary recovery only
- Never overwrite better verified Hub data with older Stripe metadata
- Use recovery_source flag to track where data came from

**Metadata Retention**:
- Stripe retains metadata for Checkout Sessions for ~24 hours
- Stripe Subscriptions retain metadata indefinitely (good for future rebuilds)
- Always prefer Subscription metadata over Checkout Session metadata if both exist

---

## Files Updated

- `functions/createCheckoutSession` — Added customer/delivery metadata to checkout sessions
- `functions/createSubscriptionSession` — Added subscription metadata + Stripe Customer creation with profile metadata

---

## Next Steps

1. Deploy updated checkout functions
2. Test all 4 test scenarios above
3. Update Hub rebuild functions to read Stripe metadata as recovery layer
4. Monitor logs for recovery_source and OrderReviewQueue reduction
5. Confirm delivery addresses consistent across Customer App, Production, Fulfillment, Driver, and Order History