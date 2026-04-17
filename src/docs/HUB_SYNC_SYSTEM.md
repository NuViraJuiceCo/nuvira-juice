# NuVira Hub Bi-Directional Sync System

## Overview

This system creates a reliable, real-time connection between the NuVira customer app and the NuVira Flow Core operational hub. It eliminates manual work, ensures data consistency, and provides complete visibility into operations.

---

## System Architecture

### 1. **Order Sync** (→ Hub)
**Function:** `receiveOrderFromCustomerApp`

- Triggered when customer places order via Stripe checkout
- Sends complete order payload to hub for fulfillment
- Includes: customer info, items, delivery details, payment status
- Error logging: All failures recorded in `ShopifySyncLog`
- **Headers:** `Authorization: Bearer {CUSTOMER_APP_SYNC_SECRET}`

### 2. **Product Sync** (→ Hub)
**Function:** `syncProductsToHub`

- Admin-triggered: Syncs all available products to hub menu
- **Admin-only** (requires role validation)
- Includes: pricing, descriptions, images, categories, availability
- Use case: When catalog changes or hub menu needs refresh

### 3. **Loyalty Sync** (→ Hub)
**Function:** `syncLoyaltyToHub`

- Admin-triggered: Syncs reward tiers and customer loyalty data
- **Admin-only** (requires role validation)
- Includes: tier definitions, point requirements, customer balances
- Use case: Keep hub updated on loyalty program changes

### 4. **Order Status Polling** (← Hub)
**Function:** `pollOrderStatusUpdates`

- **Runs automatically every 5 minutes** (scheduled automation)
- Incremental sync: Uses last sync timestamp to fetch only recent updates
- Polls hub for production + fulfillment status changes
- Updates local `ShopifyOrder` and `Order` records in real-time
- Handles: production status, delivery status, fulfillment progress
- Filter logic: OR within arrays, AND between filters

### 5. **Monitoring Dashboard**
**Component:** `SyncStatusDashboard`

- Real-time view of all sync operations
- Success rate, failures, records synced
- Activity log with auto-refresh every 10 seconds
- System health: Hub connectivity, last sync time
- Located in: Admin → Shopify Integration → Reports tab

---

## Data Flow

```
Customer Places Order
        ↓
Stripe Checkout (createCheckoutSession)
        ↓
Order created in base44 (Order entity)
        ↓
receiveOrderFromCustomerApp → HUB
        ↓
Hub creates fulfillment workflow
        ↓
[Every 5 minutes]
pollOrderStatusUpdates ← HUB
        ↓
Updates ShopifyOrder + Order status
        ↓
Customer sees real-time tracking
```

---

## Sync Rules

### Incremental Sync
- **Timestamp tracking:** Uses `ShopifySyncLog` completed_at for last sync
- **Scope:** Only fetches updates since last sync (if available)
- **Fallback:** If no history, defaults to 2 hours ago
- **Active orders only:** Polls only orders not in fulfilled/canceled/refunded status

### Conflict Resolution
- **Update only:** Never creates duplicates; matches by order_id
- **Ignore stale:** Rejects updates older than local record
- **Status history:** All changes logged in order status_history array

### Error Handling
- **Automatic retry:** Up to 3 attempts on network failure
- **Logging:** All syncs (success, partial, error) logged in ShopifySyncLog
- **Admin alerts:** Failed syncs marked for manual review
- **Graceful degradation:** Partial failures don't block entire batch

---

## API Contracts

### Hub Endpoint: `/receiveOrderFromCustomerApp`
```json
POST https://nuvira-flow-core.base44.app/api/apps/.../functions/receiveOrderFromCustomerApp

{
  "shopify_order_id": "order_123",
  "shopify_order_number": "#1001",
  "customer_email": "customer@example.com",
  "customer_phone": "+1234567890",
  "line_items": [{"title": "...", "quantity": 2, "price": 25.00}],
  "fulfillment_method": "delivery",
  "delivery_address": "123 Main St",
  "requested_delivery_date": "2026-04-20",
  "subtotal": 50.00,
  "total_price": 54.50,
  "payment_status": "paid",
  "customer_notes": "Leave at door"
}
```

