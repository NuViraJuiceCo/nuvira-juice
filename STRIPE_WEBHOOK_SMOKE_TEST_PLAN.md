# Stripe Webhook Smoke Test Plan
## New Canonical Destination: `we_1TVFMcIrzYHaHkt2UGgIgipO`

---

## ✅ Phase 1: Verify Signature Key Match
Before testing, confirm Base44's `STRIPE_WEBHOOK_SECRET` matches the new destination's signing secret.

**In Stripe Dashboard:**
1. Developers → Webhooks
2. Click `we_1TVFMcIrzYHaHkt2UGgIgipO`
3. Copy "Signing secret" exactly (watch for trailing spaces)

**In Base44 Dashboard:**
1. Settings → Environment Variables
2. Paste secret into `STRIPE_WEBHOOK_SECRET`
3. Save and verify

---

## 🔄 Phase 2: Resend Real Event (Preferred Method)

**Why this method:** Stripe generates valid signatures; no fake payloads.

### Option A: Stripe Dashboard UI
1. Go to Developers → Event data
2. Find a recent event (e.g., `invoice.paid`, `charge.refunded`, `checkout.session.completed`)
3. Click the event ID to open detail
4. Click "Resend event" or "⋯ → Resend to endpoint"
5. Select webhook endpoint: `we_1TVFMcIrzYHaHkt2UGgIgipO`
6. **Wait and check Stripe logs:**
   - Status should be **200 OK**
   - If 400 Bad Request → signing secret mismatch (go back to Phase 1)

### Option B: Stripe Shell CLI
```bash
stripe events resend evt_XXXXXXXXXXXX \
  --webhook-endpoint=we_1TVFMcIrzYHaHkt2UGgIgipO
```
Then check status in Dashboard.

---

## ✨ Phase 3: Verify Customer App Processing

After Stripe shows HTTP 200, check that Base44 processed the event idempotently:

### Check logs in stripeWebhook function:
1. Base44 Dashboard → Code → Functions → `stripeWebhook`
2. View recent function logs/invocations
3. Look for log entries matching the event type (e.g., `[checkout.session.completed]`, `[charge.refunded]`)
4. Confirm no errors like "Webhook signature verification failed"

### Verify idempotency (no duplicates):
- **For checkout.session.completed / payment_intent.succeeded:**
  - Open Base44 entities: Order
  - Search for `stripe_checkout_session_id` or `stripe_payment_intent_id` from the resent event
  - Verify **only ONE Order record** exists (not duplicated on second resend)

- **For subscription events:**
  - Open Base44 entities: Subscription
  - Filter by `stripe_subscription_id` from the resent event
  - Verify **only ONE Subscription record** exists

- **For charge.refunded:**
  - Open Base44 entities: Order
  - Filter by the refund ID
  - Verify refunded status is set correctly, points restored

---

## 🎯 Phase 4: Hub Sync Verification

After order/subscription is created, verify Hub sync:

### Check OrderSyncLog or Subscription.hub_sync_status:
```
OrderSyncLog:
  - order_number = [your order number]
  - status = "success" OR "queued_for_review" OR "deduped" (all acceptable)
  - hub_order_id = [should be set if success]
  - hub_sync_attempted_at = [should be recent timestamp]

Subscription:
  - hub_sync_status = "synced" OR "pending_review"
  - hub_synced_at = [should be recent]
```

If status is **"error"**:
- Check `hub_sync_error` for the reason
- Run `retryFailedHubSyncs` to attempt recovery

---

## 🧹 Phase 5: Cleanup (if you triggered a test order/subscription)

If you resent a **payment-related event** and it created an Order or Subscription:

### For Test Orders:
1. Mark with admin note: `[INTERNAL SMOKE TEST - DELETE]`
2. If paid: Admin refund via `adminCancelAndRefundSubscription` or `processManualRefund`
3. Delete the Order record

### For Test Subscriptions:
1. Mark with admin note: `[INTERNAL SMOKE TEST - DELETE]`
2. Admin cancel via Stripe Dashboard (full refund if needed)
3. Delete the Subscription and related PendingSubscriptionCheckout records

---

## ✅ Final Verification Checklist

After completing all phases, confirm:

- [ ] Stripe delivery status: **HTTP 200**
- [ ] Base44 logs show event received (no signature errors)
- [ ] No duplicate Order/Subscription records created
- [ ] No duplicate loyalty points awarded
- [ ] Hub sync status is "success", "synced", or acceptable terminal state
- [ ] If refund test: Order marked as `refunded`, points restored
- [ ] If subscription test: Subscription marked as `active` or `cancelled` (correct state)
- [ ] `retryFailedHubSyncs` queue is clean (no pending errors)
- [ ] Test records cleaned up (if applicable)

---

## 🚨 If Something Fails

| Symptom | Cause | Fix |
|---------|-------|-----|
| HTTP 400 Bad Request | Signing secret mismatch | Re-verify `STRIPE_WEBHOOK_SECRET` matches new destination |
| HTTP 500 Server Error | Function exception in stripeWebhook | Check function logs for error message |
| Duplicate Order/Subscription | Webhook processed twice (late resend) | Check timestamps; idempotency keys should prevent this |
| Order created but no Hub sync | Hub sync failed or async delay | Wait 30s, then check OrderSyncLog or run `retryFailedHubSyncs` |
| Points not awarded | Loyalty logic skipped (e.g., preorder) | Check Order.is_preorder, points eligibility rules |

---

## 🎬 Next Steps (After Smoke Test Passes)

1. **Disable legacy destinations** in Stripe Dashboard (after confirming this one is stable)
2. **Monitor real traffic** for 24–48 hours (check `retryFailedHubSyncs` logs daily)
3. **Verify production orders/subscriptions** are being processed correctly with no duplicates
4. **Archive test logs** for reference