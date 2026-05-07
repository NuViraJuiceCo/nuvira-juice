# Subscription vs. One-Time Order Metadata Parity Table

| Category | Field | One-Time (createPaymentIntent) | Subscription (createSubscriptionPaymentIntentV2) | Status |
|----------|-------|--------------------------------|--------------------------------------------------|--------|
| **Base44 Config** | base44_app_id | ✅ YES | ✅ YES | ✅ PARITY |
| | source_app | ✅ YES | ✅ YES | ✅ PARITY |
| | checkout_version | ✅ YES (3.0_embedded) | ✅ YES (3.0_embedded) | ✅ PARITY |
| **Order Identity** | order_type | ✅ YES (one_time) | ✅ YES (subscription) | ✅ ADAPTED |
| | order_number | ✅ YES | ❌ NO (pending_subscription_checkout_id instead) | ✅ EQUIVALENT |
| | pending_subscription_checkout_id | ❌ NO | ✅ YES | ✅ SUBSCRIPTION-SPECIFIC |
| **Customer Identity** | customer_email | ✅ YES | ✅ YES | ✅ PARITY |
| | customer_name | ✅ YES | ✅ YES | ✅ PARITY |
| | customer_phone | ✅ YES | ✅ YES | ✅ PARITY |
| **Delivery Method** | delivery_method | ✅ YES (delivery/pickup) | ❌ NO (implicit delivery) | ✅ COMPATIBLE |
| **Address Fields** | delivery_address_line1 | ✅ YES | ✅ YES | ✅ PARITY |
| | delivery_address_line2 | ✅ YES | ✅ YES | ✅ PARITY |
| | delivery_city | ✅ YES | ✅ YES | ✅ PARITY |
| | delivery_state | ✅ YES | ✅ YES | ✅ PARITY |
| | delivery_postal_code | ✅ YES | ✅ YES | ✅ PARITY |
| | delivery_address (full) | ✅ YES | ✅ YES | ✅ PARITY |
| **Delivery Dates** | selected_delivery_date | ✅ YES (one-time date) | ❌ NO (first_delivery_date instead) | ✅ ADAPTED |
| | requested_delivery_date | ✅ YES | ❌ NO | ⚠️ SUBSCRIPTION: NOT APPLICABLE |
| | production_date | ✅ YES (fallback) | ✅ YES (calculated) | ✅ PARITY |
| | first_delivery_date | ❌ NO | ✅ YES (calculated) | ✅ SUBSCRIPTION-SPECIFIC |
| | next_delivery_date | ❌ NO | ✅ YES (for recurring) | ✅ SUBSCRIPTION-SPECIFIC |
| **Delivery Window** | delivery_window_label | ✅ YES | ✅ YES | ✅ PARITY |
| | delivery_window_start | ✅ YES | ✅ YES | ✅ PARITY |
| | delivery_window_end | ✅ YES | ✅ YES | ✅ PARITY |
| | delivery_schedule_source | ✅ YES | ❌ NO | ⚠️ SUBSCRIPTION: IMPLICIT (system_default) |
| **Plan/Product Info** | is_preorder | ✅ YES | ❌ NO | ⚠️ SUBSCRIPTION: NOT APPLICABLE |
| | fulfillment_mode | ✅ YES (single_delivery) | ❌ NO | ⚠️ SUBSCRIPTION: IMPLICIT (recurring) |
| | plan_id | ❌ NO | ✅ YES | ✅ SUBSCRIPTION-SPECIFIC |
| | plan_name | ❌ NO | ✅ YES | ✅ SUBSCRIPTION-SPECIFIC |
| | cadence | ❌ NO | ✅ YES (weekly/monthly) | ✅ SUBSCRIPTION-SPECIFIC |
| | bundle_id | ❌ NO | ✅ YES | ✅ SUBSCRIPTION-SPECIFIC |
| **Zone/Logistics** | delivery_zone_id | ❌ NO | ✅ YES | ✅ SUBSCRIPTION-SPECIFIC |

---

## Summary

### Fields in Parity (Same across both)
- customer_email, customer_name, customer_phone
- delivery_address (line1, line2, city, state, postal_code)
- delivery_window_label, delivery_window_start, delivery_window_end
- production_date

