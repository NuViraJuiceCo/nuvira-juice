# G47F-CONFIG3 — Authorized Stripe Apple Pay domain and mode results

## 1. CONFIG2 merge result

G47F-CONFIG2 is closed.

- PR: #535
- Merge commit: `150ee38f9aea39a17307d1204ed9969977429fd2`
- Changed file: `docs/migration/g47f-config2-stripe-domain-mode-readonly-verification.md`
- Scope: docs-only/read-only
- No Base44 or Builder publish
- No checkout mount, PaymentIntent, pending Order, Stripe configuration, Hub, provider, or notification mutation

Carry-forward classification:

```text
apple_pay_integration_ready_pending_authorized_stripe_domain_mode_and_device_verification
```

## 2. Authorized access method

CONFIG3 used an authorized Stripe Dashboard browser session in read-only mode.

Actions performed:

- inspected Stripe Dashboard Payment method domains in live mode
- inspected Stripe Dashboard Payment method domains in sandbox/test mode
- inspected the default platform payment-method configuration in live mode
- inspected the default platform payment-method configuration in sandbox/test mode
- repeated public `HEAD` checks for production checkout hostnames
- recorded operator-supplied iPhone Safari Stripe demo evidence

Actions not performed:

- no Stripe Dashboard setting was changed
- no payment-method domain was added, removed, enabled, disabled, or verified
- no Apple Pay/payment-method setting was enabled or disabled
- no Stripe account id, API key, session id, customer data, payment data, PaymentIntent id, domain id, or configuration id is recorded in this document
- no NuVira checkout mount was opened
- no PaymentIntent, Checkout Session, pending Order, payment, Hub call, provider call, notification, Base44 publish, or Builder publish occurred

Sanitized local evidence remains:

```text
Stripe CLI: unavailable
STRIPE_SECRET_KEY: unset
STRIPE_PUBLISHABLE_KEY: unset
STRIPE_WEBHOOK_SECRET: unset
Eligible Apple Pay iPhone/Safari Stripe demo evidence: supplied; Apple Pay rendered
```

## 3. Production hostname map

Public HEAD checks were repeated without executing checkout JavaScript or mounting Stripe Elements.

| URL checked | HTTP result | Redirects | Effective URL | Checkout rendering implication |
| --- | ---: | ---: | --- | --- |
| `https://nuvirajuice.com/checkout` | `200` | 0 | `https://nuvirajuice.com/checkout` | effective apex checkout host |
| `https://www.nuvirajuice.com/checkout` | `301` then `200` | 1 | `https://nuvirajuice.com/checkout` | redirects to apex before final checkout response |

Effective customer checkout hostname remains:

```text
nuvirajuice.com
```

`www.nuvirajuice.com` is still recorded because it is registered in Stripe and appears in static source references, but the public checkout route redirects to the apex hostname before the final checkout page response.

## 4. Live-domain result

Live-mode Stripe Dashboard Payment method domains were inspected read-only.

Minimum requested fields:

```text
live_domain_present=true
live_domain_status=verified
apple_pay_live_active=true
```

Detailed live-domain result:

| Hostname | Present in live Dashboard | Dashboard status | CONFIG3 status mapping | Notes |
| --- | --- | --- | --- | --- |
| `nuvirajuice.com` | yes | Enabled | verified | effective production checkout hostname |
| `www.nuvirajuice.com` | yes | Enabled | verified | registered, but public checkout redirects to apex before final page response |

No live domain was registered, removed, enabled, disabled, verified, or modified.

Classification:

```text
apple_pay_domain_registered_live
```

## 5. Test-domain result

Sandbox/test Stripe Dashboard Payment method domains were inspected read-only.

Minimum requested fields:

```text
test_domain_present=true
test_domain_status=verified
apple_pay_test_active=true
```

Detailed test-domain result:

| Hostname | Present in test Dashboard | Dashboard status | CONFIG3 status mapping | Notes |
| --- | --- | --- | --- | --- |
| `nuvirajuice.com` | yes | Enabled | verified | effective checkout hostname covered in test/sandbox |
| `www.nuvirajuice.com` | yes | Enabled | verified | registered in test/sandbox; checkout publicly redirects to apex |

