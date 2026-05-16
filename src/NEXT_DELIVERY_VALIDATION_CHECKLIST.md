# Next Delivery Run — End-to-End Validation Checklist

**Created:** 2026-05-16  
**Context:** Today's deliveries already completed. This checklist runs on the **next fresh delivery batch** (next Wednesday or Saturday run).

---

## Pre-Delivery (Before Driver Departs)

- [ ] Confirm orders are in `out_for_delivery` status in CA
- [ ] Confirm `syncHubDeliveryStatuses` cron is active (every 10 min)

---

## On First Delivered Order — Verify ALL of the following:

### 1. Order Record (`Order` entity)
- [ ] `status` = `delivered`
- [ ] `delivered_at` = ISO timestamp (NOT null)
- [ ] `delivery_photo_url` = populated URL (if Hub provides photo)
- [ ] `delivery_drop_location` = string (e.g. "Front Door")
- [ ] `delivered_by` = driver email

### 2. Customer App — Order Tracker UI
- [ ] Status shows "Delivered" with correct icon
- [ ] Delivery timestamp displayed (date + time, e.g. "May 21, 2026 at 6:32 PM")
- [ ] Proof of delivery photo visible (if `delivery_photo_url` set)
- [ ] Drop location label shown (if `delivery_drop_location` set)

### 3. In-App Notification (`Notification` entity)
- [ ] Exactly **1** notification created (no duplicates) with `notification_subtype: delivered`
- [ ] `idempotency_key` = `order_status_<order_id>_delivered`
- [ ] Deep link points to `/order-tracker/<order_number>`

### 4. Delivery Confirmation Email
- [ ] Customer receives branded email with order summary
- [ ] Email includes delivery timestamp, drop location, and photo (if available)

---

## Duplicate Notification Monitor (Existing Delivered Orders)

Run this query on the `Notification` entity to confirm no duplicates for today's orders:

```
filter: { notification_subtype: "delivered" }
sort: created_date DESC
limit: 20
```

**Pass criteria:** Each `idempotency_key` appears exactly once.

---

## Known Fixes Deployed (2026-05-16)

| Fix | Description |
|-----|-------------|
| Idempotency dedup | `sendCustomerNotification` now queries by `idempotency_key` directly — race condition eliminated |
| `delivered_at` storage | `syncHubDeliveryStatuses` stores ISO timestamp on status transition |
| Proof-of-delivery fields | `delivery_photo_url` + `delivery_drop_location` captured from Hub payload |
| Delivery confirmation email | Branded email sent on `delivered` status via `sendOrderStatusNotification` |
| OrderTracker UI | Shows exact timestamp + photo + drop location when fields are populated |

---

## Pass / Fail

| Check | Result | Notes |
|-------|--------|-------|
| `delivered_at` populated | ⬜ | |
| `delivery_photo_url` populated | ⬜ | |
| `delivery_drop_location` populated | ⬜ | |
| Exactly 1 delivered notification | ⬜ | |
| Delivery email received | ⬜ | |
| Order Tracker shows timestamp | ⬜ | |
| Order Tracker shows photo | ⬜ | |

**All 7 checks must pass for the delivery confirmation flow to be considered production-validated.**