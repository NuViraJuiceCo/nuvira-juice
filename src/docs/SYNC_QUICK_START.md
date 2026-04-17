# Hub Sync System — Quick Start

## What It Does

✓ **Orders** → Automatically sent to hub when customer checks out  
✓ **Status** ← Automatically pulled from hub every 5 minutes  
✓ **Products** ↔ Admin can manually sync catalog to hub  
✓ **Loyalty** ↔ Admin can manually sync rewards to hub  

---

## For Customers

📱 **Order Tracking**
- Order automatically synced to hub after checkout
- Status updates every 5 minutes from hub
- Real-time tracking in NuVira app

---

## For Admins

### View Sync Status
1. Go to: Account → Admin → Shopify Integration → Reports
2. See: Recent syncs, success rate, any errors
3. Auto-refreshes every 10 seconds

### Manually Sync Products
1. Go to: Account → Admin → Shopify Integration → Settings
2. Click: "Sync All Products"
3. Hub menu updates with latest catalog

### Manually Sync Loyalty
1. Go to: Account → Admin → Shopify Integration → Settings
2. Click: "Sync Loyalty Rewards"
3. Hub rewards program updates

### Debug Failed Syncs
1. Check sync dashboard for error details
2. Verify hub is accessible
3. Check `CUSTOMER_APP_SYNC_SECRET` is set in environment

---

## Technical Details

**Polling Interval:** Every 5 minutes  
**Order Batch Size:** Up to 100 per poll  
**Retry Policy:** Auto-retry on network error  
**Logging:** All syncs in ShopifySyncLog entity  

---

## What Gets Synced

| Direction | Data | When |
|-----------|------|------|
| → Hub | New orders | After checkout |
| → Hub | Products (admin) | Manual trigger |
| → Hub | Loyalty (admin) | Manual trigger |
| ← Hub | Order status | Every 5 minutes |

---

## Success Metrics

- **Sync Success Rate:** % of operations that succeeded
- **Records Synced:** Count of successful data records
- **Failed Records:** Count of any failures
- **Last Sync:** When the most recent sync completed

---

## If Something Goes Wrong

| Symptom | Check |
|---------|-------|
| Orders not in hub | Check sync dashboard for errors |
| Status not updating | Verify automation is active |
| Manual sync button disabled | Verify you're logged in as admin |
| Persistent errors | Contact operations |

---

**System is production-ready. No manual setup required.**