No test/sandbox domain was registered, removed, enabled, disabled, verified, or modified.

Classification:

```text
apple_pay_domain_registered_test
apple_pay_domain_registered_live_and_test
```

Stripe documentation for Express Checkout states the element presents payment methods that are active, supported, and set up, and that domains must be registered in both relevant testing and live environments. See [Stripe Express Checkout Element](https://docs.stripe.com/elements/express-checkout-element) and [Stripe payment-method domain registration](https://docs.stripe.com/payments/payment-methods/pmd-registration).

## 6. Apple Pay account configuration

The default platform payment-method configuration was inspected read-only in live and sandbox/test mode.

Minimum requested fields:

```text
apple_pay_live_active=true
apple_pay_test_active=true
```

Detailed account/payment-method configuration result:

| Environment | Configuration inspected | Apple Pay row | Apple Pay status | Notes |
| --- | --- | --- | --- | --- |
| live | default platform account payment-method configuration | present | Enabled | read-only Dashboard inspection |
| test/sandbox | default platform account payment-method configuration | present | Enabled | read-only Dashboard inspection |

No Apple Pay setting was enabled, disabled, or changed.

Classification:

```text
apple_pay_payment_method_active_live_and_test
```

## 7. Frontend/backend/webhook mode alignment

The payment-method-domain side is verified in both live and test/sandbox mode. The deployed frontend/backend Stripe key modes were checked with the existing read-only admin verifier. The NuVira checkout mount was not opened.

Mode result:

```text
frontend_stripe_mode=live
backend_create_payment_intent_mode=live
webhook_mode=live
payment_method_domain_mode=both
stripe_mode_consistent=true
```

Known evidence:

- `nuvirajuice.com` is registered/enabled in both live and test/sandbox Dashboard Payment method domains.
- Apple Pay is enabled in both live and test/sandbox default platform payment-method configurations.
- The read-only `verifyStripeLiveMode` admin function reported the deployed publishable key mode as live.
- The same read-only admin function reported the deployed backend secret key mode used by Stripe server-side calls as live.
- The verifier's returned key-prefix sample values were intentionally not recorded.
- Webhook mode was not inferred from `STRIPE_WEBHOOK_SECRET` or any signing-secret prefix.
- Live Stripe Dashboard Workbench Webhooks showed an active `stripeWebhook` destination for the Base44 customer app endpoint.
- Test/sandbox Stripe Dashboard Workbench Webhooks also has a sandbox event destination, but the production checkout/webhook alignment is live.
- Reaching the NuVira wallet mount can create a PaymentIntent and pending Customer App Order, so it was not used as a key-mode probe.

Hard stops remain:

- no NuVira checkout mount without separate approval because mount can create a PaymentIntent and pending Customer App Order
- no transaction test without explicit transaction approval

Potential later classifications:

```text
apple_pay_configuration_ready_pending_approved_nuvira_mount_smoke
```

## 8. Stripe demo device result

A paired physical iPhone was visible to the development host and Safari was launched to Stripe's official wallet-rendering test page. The operator then supplied the missing iPhone visual evidence.

Device and demo result:

```text
device=iPhone
browser=Safari
ios_version_family=iOS 26
wallet_configured=true
apple_pay_visible_in_stripe_demo=true
private_browsing_used=true
```

Evidence recorded:

- Stripe's Express Checkout Element tab was selected.
- The Apple Pay button rendered successfully.
- Stripe's device capability output showed `applePay: true` and `googlePay: false`.
- Apple Pay also rendered in Stripe's Checkout Sessions demonstration.
- No payment was submitted.
- No NuVira checkout mount was opened.

Interpretation:

- `wallet_configured=true` is inferred from Stripe successfully rendering Apple Pay for this device.
- No card details, Wallet details, payment method identifiers, or other Wallet information are recorded.
- Private browsing did not prevent Stripe's demo from rendering Apple Pay.
- The later NuVira smoke should still use a normal, non-private Safari tab to remove private-browsing variance from the merchant integration test.

Stripe’s wallet testing guide recommends comparing wallet rendering in Stripe demos against the merchant integration to separate device/browser setup issues from integration issues. See [Stripe wallet rendering tests](https://docs.stripe.com/testing/wallets?ui=express-checkout-element).

Classification:

```text
apple_pay_device_browser_wallet_eligible
apple_pay_configuration_ready_pending_approved_nuvira_mount_smoke
```

## 9. Safari / WebView context

No runtime Safari or Capacitor WebView test was run by Codex.

Source carry-forward:

- public checkout host is `nuvirajuice.com`
- Capacitor is present in the repo
- no native Stripe Apple Pay plugin dependency was found during G47F/CONFIG1
- absence of a native plugin is not a proven root cause
- Stripe documents Apple Pay support in eligible iOS webviews, subject to standard Apple Pay eligibility requirements

Current classifications:

```text
apple_pay_native_shell_context_unresolved
apple_pay_ios_webview_context_potentially_supported
```

Required later evidence:

- whether checkout opens in external Safari or embedded Capacitor WebView
- effective WebView origin
- whether the same production hostname is used
- whether payment-method domain registration covers that effective origin
- whether Stripe wallet demo succeeds in the same context
- whether failure is Safari-wide or WebView-specific

## 10. Option-contract carry-forward

No option-contract patch was made.

Carry-forward result:

```text
express_checkout_option_contract_legacy_but_supported
```

Rationale:

- Installed `@stripe/stripe-js@5.10.0` type definitions support `wallets.applePay`.
- Installed types also mark `wallets` deprecated and prefer `paymentMethods`.
- Current Stripe docs describe `paymentMethods.applePay` and note `always` cannot force unsupported platform/currency/domain/account behavior.
- Therefore, `wallets.applePay` is a cleanup candidate, not a proven root cause.

Do not patch the option contract until domain, mode, and device evidence are complete or an approved cleanup phase is opened.

## 11. Root-cause classification

CONFIG3 now proves that Stripe payment-method domains and Apple Pay activation are not currently the known blockers for the inspected live/test Dashboard configurations.

Verified classifications:

```text
apple_pay_domain_registered_live
apple_pay_domain_registered_test
apple_pay_domain_registered_live_and_test
apple_pay_payment_method_active_live_and_test
express_checkout_option_contract_legacy_but_supported
```

Final CONFIG3 interpretation:

```text
live_domain_present=true
live_domain_status=verified
apple_pay_live_active=true

test_domain_present=true
test_domain_status=verified
apple_pay_test_active=true

frontend_stripe_mode=live
backend_create_payment_intent_mode=live
webhook_mode=live
payment_method_domain_mode=both
stripe_mode_consistent=true

device=iPhone
browser=Safari
ios_version_family=iOS 26
wallet_configured=true
apple_pay_visible_in_stripe_demo=true
```

Final classification:

```text
apple_pay_configuration_ready_pending_approved_nuvira_mount_smoke
```

Meaning:

- Stripe domain configuration is clean.
- Live/test mode alignment is clean.
- The iPhone/browser/wallet is eligible.
- Apple Pay renders in Stripe's Express Checkout demo.
- The remaining question is specific to NuVira's checkout mount/integration, not general Apple Pay device eligibility.
- `wallets.applePay` remains deprecated but supported and is not yet proven to be the root cause.
- Capacitor/WebView context remains unresolved until a separately approved NuVira mount smoke is run.

## 12. Exact next action

CONFIG3 can close with the final classification:

```text
apple_pay_configuration_ready_pending_approved_nuvira_mount_smoke
```

Decision table:

| Evidence outcome | Classification | Next action |
| --- | --- | --- |
| frontend/backend/webhook modes disagree | `apple_pay_environment_mode_mismatch` | not current evidence; narrow environment correction plan would be required |
| Stripe demo fails on eligible iPhone/Safari setup | `apple_pay_device_browser_wallet_ineligible_or_unconfigured` | not current evidence; fix device/browser/wallet setup before NuVira test |
| domain/mode/demo clean | `apple_pay_configuration_ready_pending_approved_nuvira_mount_smoke` | current evidence; prepare G47F-LIVE1 mount smoke approval |
| WebView differs from Safari | `apple_pay_webview_origin_or_eligibility_issue` | future WebView-specific investigation if NuVira Safari succeeds but shell/WebView fails |

Domain-registration action is not currently indicated from inspected Dashboard evidence because both apex and `www` domains are present/enabled in live and test/sandbox.

Do not open the NuVira checkout mount in CONFIG3. G47F-LIVE1 is a separate approval because the mount path is expected to create one Stripe PaymentIntent and one pending Customer App Order.

## 13. Transaction-smoke prerequisites

Do not open the NuVira Express Checkout mount as part of CONFIG3.

The current checkout path can create:

- one PaymentIntent
- one pending Customer App Order

A later G47F-LIVE1 must explicitly approve:

- exact environment
- maximum amount
- approved customer/test identity
- expected pending Order
- idempotency/request evidence where supported
- cleanup/cancellation procedure
- payment void/refund procedure if a payment is later submitted
- no Hub suppression
- no unrelated checkout changes

No completed payment is approved by CONFIG3.

## 14. No-write / no-payment confirmation

CONFIG3 did not:

- register or remove domains
- enable or disable payment methods
- change Stripe settings
- change webhook settings
- change frontend/backend keys
- create a PaymentIntent
- create a Checkout Session
- create a pending Customer App Order
- open the NuVira checkout payment mount
- submit payment
- capture payment
- refund payment
- modify checkout code
- publish Base44 or Builder
- mutate Order, ShopifyOrder, or FulfillmentTask
- call Hub
- call providers
- send notifications
- print Stripe keys, account identifiers, domain identifiers, configuration identifiers, Wallet details, card details, or customer payment data

## 15. G47F-LIVE1 approval packet / runbook draft

Do not execute this runbook as part of CONFIG3.

G47F-LIVE1 purpose:

```text
approved_nuvira_express_checkout_mount_smoke_no_payment_submission
```

G47F-LIVE1 must explicitly approve and record:

- environment: live
- maximum authorized amount: to be approved before execution
- approved customer/test account: to be approved before execution
- exact cart contents: to be approved before execution
- expected side effects:
  - one Stripe PaymentIntent may be created
  - one pending Customer App Order may be created
- request-id/idempotency policy:
  - use a unique request id where supported
  - record the created PaymentIntent and pending Order only as sanitized references/statuses
  - do not retry blindly if the mount creates either side effect
- payment policy:
  - no payment submission
  - do not confirm the Apple Pay sheet
  - close/cancel before authorization
- pending Order cleanup/cancellation policy:
  - identify the exact pending Customer App Order created by the smoke
  - mark/cancel/clean it only under separately approved cleanup steps
  - do not hide or mutate unrelated orders
- PaymentIntent cancellation policy:
  - cancel only the exact PaymentIntent created by the smoke, if cancellation is required and separately approved
  - do not capture, refund, or submit payment
- Hub/provider/notification policy:
  - no Hub suppression
  - no Hub mutation beyond existing automatic behavior unless separately approved
  - no notifications
  - no provider calls outside Stripe PaymentIntent creation caused by the mount
- checkout scope policy:
  - no unrelated checkout changes
  - no `wallets.applePay` option-contract patch during the smoke
  - no Base44 or Builder publish during smoke unless separately approved
- rollback / verification:
  - verify no completed payment
  - verify no captured payment
  - verify no duplicate pending Customer App Order
  - verify no notification/message logs
  - verify no unrelated Order, ShopifyOrder, FulfillmentTask, Hub, provider, or webhook changes
  - preserve G47F CONFIG3 evidence as the baseline

G47F-LIVE1 should start with a normal, non-private Safari tab on the same eligible iPhone. Private browsing rendered Apple Pay in Stripe's demo, but the merchant smoke should remove private-browsing variance.
