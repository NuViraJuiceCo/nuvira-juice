# Stripe Webhook Canonical Destination Verification
## Post-Duplicate-Disable Checklist

**Date:** 2026-05-09  
**Status:** Verifying new canonical destination after disabling 4 old duplicates  
**New Destination ID:** `we_1TVFMcIrzYHaHkt2UGgIgipO`

---

## 📋 Pre-Flight Checks

### ✅ Stripe Dashboard Verification

- [ ] **Destination URL:** Confirm it's `https://nuvira-fresh-flow.base44.app/api/functions/stripeWebhook`
- [ ] **Active Status:** Confirm endpoint shows "Active" (green status)
- [ ] **Error Count:** Should show 0 errors (ignore old failed logs from disabled destinations)

### ✅ Required Events Configured

Verify all 12 events are enabled:

- [ ] `checkout.session.completed`
- [ ] `payment_intent.succeeded`
- [ ] `payment_intent.payment_failed`
- [ ] `payment_intent.canceled`
- [ ] `invoice.paid`
- [ ] `invoice.payment_succeeded`
- [ ] `invoice.payment_failed`
- [ ] `customer.subscription.created`
- [ ] `customer.subscription.updated`
- [ ] `customer.subscription.deleted`
- [ ] `charge.refunded`
- [ ] `refund.updated`

### ✅ Get Signing Secret

1. In Stripe Dashboard → Developers → Webhooks
2. Click new destination `we_1TVFMcIrzYHaHkt2UGgIgipO`
3. Click "Signing secret" section and "Reveal"
4. **Copy the secret exactly** (watch for trailing spaces)
   - Format: `whsec_live_XXXX...`

### ✅ Base44 Secret Confirmation

1. Base44 Dashboard → Settings → Environment Variables
2. Find `STRIPE_WEBHOOK_SECRET`
3. **Confirm it matches** the secret from step above (no extra spaces)
4. If different: Update it, save, and wait for redeploy
5. **Note:** Base44 auto-redeploys on secret change; manual redeploy not required

### ✅ No Old Duplicates Remain

In Stripe Dashboard → Developers → Webhooks:

- [ ] Disable check 1: `we_XXXXXXXXX` (old) — **Status: Inactive**
- [ ] Disable check 2: `we_YYYYYYYYY` (old) — **Status: Inactive**
- [ ] Disable check 3: `we_ZZZZZZZZ` (old) — **Status: Inactive**
- [ ] Disable check 4: `we_WWWWWWWW` (old) — **Status: Inactive**
- [ ] Only `we_1TVFMcIrzYHaHkt2UGgIgipO` → **Status: Active**

---

## 🧪 Test Plan: Event Resend

### Test 1: `invoice.paid` (Subscription Revenue)

**Find an event:**
1. Stripe Dashboard → Developers → Event data
2. Filter by `invoice.paid`
3. Copy event ID (e.g., `evt_XXXXXXXX`)

**Resend to new destination:**

**Option A: Stripe Shell**
```bash
stripe events resend evt_XXXXXXXX \
  --webhook-endpoint=we_1TVFMcIrzYHaHkt2UGgIgipO
```

**Option B: Dashboard UI**
1. Click the event
2. Click "Resend event" / "⋯ → Resend to endpoint"
3. Select `we_1TVFMcIrzYHaHkt2UGgIgipO`

**Verify:**
- [ ] Stripe shows **HTTP 200 OK**
- [ ] Base44 function logs show event received (no signature errors)
- [ ] No duplicate Subscription/UserPoints records created
- [ ] OrderSyncLog or Subscription.hub_sync_status shows "synced" or "pending_review"

---

### Test 2: `payment_intent.succeeded` (One-Time Order)

**Find an event:** Filter by `payment_intent.succeeded` in Event data

**Resend to new destination**

**Verify:**
- [ ] Stripe shows **HTTP 200 OK**
- [ ] Base44 logs show event processed
- [ ] No duplicate Order records created (check `stripe_payment_intent_id`)
- [ ] OrderSyncLog shows "success" with hub_order_id

---

### Test 3: `customer.subscription.updated` (Subscription Change)

**Find an event:** Filter by `customer.subscription.updated`

**Resend to new destination**

**Verify:**
- [ ] Stripe shows **HTTP 200 OK**
- [ ] Subscription status updated correctly in Base44
- [ ] No duplicate records
- [ ] Hub sync status reflects update

---

### Test 4: `customer.subscription.deleted` (Cancellation)

**Find an event:** Filter by `customer.subscription.deleted`

**Resend to new destination**

