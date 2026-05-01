# Customer App Architecture: Option B (Read-Only Hub Expansion)

**Status**: ACTIVE ✅  
**Date**: May 1, 2026  
**Maintainers**: Customer App Team  

---

## Overview

The Customer App uses **Option B architecture**: a read-only display layer for Hub-verified operational data. The Hub is the single source of truth for orders, fulfillments, deliveries, and production statuses. The Customer App reads and displays this data, plus manages its own local customer checkout and account records.

---

## Source of Truth

| Data Domain | Owner | Authority |
|---|---|---|
| Orders (operational) | Hub | ✅ Hub is authoritative |
| Fulfillment tasks (delivery scheduling) | Hub | ✅ Hub is authoritative |
| Order statuses (received → delivered) | Hub | ✅ Hub is authoritative |
| Customer checkouts (cart → stripe) | Customer App | Local only |
| User profiles (preferences, contact info) | Customer App | Local only |
| Bag returns (verification, credits) | Customer App | Local only |
| Loyalty points, credits | Customer App | Local only |

---

## Active Architecture Paths

### 1. Customer Order Display
**Function**: `getCustomerOrdersWithHub`  
**Called by**: `pages/OrderHistory`  
**Flow**:
1. Resolve customer email (auth email → contact email via UserProfile)
2. Fetch local orders (non-cancelled, non-superseded)
3. Query Hub for orders via `getOrderUpdatesForCustomerApp`
4. Expand Hub subscription orders into fulfillment-level display records
5. Expand local subscription orders via FulfillmentTask
6. Merge: Hub wins on order_number; local fills missing contact info
7. Return merged orders sorted by creation date (newest first)

**Data Flow**:
```
Customer Email (input)
  ↓
UserProfile lookup (resolve contact_email for Apple relay)
  ↓
[Local Orders] + [Hub Orders] (fetch in parallel)
  ↓
Expand subscriptions into fulfillment records
  ↓
Merge (Hub wins)
  ↓
Return display-ready orders
```

**Example**:
- Sukhwant's subscription from Hub: 1 parent order with 4 fulfillments
- Expanded: 4 separate orders (one per week) with correct items (1 Oasis, 1 Aura, 1 Re-Nu)

---

### 2. Admin Order Management
**Function**: `getAdminOrdersWithHub`  
**Called by**: `pages/AdminOrders`  
**Flow**:
1. Fetch all local orders (exclude superseded, cancelled, ghost pre-orders)
2. Fetch all UserProfiles to query Hub for EVERY customer (including cancelled-only)
3. Query Hub for each customer's orders
4. Expand Hub subscriptions into fulfillment records
5. Expand local subscriptions via FulfillmentTask
6. Merge: Hub wins; local fills missing info
7. Return 10 merged orders (6 local + 4 Hub expanded)

**Status Updates**:
- Hub-managed orders (`is_hub_order=true`): status → `pushOrderStatusToHub` (fire-and-forget)
- Local orders: status → `Order.update()` (direct DB)
- Admin can always advance/revert status; history tracked

---

### 3. Driver Route Optimization
**Function**: `optimizeDeliveryRoute`  
**Called by**: `pages/driver/DriverPortal` (RouteTab)  
**Flow**:
1. Fetch local queued orders + expand via FulfillmentTask
2. Fetch Hub orders (same customer pool, same expansion)
3. Merge local + Hub deliveries
4. Filter by delivery date (if specified)
5. Call Google Maps Routes API for optimization (if requested)
6. Return ordered stops with distance/duration

**Deliveries Shown**:
- 7 expected today (May 2) if all orders are on schedule
- Multi-day overview shows upcoming dates

---

## Deprecated Paths (Option A / Push-Pull Sync)

The following functions are **NOT** part of the active sync model. They are either disabled, deprecated, or fire-and-forget.

### ❌ `pollOrderStatusUpdates` (DISABLED)
- **Reason**: Hub endpoint no longer available (405 Method Not Allowed)
- **Status**: Returns 410 Gone with deprecation message
- **Action**: Do NOT re-enable unless switching to Option A
- **Replacement**: Use `getCustomerOrdersWithHub` for order display

### ⚠️ `syncOrdersFromHub` (LEGACY READ-ONLY CACHE)
- **Status**: Available as manual admin tool only
- **Behavior**: Lists local orders, does NOT sync from Hub
- **Safety**: Cannot overwrite Hub data; read-only only
- **Action**: Keep only if clearly marked legacy/inspect-only

### ⚠️ `pushOrderStatusToHub` (FIRE-AND-FORGET, NON-AUTHORITATIVE)
- **Status**: Called by admin when updating Hub-managed order status
- **Behavior**: Returns 200 but fails silently if Hub endpoint not deployed
- **Limitation**: Hub is the source of truth; this push is best-effort only
- **Important**: Do NOT display to users as "synced to Hub" unless `hub_synced=true`
- **Future**: Hub will pull Customer App order data on its own schedule via `getAllOrdersForSync`

### ❌ `receiveOrderStatusUpdates` (NOT DEPLOYED)
- **Reason**: Not needed in Option B; Hub is not pushing status into Customer App
- **Status**: Function does not exist in Customer App
- **Action**: Do NOT deploy

