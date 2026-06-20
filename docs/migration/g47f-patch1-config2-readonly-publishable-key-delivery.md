# G47F-PATCH1-CONFIG2: read-only Stripe publishable-key delivery

## 1. Current state

CONFIG1 closed with the frontend Builder/Vite key path unavailable:

```text
apple_pay_diagnostic_frontend_key_delivery_path_unavailable
```

PR #539 remains open and unmerged. PATCH1 must not be published or smoked until a safe frontend publishable-key delivery path exists.

## 2. Existing config-path audit

Existing checkout payment functions read:

```text
STRIPE_PUBLISHABLE_KEY
```

and return it together with payment-intent context. That path is not side-effect-free because the normal checkout flow creates a PaymentIntent and pending Customer App Order before Stripe Elements mounts.

Audit result:

```text
stripe_publishable_key_source_present=true
stripe_publishable_key_source=STRIPE_PUBLISHABLE_KEY
stripe_publishable_key_type=unknown_until_runtime_validation
stripe_publishable_key_mode=unknown_until_runtime_validation
existing_safe_public_config_path=false
```

No existing side-effect-free public config function was found.

## 3. Implemented mode

CONFIG2 extends the existing admin preview function:

```text
base44/functions/previewNativeOrderCutoverReadiness/entry.ts
```

with:

```text
preview_mode=APPLE_PAY_DIAGNOSTIC_PUBLIC_CONFIG
```

This avoids adding another Base44 function.

## 4. Access boundary

The new mode requires an authenticated user with role:

- `admin`, or
- `owner`

Expected boundaries:

```text
GET -> 405
unauthenticated POST -> 401
authenticated non-admin/non-owner -> 403
authenticated admin/owner -> success only when key validates
```

For this mode, the existing internal-secret preview bypass is intentionally not used. Query or route knowledge is not authorization.

## 5. Key validation

The mode reads the same runtime environment variable used by checkout:

```text
STRIPE_PUBLISHABLE_KEY
```

It fails closed unless the value is a live Stripe publishable key.

Accepted:

```text
key_type=publishable
stripe_mode=live
```

Rejected without echoing the value:

- missing or empty value
- test publishable key
- Stripe secret key
- restricted key
- webhook signing secret
- client secret
- PaymentIntent id
- Checkout Session-like values
- unknown key/id formats

The successful response returns the publishable key only because Stripe.js must receive it in the authorized browser. The key is not logged, not stored, and not included in errors.

## 6. Response safety contract

Admin/owner success response includes:

```text
success=true
dry_run=true
writes_performed=false
preview_mode=APPLE_PAY_DIAGNOSTIC_PUBLIC_CONFIG
stripe_publishable_key=<authorized browser only>
stripe_mode=live
key_type=publishable
pii_returned=false
raw_payloads_returned=false
provider_call_impact=false
stripe_calls=false
shopify_calls=false
hub_calls=false
notifications_sent=false
hub_mutation_performed=false
payment_mutation_performed=false
order_mutation_performed=false
command_log_created=false
```

The response sets no-store cache headers when supported.

The key value must never be copied into docs, PR text, screenshots, logs, local storage, session storage, or customer-visible UI.

## 7. Side-effect policy

CONFIG2 does not:

- initialize the Stripe server SDK;
- call Stripe APIs;
- create a PaymentIntent;
- create a Checkout Session;
- create or update a Customer App Order;
- create or update a ShopifyOrder;
- create or update a FulfillmentTask;
- create CommandLog or OrderSyncLog rows;
- call or mutate Hub;
- send notifications;
- mutate loyalty or credits;
- deduct inventory;
- create PurchaseOrders.

## 8. Test coverage

Harness:

```text
scripts/migration/run-g47f-patch1-config2-public-key-delivery-tests.mjs
```

Covers:

- method/auth boundary: GET, anonymous, customer, admin/owner;
- missing/empty/test/secret/restricted/webhook/client-secret/id rejection;
- live publishable-key acceptance with fake fixtures only;
- no key logging;
- no key in error responses;
- cache disabled;
- no PII/raw payloads;
- no Stripe API call;
- no PaymentIntent or Checkout Session;
- no Customer App Order, ShopifyOrder, FulfillmentTask, CommandLog, OrderSyncLog, Hub, notification, or loyalty side effects;
- `writes_performed=false`.

## 9. Publish plan

Do not publish during PR prep.

After merge, publish only:

```text
previewNativeOrderCutoverReadiness
```

Boundary verify:

- GET returns 405;
- unauthenticated POST returns 401;
- non-admin/non-owner returns 403;
- admin/owner returns success only when the key validates as live publishable.

For admin success, verify only:

```text
frontend_public_config_present=true
stripe_mode=live
key_type=publishable
```

Do not print the key. Discard/redact it immediately.

## 10. PATCH1 dependency

Only after CONFIG2 is live should PR #539 be updated so `ApplePayMountDiagnostic`:

1. requests `APPLE_PAY_DIAGNOSTIC_PUBLIC_CONFIG` after admin authorization;
2. keeps the returned key in memory only;
3. initializes Stripe.js with the returned publishable key;
4. never logs or displays the key;
5. never calls `createPaymentIntent` as fallback;
6. fails closed when config retrieval fails;
7. preserves normal checkout unchanged.

Then PR #539 can be rebased/updated, checked, merged, Web-published, and smoked on iPhone without creating a PaymentIntent or pending Order.

## 11. No-write / no-payment confirmation

PR prep only.

No:

- PR #539 merge;
- Web/customer publish;
- Base44 function publish;
- diagnostic route open;
- PaymentIntent;
- Checkout Session;
- pending Order;
- checkout mount;
- Apple Pay sheet;
- payment submission;
- Stripe API call;
- Hub/provider/notification action.

## 12. Classification

PR-prep classification:

```text
apple_pay_diagnostic_readonly_public_key_delivery_pr_ready
```

Post-publish successful classification should be:

```text
apple_pay_diagnostic_readonly_public_key_delivery_live
```
