# G47F-PATCH1-SMOKE1 — iPhone Apple Pay diagnostic smoke result

## 1. Scope

This document records the user-assisted iPhone Safari smoke for the G47F-PATCH1 side-effect-free Apple Pay mount diagnostic.

Current published state at smoke time:

```text
PR #539 merge commit: e47af458350f55b928bf7af7b7dd7cd0d8d65725
Web/customer UI published: yes
Live asset: /assets/index-ConQHJ7h.js
Diagnostic route: https://nuvirajuice.com/checkout?apple_pay_mount_diagnostic=1
CONFIG2 public-config endpoint: live
Prior classification: apple_pay_side_effect_free_mount_published_pending_iphone_safari_smoke
```

This smoke did not approve or perform payment submission.

## 2. Smoke timestamp

Baseline timestamp recorded before the iPhone smoke:

```text
smoke_start_timestamp=2026-06-20T19:37:42Z
baseline_checked_at=2026-06-20T19:37:54.770Z
post_smoke_checked_at=2026-06-20T22:11:14.752Z
```

## 3. User-assisted screenshot result

The operator provided iPhone Safari screenshots from the live production hostname `nuvirajuice.com`.

Observed visual evidence:

```text
device=iPhone
browser=Safari
production_hostname=nuvirajuice.com
diagnostic_page_loaded=true
diagnostic_only_warning_visible=true
express_checkout_area_visible=true
apple_pay_button_visible=true
link_button_visible=true
amazon_pay_button_visible=true
apple_pay_sheet_opened=false
payment_submitted=false
```

The screenshot showed the admin diagnostic header and copy:

```text
Apple Pay mount diagnostic
Side-effect-free Express Checkout mount...
DIAGNOSTIC ONLY — DO NOT SUBMIT PAYMENT
Diagnostic preview only. Do not submit payment.
```

No Wallet card details, credentials, cookies, session tokens, publishable-key values, or raw Stripe payloads were recorded in this document.

## 4. Safe diagnostic booleans

Screenshot-visible diagnostic booleans:

```text
diagnostic_mode_active=true
public_config_loaded=true
express_checkout_mounted=true
available_payment_methods_present=true
apple_pay_available=true
google_pay_available=false
link_available=true
apple_pay_button_visible=true
```

These values confirm that NuVira's live diagnostic mount can render Apple Pay on the proven iPhone Safari environment without creating a PaymentIntent first.

## 5. Remote Safari network inspection

Remote Safari network inspection was not available in this Codex run.

```text
remote_safari_network_inspection_unavailable
```

Because no remote network trace was captured, this smoke does not include direct browser-network proof for absence of hard-stop requests. The remaining no-side-effect finding is based on:

- source and bundle validation from PATCH1;
- CONFIG2 read-only public-config boundary verification;
- screenshot evidence that the diagnostic route rendered the side-effect-free mount path;
- post-smoke server-side Base44 no-write verification.

Hard-stop requests remain prohibited for future inspection:

```text
createPaymentIntent
client-secret retrieval
PaymentIntent creation
Checkout Session creation
Customer App Order creation
ShopifyOrder creation
FulfillmentTask creation
payment confirmation
Hub sync
notification/message functions
```

## 6. PaymentIntent and pending Order result

The diagnostic path is designed to call only the read-only public-config preview before mounting Stripe Elements without an Intent.

Observed / verified in this run:

```text
createPaymentIntent_triggered=false
clientSecret_observed=false
apple_pay_sheet_opened=false
payment_submitted=false
payment_confirmation_performed=false
pending_customer_app_order_created=false
```

Stripe Dashboard read-only PaymentIntent inspection was not available inside this Codex run. No PaymentIntent id, Stripe account id, customer data, payment-method data, or provider payload was recorded.

## 7. Base44 no-write verification

Post-smoke server-side checks compared latest created/updated rows against the smoke start timestamp.

Result:

```text
any_mutation_after_smoke_start_detected=false
writes_performed=false
pii_returned=false
raw_payloads_returned=false
```

Entity checks:

| Entity | Mutation at/after smoke start |
| --- | --- |
| Order | false |
| ShopifyOrder | false |
| FulfillmentTask | false |
| OrderSyncLog | false |
| CommandLog | false |
| OrderReviewQueue | false |
| Notification | false |
| CustomerMessageDeliveryLog | false |
| SafeSyncParityLog | false |
| PurchaseOrder | false |
| OperationalAlert | false |
| ComplianceAlert | false |
| UserPoints | false |
| NuViraCredit | false |

Confirmed no server-side evidence of:

```text
Order mutation
ShopifyOrder mutation
FulfillmentTask mutation
OrderSyncLog creation
CommandLog creation
Notification creation
CustomerMessageDeliveryLog creation
SafeSyncParityLog creation
PurchaseOrder creation
OperationalAlert creation
ComplianceAlert creation
loyalty/credit mutation
```

## 8. Access-boundary result

Admin/owner access:

```text
admin_owner_diagnostic_available=true
```

Anonymous public-config boundary was verified before smoke:

```text
unauthenticated_public_config_status=401
unauthenticated_public_config_key_returned=false
unauthenticated_public_config_writes_performed=false
```

Ordinary customer live session was not available and no new customer was created for this test.

```text
ordinary_customer_live_session_available=false
ordinary_customer_boundary=source_and_harness_verified_not_live_customer_role
```

Access-control interpretation:

- query knowledge alone is not enough to fetch public config;
- public config remains admin/owner authenticated;
- diagnostic route remains default-off and source/harness-restricted to admin/owner.

## 9. Normal checkout regression

Normal checkout was not advanced to payment initialization during this smoke.

Verified by source, harness, and prior publish audit:

```text
ordinary_checkout_default_path_unchanged=true
diagnostic_requires_exact_query=true
diagnostic_ui_absent_without_query=source_and_harness_verified
createPaymentIntent_not_triggered_by_diagnostic=true
normal_checkout_payment_initialization_not_triggered_in_smoke=true
```

## 10. Hard stops preserved

This smoke did not:

- tap Apple Pay;
- open or confirm the Apple Pay sheet;
- submit payment;
- create a PaymentIntent through NuVira checkout;
- create a Checkout Session;
- create a pending Customer App Order;
- create a ShopifyOrder;
- create a FulfillmentTask;
- call Hub;
- send notifications;
- mutate loyalty or credits;
- deduct inventory;
- create a PurchaseOrder;
- change Stripe configuration;
- publish Builder/Base44 after the smoke.

## 11. Final classification

The live iPhone Safari visual smoke confirms Apple Pay renders in NuVira's side-effect-free Express Checkout diagnostic mount, and post-smoke server-side verification found no Base44 entity mutations.

Final classification:

```text
apple_pay_side_effect_free_mount_live_apple_pay_visible
```

## 12. Recommendation

Close G47F-PATCH1 as successful.

Next phase should be planning only:

```text
G47F-PATCH2 — production deferred-Intent payment architecture plan
```

PATCH2 should not begin payment-flow implementation until it has a separate approval packet covering:

- deferred Intent architecture;
- ConfirmationToken behavior;
- exact idempotency/request-id strategy;
- pending Order creation timing;
- cleanup/rollback semantics;
- card fallback preservation;
- webhook compatibility;
- Hub/Shopify/notification boundaries.