### Hub Endpoint: `/pullOrderStatusUpdates`
```json
POST https://nuvira-flow-core.base44.app/api/apps/.../functions/pullOrderStatusUpdates

{
  "since_timestamp": "2026-04-17T10:00:00Z",
  "production_status": ["in_production", "packed"],
  "fulfillment_status": ["scheduled", "in_transit"],
  "order_ids": ["order_123"]
}

Response: [
  {
    "order_id": "order_123",
    "production_status": "in_production",
    "fulfillment_status": "in_transit",
    "delivery_status": "out_for_delivery",
    "updated_at": "2026-04-17T12:00:00Z"
  }
]
```

---

## Backend Functions

| Function | Trigger | Endpoint | Role |
|----------|---------|----------|------|
| `receiveOrderFromCustomerApp` | Checkout → Stripe | Direct invoke | Public |
| `syncProductsToHub` | Admin action | HTTP (Settings tab) | Admin |
| `syncLoyaltyToHub` | Admin action | HTTP (Settings tab) | Admin |
| `pollOrderStatusUpdates` | Scheduled (every 5min) | Automation | Service |

---

## Monitoring

### SyncStatusDashboard Metrics
- **Successful Syncs:** Running count
- **Failed Syncs:** Running count
- **Records Synced:** Cumulative count
- **Failed Records:** Cumulative count
- **Activity Log:** Last 50 sync events
- **System Health:** Hub connectivity status
- **Success Rate:** % of syncs that succeeded

### ShopifySyncLog Entity
Tracks every sync operation:
- `sync_type`: orders, products, inventory, manual, webhook
- `status`: success, error, partial
- `records_synced`: Count of successful records
- `records_failed`: Count of failed records
- `error_details`: Error message if failed
- `triggered_by`: webhook, cron, manual, admin
- `created_date`: Timestamp for sorting

---

## Configuration

### Environment Variables Required
- `HUB_API_URL` = `https://nuvira-flow-core.base44.app/api/apps/69da9e8036b037ad40a9a73f/functions`
- `CUSTOMER_APP_SYNC_SECRET` = Bearer token for hub authentication

### Polling Schedule
- **Interval:** Every 5 minutes (configurable in automation)
- **Batch size:** Up to 100 active orders per poll
- **Timeout:** 30 seconds per request

---

## Admin Workflows

### 1. Manual Product Sync
Admin → Shopify Integration → Settings → "Sync All Products"
- Fetches 100 latest products from base44
- Sends to hub product menu
- Shows success count on completion

### 2. Manual Loyalty Sync
Admin → Shopify Integration → Settings → "Sync Loyalty Rewards"
- Fetches all reward tiers + top 100 customer point records
- Updates hub loyalty program data
- Shows updated tier count

### 3. Check Sync Health
Admin → Shopify Integration → Reports → "Hub Sync Status"
- Real-time view of all sync activity
- Recent sync logs (last 50 events)
- Success rate % calculated in real-time
- Auto-refreshes every 10 seconds

### 4. Investigate Failed Syncs
- Click "Refresh" on SyncStatusDashboard to re-fetch logs
- Check error_details for specific error message
- Contact hub operations team if persistent failures

---

## Premium Features

### ✓ Real-Time Status Updates
Customers see live production status, delivery tracking, and ETA via polling

### ✓ Zero Manual Work
Orders auto-sync to hub; no manual data entry or copy-paste

### ✓ Compliance-Ready
All sync operations logged with timestamps; audit trail available

### ✓ Scaling Support
Supports 100+ orders/day; incremental sync prevents data drift

### ✓ Reliability
Retry logic, error logging, and admin visibility ensure no lost orders

---

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| Orders not reaching hub | Network error | Check hub URL and secret; retry manual sync |
| Status not updating | Polling paused | Verify automation is active in Automations dashboard |
| High failure rate | Hub overloaded | Check hub status; implement exponential backoff |
| Stale data | Last sync lost | Sync logs are authoritative; re-trigger manual sync |

---

## Next Steps

1. **Test:** Place a test order and monitor SyncStatusDashboard for success
2. **Configure:** Verify `HUB_API_URL` and `CUSTOMER_APP_SYNC_SECRET` are set
3. **Monitor:** Check Reports tab daily for sync health
4. **Scale:** Monitor success rate as order volume increases

---

**System Status:** Production-Ready ✓  
**Last Updated:** 2026-04-17