### Fields Adapted (Different but functionally equivalent)
- **One-time:** order_type='one_time', order_number unique per order
- **Subscription:** order_type='subscription', pending_subscription_checkout_id instead of order_number
- **One-time:** selected_delivery_date (single date)
- **Subscription:** first_delivery_date + next_delivery_date (recurring cycle)

### Subscription-Specific Fields (No one-time equivalent)
- pending_subscription_checkout_id (for idempotent webhook handling)
- plan_id, plan_name (subscription plan reference)
- cadence (weekly/monthly)
- bundle_id (subscription bundle)
- delivery_zone_id (zone for subscription fulfillment)
- next_delivery_date (recurring schedule)

### One-Time Specific Fields (Not needed for subscriptions)
- order_number (subscriptions use pending_subscription_checkout_id)
- is_preorder (subscriptions always recurring, not one-off pre-orders)
- fulfillment_mode (subscriptions implicit 'recurring')
- delivery_schedule_source (subscriptions use system default)

---

## Data Storage Strategy

### One-Time Orders
- **Stripe Metadata:** Full metadata (order_number, address fields, delivery dates, etc.)
- **Customer App:** Pre-created pending Order + CheckoutSession (legacy)
- **Hub Sync:** Order → ShopifyOrder (operational)

### Subscriptions (V2)
- **Stripe Metadata:** Essential fields only (pending_subscription_checkout_id, plan_id, production_date, first_delivery_date)
- **Customer App:** 
  - PendingSubscriptionCheckout (full metadata + calculated dates)
  - Subscription (after webhook)
- **Hub Sync:** Subscription → ShopifyOrder (operational)

### Rationale
- Subscriptions have more metadata (plan composition, recurring dates, zones)
- Stripe metadata has size limits (~500 chars per key)
- PendingSubscriptionCheckout provides:
  - Idempotent webhook handling
  - Audit trail of date calculations
  - Fallback if Stripe metadata missing
  - Flexible schema for future enhancements

---

## Webhook Handling Comparison

| Step | One-Time (payment_intent.succeeded) | Subscription (checkout.session.completed) |
|------|-------------------------------------|------------------------------------------|
| 1 | Receive payment_intent.succeeded | Receive checkout.session.completed |
| 2 | Load CheckoutSession by stripe_session_id | Load PendingSubscriptionCheckout by pending_subscription_checkout_id |
| 3 | Create Order from Stripe metadata | Create Subscription from PendingSubscriptionCheckout + Stripe subscription ID |
| 4 | Deduct points/credits if applicable | Award loyalty points (10 pts per $1) |
| 5 | Push to Shopify | Sync to Hub as customer.subscription_created |
| 6 | Sync to Hub (order.created) | Mark PendingSubscriptionCheckout as completed |

---

## Loyalty Accrual

| Event | One-Time | Subscription |
|-------|----------|--------------|
| First Payment | 10 pts per $1 (webhook) | 10 pts per $1 (webhook) |
| Idempotency | Checked by payment_intent_id | Checked by invoice_id |
| Recurring Payments | N/A | Hub handles (not in Customer App) |

---

## Production & Delivery Date Calculation

Both use **unified logic** from `resolveSubscriptionFirstFulfillment.js`:

```
Order Timestamp (Chicago time)
  → Determine Next Production Date (Tue/Fri/Sat, respecting 2pm cutoff)
    → Add 1 day → First Delivery Date
      → Add 7 days (weekly) or +1 month (monthly) → Next Delivery Date
```

**Stored on:**
- One-Time: Order.production_date, Order.assigned_delivery_date
- Subscription: PendingSubscriptionCheckout + Subscription.started_date, Subscription.next_delivery_date

---

## Future Enhancements

1. **Webhooks for subscription events:** pause, skip, cancel → update Subscription record
2. **Production schedule versioning:** Store `date_calculation_version` for audit
3. **Custom delivery windows per zone:** Expand from static '5 PM – 8 PM'
4. **Subscription modification:** Allow customer to change plan → recalculate delivery dates
5. **Loyalty on recurring invoices:** Hub syncs renewal payments → Customer App awards points