**Verify:**
- [ ] Stripe shows **HTTP 200 OK**
- [ ] Subscription marked as `cancelled` in Base44
- [ ] Hub notified of cancellation (syncCustomerToHub event)
- [ ] No reactivation of cancelled sub

---

### Test 5: `charge.refunded` (Refund Flow)

**Find an event:** Filter by `charge.refunded`

**Resend to new destination**

**Verify:**
- [ ] Stripe shows **HTTP 200 OK**
- [ ] Order marked as `refunded` in Base44
- [ ] Loyalty points restored (if full refund)
- [ ] Hub sync status shows refund processed
- [ ] No duplicate refund records

---

### Test 6: `refund.updated` (Refund Status Change)

**Find an event:** Filter by `refund.updated`

**Resend to new destination**

**Verify:**
- [ ] Stripe shows **HTTP 200 OK**
- [ ] Base44 logs show event processed
- [ ] No side effects on refund processing

---

## 🔍 Idempotency Verification (After Each Test)

After each resend, check Base44 entities for duplicates:

### For Subscriptions:
```
Filter: stripe_subscription_id = [event's stripe_subscription_id]
Expected: 1 record (not 2+)
```

### For Orders:
```
Filter: stripe_payment_intent_id = [event's payment_intent_id]
OR
Filter: stripe_checkout_session_id = [event's session_id]
Expected: 1 record (not 2+)
```

### For Loyalty Points:
```
Filter: customer_email = [event's customer email]
Check: points_history should not contain duplicate entries for same event
```

### For Hub Sync:
```
Filter: order_number = [order number from event]
Check: OrderSyncLog should show only 1 success/terminal entry per event type
```

---

## 📊 Test Results Log

| Test # | Event Type | Event ID | Status | HTTP | App Result | Duplicates? | Hub Sync | Notes |
|--------|-----------|----------|--------|------|-----------|-------------|----------|-------|
| 1 | invoice.paid | evt_... | ✅ | 200 | ✅ | None | Synced | |
| 2 | payment_intent.succeeded | evt_... | ✅ | 200 | ✅ | None | Synced | |
| 3 | customer.subscription.updated | evt_... | ✅ | 200 | ✅ | None | Synced | |
| 4 | customer.subscription.deleted | evt_... | ✅ | 200 | ✅ | None | Synced | |
| 5 | charge.refunded | evt_... | ✅ | 200 | ✅ | None | Synced | |
| 6 | refund.updated | evt_... | ✅ | 200 | ✅ | None | Synced | |

---

## ✅ Final Sign-Off Checklist

- [ ] All 6 test events returned HTTP 200
- [ ] No "Invalid signature" errors (if any 400s, secret mismatch — go back to Pre-Flight)
- [ ] No duplicate Subscription/Order/UserPoints records created
- [ ] No duplicate loyalty points awarded
- [ ] Hub sync succeeded for all events
- [ ] `retryFailedHubSyncs` queue is clean (0 pending errors)
- [ ] All old duplicate destinations remain disabled
- [ ] New destination shows 0 errors, ~6 successful deliveries

---

## 🚀 Go-Live Approval

**Ready to accept live traffic?**

- [ ] All pre-flight checks passed
- [ ] All 6 test events passed
- [ ] No duplicates detected
- [ ] Hub syncs are successful
- [ ] retryFailedHubSyncs is stable

**If all above are checked:** ✅ **New canonical destination is ready for production traffic.**

---

## 🔧 Troubleshooting

| Issue | Symptom | Fix |
|-------|---------|-----|
| Signature Mismatch | HTTP 400 Bad Request | Re-copy signing secret from Stripe, update STRIPE_WEBHOOK_SECRET in Base44 |
| Function Error | HTTP 500 | Check stripeWebhook function logs for exception details |
| Duplicates on Resend | 2+ records for same event | Check if event was previously processed; idempotency should prevent this |
| Hub Sync Fails | OrderSyncLog.status = "error" | Run `retryFailedHubSyncs` to recover; check hub_sync_error for reason |
| Old Events Still Showing 400 | Historical failed logs | Ignore these; they're from disabled destinations. Only check new resends. |

---

## 📝 Notes

- **Signing Secret:** Must be from the **new destination only**. Old destinations had different secrets.
- **HTTP 200:** If any test returns 400, it means the secret in Base44 doesn't match the new destination's secret.
- **No Re-Enable:** Do not re-enable the old destinations. They were disabled to consolidate onto one canonical flow.
- **Auto-Deploy:** Base44 auto-redeploys when STRIPE_WEBHOOK_SECRET changes; no manual action needed.