# Admin Push Notifications

This feature adds gated admin push for paid order processing events.

## Scope

- Sends an admin in-app notification when `notifyOrderProcessed` completes its existing operations email.
- Attempts push only for admin recipients with a saved push subscription.
- Uses notification subtype `admin_order_processed`.
- Keeps customer campaign sending disabled.
- Does not change Stripe, Shopify, checkout, order status, inventory, fulfillment, or sync behavior.

## Required Flags

Set these Base44 secrets to enable the order alert path:

```text
ENABLE_ADMIN_PUSH_NOTIFICATIONS=true
ENABLE_ADMIN_ORDER_PROCESSED_PUSH=true
```

Optional:

```text
ADMIN_PUSH_RECIPIENT_EMAILS=admin1@example.com,admin2@example.com
ADMIN_PUSH_INTERNAL_SECRET=<shared internal secret>
```

If `ADMIN_PUSH_RECIPIENT_EMAILS` is not set, the backend targets users with `role=admin`.
If `ADMIN_PUSH_INTERNAL_SECRET` is not set, the backend uses the existing `HUB_SYNC_SECRET` or `CUSTOMER_APP_SYNC_SECRET` for the internal handoff.

## Admin Device Setup

1. Open the native app as an admin.
2. Go to `/admin/notifications`.
3. Use the `Admin Order Alerts` control to enable push on that device.
4. Use `Test` to send a push only to the logged-in admin.
5. Place a paid test order after flags are enabled.

Expected result:

- Existing operations email still sends.
- One admin notification is created per recipient.
- Push is attempted only for recipients with stored push subscriptions.
- Duplicate order events do not create duplicate admin notifications.

## Diagnostics

`/admin/notifications` shows a small admin-only diagnostic summary:

- number of saved push subscriptions for the logged-in admin
- active token transport types, without exposing raw tokens
- backend readiness based on flags, token presence, and provider credentials
- skipped reason from the last admin push test

The self-test function creates a single admin-only test notification only after at least one active subscription exists.
