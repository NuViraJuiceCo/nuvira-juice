# 📋 CUSTOMER APP ↔ HUB REFUND EVENT CONTRACT

**Status:** PENDING VERIFICATION  
**Date:** 2026-05-07  
**Conflict Resolution:** Comparing working paid order sync to failing refund sync

---

## ✅ VERIFIED WORKING CONTRACT (Paid Orders)

### Endpoint
- **URL:** `${HUB_API_URL}/functions/receiveCustomerAppEvent` (from `.env` HUB_API_URL)
- **Method:** `POST`
- **Base URL Example:** `https://nuvira-flow-core.base44.app/`

### Authentication
- **Header Name:** `Authorization`
- **Header Value:** `Bearer ${CUSTOMER_APP_SYNC_SECRET}`
- **Secret Source:** Environment variable `CUSTOMER_APP_SYNC_SECRET`
- **Status:** ✅ Works for `order.created` events
- **Last Verified:** NV-MOPV2CIK paid order sync succeeded with this auth

### Headers
```
Content-Type: application/json
Authorization: Bearer {CUSTOMER_APP_SYNC_SECRET}
```

### Payload Shape (order.created — WORKING)
```json
{
  "event": "order.created",
  "source": "customer_app",
  "order": {
    "id": "order_id",
    "order_number": "NV-XXXXXXXX",
    "customer_email": "email@example.com",
    "customer_name": "Full Name",
    "payment_status": "paid",
    "total": 99.99,
    "items": [...],
    ...
  }
}
```

### Hub Response (SUCCESS)
```json
{
  "status": "acknowledged",
  "event": "order.created",
  "note": "Event received, no action required"
}
```

HTTP Status: `200 OK`

---

## ❌ FAILING CONTRACT (Refund Orders)

### Endpoint
- **URL:** Same as above (`${HUB_API_URL}/functions/receiveCustomerAppEvent`)
- **Method:** `POST` (same)
- **Status:** ❌ Returns **403 Forbidden** when sending `order.refunded`

### Headers (ATTEMPTED)
```
Content-Type: application/json
Authorization: Bearer {CUSTOMER_APP_SYNC_SECRET}
```

### Payload Shape (order.refunded — FAILING)
```json
{
  "event": "order.refunded",
  "source": "customer_app",
  "order": {
    "id": "order_id",
    "order_number": "NV-XXXXXXXX",
    "customer_email": "email@example.com",
    "payment_status": "refunded",
    "refund_id": "re_xxxxx",
    "refund_amount": 99.99,
    "is_partial_refund": false,
    "refunded_at": "2026-05-07T...",
    ...
  }
}
```

### Hub Response (FAILURE)
```
HTTP 403 Forbidden
OR
HTTP 405 Method Not Allowed
```

---

## 🔍 ROOT CAUSE ANALYSIS

The same endpoint and auth that works for `order.created` fails for `order.refunded`. Possible causes:

1. **Hub receiveCustomerAppEvent doesn't have `order.refunded` handler**
   - Solution: Hub team adds handler for `event === 'order.refunded'`

2. **Hub explicitly rejects refund events for security/business reasons**
   - Solution: Whitelist refund events in Hub's auth/validation logic

3. **Auth token expires or is revoked only for refund requests**
   - Unlikely given same Bearer token used for paid orders

4. **Endpoint path is different for refund events**
   - Would need separate endpoint like `/functions/receiveRefundEvent`
   - But error is 403/405, not 404, suggesting endpoint exists but rejects the request

---

## ✅ AGREED CONTRACT (To Be Confirmed by Hub)

### For Automatic Refund Propagation to Work

**Customer App WILL:**
- ✅ Call `${HUB_API_URL}/functions/receiveCustomerAppEvent`
- ✅ Use `POST` method
- ✅ Send `Authorization: Bearer ${CUSTOMER_APP_SYNC_SECRET}` header
- ✅ Send `Content-Type: application/json` header
- ✅ Send `event: "order.refunded"` in payload
- ✅ Send refund details: `refund_id`, `refund_amount`, `is_partial_refund`, `refunded_at`
- ✅ Use same auth and payload format for both paid and refund events (consistency)

**Hub MUST:**
- ✅ Accept `POST` requests to `/functions/receiveCustomerAppEvent`
- ✅ Accept `Authorization: Bearer {CUSTOMER_APP_SYNC_SECRET}` auth
- ✅ Validate Bearer token (check secret matches)
- ✅ Include handler for `event === "order.refunded"`
- ✅ Implement refund cascade (order → FulfillmentTask → ProductionBatch)
- ✅ Return `HTTP 200` with structured JSON response on success
- ✅ Return `HTTP 200` with error details on validation failure (not 403/405)

---

## 🧪 TEST REQUIREMENTS

### Before Automatic Refund Test:
- [ ] Hub confirms `order.refunded` handler is implemented
- [ ] Hub confirms auth validation works for refund events
- [ ] Hub confirms HTTP 200 is returned on successful receipt
- [ ] Hub confirms refund cascade is implemented
- [ ] Stripe confirms `charge.refunded` webhook is enabled

### E2E Test Plan (Once Hub is Ready):
1. Use safe test order (NV-MOPV2CIK, PI: `pi_3TT0w2IrzYHaHkt20qqFLCbQ`)
2. Issue full refund in Stripe
3. Verify `charge.refunded` webhook fires
4. Verify CA order auto-updates to `refunded`
5. Verify CA sends `order.refunded` to Hub (HTTP 200)
6. Verify Hub order auto-updates to `refunded/canceled/excluded`
7. Verify FulfillmentTask canceled
8. Verify ProductionBatch archived
9. Verify Driver Portal excludes order
10. Replay webhook to test idempotency

---

## 📞 NEXT STEPS

### Hub Team
1. Confirm `order.refunded` handler is implemented in `receiveCustomerAppEvent`
2. Confirm same Bearer auth validation works for refund events
3. Confirm endpoint returns HTTP 200 (not 403/405) for refund events
4. Provide test confirmation or HTTP response details for debugging

### Customer App Team
1. ✅ Refund handlers complete (stripeWebhook)
2. ✅ Shared sync helper complete (syncRefundToHub)
3. ✅ Logging enhanced for refund-specific debugging
4. ⏳ Ready to test once Hub confirms handler is live

### Stripe
1. ✅ `charge.refunded` webhook enabled

---

**BLOCKED UNTIL:** Hub confirms `order.refunded` handler is live and accepts Bearer auth