### ❌ `getOrdersForHub` (NOT DEPLOYED)
- **Reason**: Not used in current architecture; Hub pulls via its own approved path
- **Status**: Function does not exist in Customer App
- **Action**: Do NOT deploy

---

## Fulfillment Task Entity (Read-Only Display Helper)

### Schema
The `FulfillmentTask` entity is a minimal read-only schema for storing expanded fulfillment metadata during display queries.

```json
{
  "order_id": "ref to parent Order (for local subscriptions)",
  "customer_email": "email for query filtering",
  "fulfillment_number": "1, 2, 3, 4 for weekly/monthly",
  "delivery_date": "scheduled delivery date",
  "items": "line items for this fulfillment",
  "status": "fulfillment-specific status"
}
```

### Guarantees
✅ Customer App does NOT create operational FulfillmentTasks  
✅ Hub remains the single source of truth for fulfillment tasks  
✅ FulfillmentTask is only used to expand display records in queries  
✅ No conflicts with Hub's authoritative FulfillmentTask records  
✅ User-facing Customer App actions cannot create or modify FulfillmentTasks  

---

## Data Merge Rules

When merging local + Hub orders:

1. **By Order Number** (normalized: strip `#`, lowercase, trim)
2. **Hub Wins** if:
   - Order exists on both Hub and local
   - Hub record is not cancelled/cancelled_only
   - Local record is not marked `SUPERSEDED_BY_HUB`
3. **Local Wins** if:
   - Order exists only locally (not on Hub)
   - Local record is not superseded
   - Local record is not cancelled
4. **Fill Missing Fields**:
   - Hub contact info (name, phone, address) ← filled from local if empty
   - Local orders use Hub fulfillment expansion (if subscriptions)

---

## Status Update Behavior

### Hub-Managed Orders (`is_hub_order=true`)
- Admin clicks "→ Next Stage" in AdminOrders
- Calls `pushOrderStatusToHub` (fires off async)
- Returns immediately (does not wait for Hub confirmation)
- **Important**: User sees status updated locally, but Hub may not receive it
- On next `getAdminOrdersWithHub` refresh, Hub status is authoritative (overrides local)

### Local-Only Orders
- Admin clicks "→ Next Stage" in AdminOrders
- Calls `Order.update()` directly
- Status updated immediately in local DB
- No Hub push required (order is not Hub-managed)

### Driver Status Updates
- Driver clicks "Mark Delivered" in DriverPortal
- If Hub-managed: calls `pushOrderStatusToHub` (fire-and-forget)
- If local: calls `Order.update()` (direct)
- Proof-of-delivery photo uploaded + stored locally
- Email sent to customer

---

## Quality Gates (Verified ✅)

✅ Customer App does NOT display parent subscription orders with 0 items  
✅ Customer App does NOT hide valid Hub orders silently  
✅ Customer App does NOT overwrite Hub-verified order data with stale local data  
✅ Customer App does NOT create duplicate local records during sync  
✅ Customer App does NOT treat local FulfillmentTask as source of truth  
✅ Customer App displays Hub-expanded data correctly (1 Oasis, 1 Aura, 1 Re-Nu per fulfillment)  
✅ Customer App shows sync errors clearly (pollOrderStatusUpdates returns 410)  
✅ FulfillmentTask cannot be modified by user-facing Customer App actions  

---

## Future Migration (If Switching to Option A)

If the architecture needs to switch to Option A (push/pull sync loops):

1. **Do NOT mix models**: Disable Option B functions completely before enabling Option A
2. **Formal migration**: Plan, test, and deploy in a separate change
3. **Notify team**: Update this document and notify all developers
4. **Decomission unused functions**: Remove deprecated Option B paths
5. **Test thoroughly**: Verify no competing sync loops or overwrites

---

## Development Rules

1. **Do NOT** add new sync functions that overlap with `getCustomerOrdersWithHub`, `getAdminOrdersWithHub`, or `optimizeDeliveryRoute`
2. **Do NOT** create background sync workers without checking this document first
3. **Do NOT** let FulfillmentTask be created by user-facing actions
4. **Do NOT** display `pushOrderStatusToHub` as real-time Hub sync to users
5. **Do NOT** re-enable `pollOrderStatusUpdates` unless architecture officially switches to Option A
6. When in doubt, refresh UI to get latest Hub data — do NOT assume local cache is correct

---

## Monitoring & Alerts

- `pushOrderStatusToHub` failures are logged but non-fatal (expected in current state)
- `pollOrderStatusUpdates` returns 410 (expected; function is disabled)
- Merging conflicts (same order_number on both sides) → Hub wins (expected)
- Customer sees all 7 deliveries for May 2 → healthy (expected)
- Order History shows 4 fulfillments per subscription → healthy (expected)

---

## Questions?

See the inline comments in:
- `functions/getCustomerOrdersWithHub`
- `functions/getAdminOrdersWithHub`
- `functions/optimizeDeliveryRoute`
- `functions/pushOrderStatusToHub` (fire-and-forget disclaimer)
- `functions/syncOrdersFromHub` (legacy/read-only notice)
- `functions/pollOrderStatusUpdates` (disabled notice)