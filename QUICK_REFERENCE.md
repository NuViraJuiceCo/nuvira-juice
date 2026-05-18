# Option B Architecture — Quick Reference

## In One Picture

```
Hub (Source of Truth)
  ↓
getCustomerOrdersWithHub     (Customer Order History)
getAdminOrdersWithHub        (Admin Order Management)
optimizeDeliveryRoute        (Driver Route Planning)
  ↓
Customer App UI (Read-Only Display)
  ↓
Admin can update status → pushOrderStatusToHub (best-effort push to Hub)
```

---

## What Works

✅ **getCustomerOrdersWithHub**: Merge + expand customer orders (local + Hub)  
✅ **getAdminOrdersWithHub**: Admin view of all 10 merged orders  
✅ **optimizeDeliveryRoute**: Driver sees all 7 deliveries for today  
✅ **Sukhwant's subscription**: 4 weekly fulfillments with correct items  

---

## What's Disabled / Fire-and-Forget

❌ **pollOrderStatusUpdates**: Returns 410 Gone (polling endpoint gone)  
⚠️ **pushOrderStatusToHub**: Returns 200 but Hub endpoint not deployed  
⚠️ **syncOrdersFromHub**: Legacy read-only cache (manual tool only)  

---

## Data Flow

1. Customer orders → stored locally during checkout
2. Hub orders → fetched on page load via getCustomerOrdersWithHub
3. Hub subscriptions → expanded into 4 fulfillment records each
4. Merge: Hub wins if both sides have same order_number
5. Result: One merged list, no 0-quantity records

---

## FulfillmentTask Entity

- **What**: Read-only display helper for expanded fulfillments
- **Safety**: Cannot be created by Customer App UI
- **Hub**: Remains the source of truth

---

## Key Files

- **ARCHITECTURE_OPTION_B.md** — Full architecture doc
- **FINAL_SYNC_VERIFICATION_REPORT.md** — Test results & verification
- **functions/getCustomerOrdersWithHub** — Implementation
- **functions/getAdminOrdersWithHub** — Implementation
- **functions/optimizeDeliveryRoute** — Implementation

---

## Status Updates

**Hub-managed orders** (`is_hub_order=true`):
- Customer App pushes status → Hub via `pushOrderStatusToHub` (fire-and-forget)
- Hub remains authoritative; Customer App refreshes to get latest

**Local-only orders**:
- Customer App updates directly via Order.update()
- No Hub push required

---

## If Something Breaks

1. Check if order appears in getAdminOrdersWithHub (should return 10)
2. Check if order has 0-quantity items (should not)
3. Check if Sukhwant shows 4 fulfillments (should show 4, not 1)
4. Refresh UI to ensure you're seeing latest Hub data (not stale cache)
5. Review ARCHITECTURE_OPTION_B.md for expected behavior

---

## Rules for Developers

🚫 Do NOT re-enable pollOrderStatusUpdates  
🚫 Do NOT create background sync workers  
🚫 Do NOT let FulfillmentTask be created by user actions  
🚫 Do NOT mix Option A + Option B sync logic  

✅ DO refresh UI to get latest Hub data  
✅ DO check logs for expected failures (pushOrderStatusToHub → Hub not deployed)  
✅ DO read ARCHITECTURE_OPTION_B.md if in doubt  

---

## Questions?

See **ARCHITECTURE_OPTION_B.md** for full details.