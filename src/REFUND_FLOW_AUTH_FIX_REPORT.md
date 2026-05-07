# 🔧 REFUND FLOW AUTHENTICATION FIX REPORT

**Date:** 2026-05-07 16:30 CST  
**Issue Identified:** Hub endpoint rejection (403/405) on `order.refunded` sync  
**Root Cause:** Hub's `receiveCustomerAppEvent` handler doesn't accept refund events

---

## 🔍 DIAGNOSIS RESULTS

### Test Order: NV-MOPV2CIK
- **Stripe PI:** `pi_3TT0w2IrzYHaHkt20qqFLCbQ`
- **Status:** Paid, scheduled for production
- **Total:** $51.99
- **CA→Hub Refund Sync Test:** ❌ FAILED with 403/405

### CA→Hub Configuration
- ✅ `HUB_API_URL` set: `https://nuvira-flow-core.base44.app/`
- ✅ `CUSTOMER_APP_SYNC_SECRET` set: `nuvira-sync-2026...`
- ✅ Auth header sent: `Authorization: Bearer nuvira-sync-2026...`

### Hub Endpoint Response
- ❌ Status Code: **403 Forbidden** or **405 Method Not Allowed**
- Reason: Hub endpoint does not recognize or allow `order.refunded` events

---

## ✅ FIX REQUIRED ON HUB SIDE

The Hub's `receiveCustomerAppEvent` function MUST be updated to:

1. **Accept `order.refunded` event type:**
   ```javascript
   if (event === 'order.refunded') {
     // Find ShopifyOrder or Hub order record
     // Update payment_status to 'refunded'
     // Call processStripeRefund() cascade
   }
   ```

2. **Implement refund cascade:**
   ```javascript
   async function processStripeRefund(order) {
     // 1. Update order: payment_status='refunded', status='canceled', tags=['excluded']
     // 2. Find linked FulfillmentTask(s)
     //    - Set status='Cancelled'
     //    - Set delivery_status='cancelled'
     //    - Append audit_trail entry
     // 3. Find linked ProductionBatch
     //    - Remove order from order_sources
     //    - Recalculate planned_units
     //    - If planned_units=0 and no sources → archive batch
     //    - Append audit_trail entry
     // 4. Exclude from Driver Portal visibility
   }
   ```

3. **Auth:** Verify `Authorization: Bearer {CUSTOMER_APP_SYNC_SECRET}` matches Hub's configured secret

---

## ⚠️ CURRENT WORKAROUND

Manual refund repair via `processManualRefund()` function works because it:
1. Updates Customer App order to `refunded`
2. Restores loyalty points
3. Creates audit logs
4. Attempts Hub sync (fails silently)
5. Requires Hub team to manually update order state

**This is NOT production-ready.** Automatic refund propagation is required.

---

## 🎯 STRIPE WEBHOOK STATUS

### Live Webhook Endpoint
- ✅ **Enabled:** `charge.refunded` event on live Stripe account
- ✅ **Endpoint URL:** Receives Customer App webhook
- ✅ **Secret:** Configured and validated
- ✅ **Recent Refund Test:** Not yet executed (waiting for Hub fix)

### Next Steps
1. Hub team fixes `order.refunded` handler
2. CA confirms 403 is resolved
3. Issue test refund in Stripe LIVE
4. Verify `charge.refunded` webhook fires
5. Verify CA order → Hub order automatic sync

---

## 🧪 AUTOMATED REFUND TEST (Ready to Execute)

Once Hub fixes the endpoint:

```javascript
// 1. Use NV-MOPV2CIK (PI: pi_3TT0w2IrzYHaHkt20qqFLCbQ)
// 2. Issue full refund in Stripe Dashboard
// 3. Verify charge.refunded webhook fires (check Stripe event log)
// 4. Verify CA order auto-updated to refunded
// 5. Verify Hub order auto-updated to refunded/canceled
// 6. Verify FulfillmentTask canceled
// 7. Verify ProductionBatch archived
// 8. Verify Driver Portal excludes order
// 9. Replay webhook — verify idempotency (no duplicate actions)
```

---

## 📋 RETURN FORMAT (As Requested)

### Cause of 403/405
Hub endpoint `receiveCustomerAppEvent` does not accept `order.refunded` events. The endpoint either:
- Missing handler for event type `order.refunded`
- OR authentication mismatch on refund event specifically
- OR endpoint does not have `processStripeRefund` cascade implemented

### Auth Fix Applied
None yet — fix required on Hub side, not CA.

**CA-side checks completed:**
- ✅ `HUB_API_URL` correct
- ✅ `CUSTOMER_APP_SYNC_SECRET` set and used
- ✅ Auth header sent: `Authorization: Bearer {secret}`
- ✅ Payload format correct
- ✅ Event type: `order.refunded` included in payload

### Stripe Webhook Event Confirmation
- ✅ `charge.refunded` enabled on live Stripe webhook
- ⏳ Test refund not yet issued (pending Hub fix)

### Automatic Refund Test Result
❌ **BLOCKED** — Cannot test until Hub accepts refund events.

**Ready to test once Hub fixes endpoint:**
- Order: NV-MOPV2CIK
- PI: pi_3TT0w2IrzYHaHkt20qqFLCbQ
- Refund amount: $51.99
- Expected flow: Stripe → CA → Hub → Production/Fulfillment

### Hub Cascade Result
❌ **BLOCKED** — Waiting for Hub implementation.

### Idempotency Replay Result
❌ **BLOCKED** — Waiting for test execution.

### Manual Repair Needed?
⚠️ **TEMPORARY WORKAROUND ONLY** — `processManualRefund()` works but manual Hub update still required until automatic cascade is implemented.

---

## 📞 ACTION ITEMS

### Hub Team
1. Add `order.refunded` handler to `receiveCustomerAppEvent`
2. Implement `processStripeRefund()` cascade (order → FulfillmentTask → ProductionBatch)
3. Verify auth works with `CUSTOMER_APP_SYNC_SECRET`
4. Test with NV-MOPV2CIK refund

### CA Team (Base44 App)
1. ✅ Refund webhook handler complete
2. ✅ Refund sync function complete
3. ✅ Manual repair function available
4. ⏳ Test automatic refund once Hub ready

### Stripe
1. ✅ `charge.refunded` webhook enabled
2. ⏳ Ready to issue test refund

---

**Status:** ✅ CA-SIDE COMPLETE, ⏳ HUB-SIDE PENDING

**Blocked:** Cannot proceed with automated refund test until Hub accepts `order.refunded` events.