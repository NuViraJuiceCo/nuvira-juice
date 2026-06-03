# Phase G22F: Native safeSync runtime gate hardening

## Purpose

G22F hardens the native safeSync migration path after the Shopify webhook runtime secret propagation incident.

The incident proved that a published Base44 function can briefly keep serving an older runtime artifact even when code and secrets are correct. Before any additional native safeSync writer or Shopify webhook bridge pilot, the migration gates must be read at request time instead of relying on module-level environment snapshots.

## Scope

This phase changes only Customer App backend function gate handling:

- `base44/functions/executeNativeSafeSyncOrderUpdate/entry.ts`
- `base44/functions/shopifyWebhookReceiver/entry.ts`
- `base44/functions/syncOrderToHub/entry.ts`

No native writer is enabled. No dark-launch sampling is enabled. No Shopify API call, Stripe call, provider call, notification, broad sync/repair/replay, inventory deduction, purchase order creation, production mutation, fulfillment mutation, or compliance mutation is added.

## Changes

### Native safeSync writer

`executeNativeSafeSyncOrderUpdate` now reads these controls per request:

- `ENABLE_NATIVE_SAFE_SYNC_WRITER`
- `NATIVE_SAFE_SYNC_WRITER_KILL_SWITCH`
- `NATIVE_SAFE_SYNC_WRITER_SECRET`
- `CUSTOMER_APP_SYNC_SECRET`
- `NATIVE_SAFE_SYNC_WRITER_ALLOWED_SOURCES`
- `NATIVE_SAFE_SYNC_WRITER_ALLOWED_EVENTS`
- `NATIVE_SAFE_SYNC_WRITER_ORDER_ALLOWLIST`

Default behavior remains fail-closed. Live writes still require service auth, enabled flag, kill switch false, allowed source/event, and exact order allowlist.

### Shopify webhook native safeSync bridge

`shopifyWebhookReceiver` now reads these controls per request:

- `ENABLE_SHOPIFY_WEBHOOK_NATIVE_SAFE_SYNC_WRITER`
- `SHOPIFY_WEBHOOK_NATIVE_SAFE_SYNC_TOPICS`
- `SHOPIFY_WEBHOOK_NATIVE_SAFE_SYNC_ORDER_ALLOWLIST`
- `CUSTOMER_APP_SYNC_SECRET`
- `ENABLE_MAY30_NATIVE_ORDER_OPS`

The bridge remains disabled by default. If disabled or not exactly allowlisted, the existing webhook path remains the fallback.

Webhook receipt logging now stores a redacted payload summary instead of the first 500 characters of the raw webhook body.

### syncOrderToHub dark launch

`syncOrderToHub` now reads these controls per request:

- `HUB_API_URL`
- `CUSTOMER_APP_SYNC_SECRET`
- `ENABLE_MAY30_NATIVE_ORDER_OPS`
- `ENABLE_NATIVE_SAFE_SYNC_DARK_LAUNCH`
- `NATIVE_SAFE_SYNC_DARK_LAUNCH_SAMPLE_RATE`
- `NATIVE_SAFE_SYNC_DARK_LAUNCH_ALLOWED_SOURCES`
- `NATIVE_SAFE_SYNC_DARK_LAUNCH_ALLOWED_EVENTS`
- `NATIVE_SAFE_SYNC_DARK_LAUNCH_ORDER_ALLOWLIST`
- `NATIVE_SAFE_SYNC_DARK_LAUNCH_LOGGING_MODE`
- `NATIVE_SAFE_SYNC_DARK_LAUNCH_KILL_SWITCH`
- `NATIVE_SAFE_SYNC_DARK_LAUNCH_RETURN_DEBUG`

The Hub bridge remains live. Native dark-launch comparison remains default-off and dry-run only.

The Hub URL helper also now fails closed when `HUB_API_URL` is absent, matching the existing intended skip behavior.

## Base44 runtime secret propagation runbook

When a Base44 function cannot read a secret even though code and `base44 secrets list` look correct:

1. Confirm the active Base44 app/project is the app serving the live domain.
2. Confirm the function exists in that app.
3. Confirm the secret names are present in `base44 secrets list`.
4. Confirm the code reads the secret at request time or through a helper invoked per request.
5. Publish the current version from Base44 Version History if normal publish/deploy appears stale.
6. Run an auth-safe boundary test.
7. Patch code only if the boundary still fails.
8. Never print, return, or commit secret values.

### Shopify webhook boundary test

For `shopifyWebhookReceiver`:

- `GET /api/functions/shopifyWebhookReceiver` should return `405 method_not_allowed`.
- Synthetic `POST` with an explicit fake HMAC should return `401 Unauthorized`.
- A `500 shopify_webhook_verification_unavailable` response means the runtime still cannot read a signing secret or the live artifact is stale.

Do not send a valid Shopify HMAC unless a real webhook processing test is explicitly approved.

## Next phase

After this hardening is merged and published:

1. Boundary verify disabled/default behavior for:
   - `executeNativeSafeSyncOrderUpdate`
   - `syncOrderToHub`
   - `shopifyWebhookReceiver`
2. Prove `SafeSyncParityLog` creation with one exact allowlisted dark-launch sample if not already proven.
3. Only after durable parity logging is proven, plan the first exact-order native safeSync writer pilot.
