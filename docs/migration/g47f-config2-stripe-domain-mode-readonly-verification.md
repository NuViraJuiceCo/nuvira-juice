# G47F-CONFIG2 — Stripe Apple Pay domain and mode read-only verification

## 1. CONFIG1 merge result

G47F-CONFIG1 is closed.

- PR: #534
- Merge commit: `280027d57d21eb32493a73aa389e85453de5fb6d`
- Changed file: `docs/migration/g47f-config1-apple-pay-domain-environment-verification.md`
- Scope: docs-only/read-only
- No Base44 or Builder publish
- No payment, order, Stripe configuration, Hub, provider, or notification mutation

Carry-forward classification:

```text
apple_pay_integration_ready_pending_domain_mode_and_device_verification
```

CONFIG2 was intended to use authorized read-only Stripe Dashboard/API access. In this Codex environment, no Stripe CLI, Stripe API key environment variable, or explicitly authorized browser Dashboard session was available. Therefore CONFIG2 does not claim live Stripe Dashboard facts. It records the accessible evidence and classifies Stripe domain/mode status as unavailable rather than inferred.

## 2. Production hostname map

Read-only public HEAD checks were used. These requests did not execute checkout JavaScript, mount Stripe Elements, create a PaymentIntent, or create an Order.

| URL checked | HTTP result | Redirects | Effective URL | HTTPS | Checkout UI before redirect |
| --- | ---: | ---: | --- | --- | --- |
| `https://nuvirajuice.com/checkout` | `200` | 0 | `https://nuvirajuice.com/checkout` | valid | top-level checkout HTML served |
| `https://www.nuvirajuice.com/checkout` | `301` then `200` | 1 | `https://nuvirajuice.com/checkout` | valid after redirect | no checkout UI observed before redirect in HEAD response |

Effective production checkout host from public evidence:

```text
nuvirajuice.com
```

Static source carry-forward:

- `src/lib/app-params.js` uses `https://nuvirajuice.com` as the default app base.
- SEO/static metadata still reference `https://www.nuvirajuice.com` in several places.
- The old hosted Checkout Session function hard-codes `https://www.nuvirajuice.com`, but the current Express Checkout flow uses the embedded PaymentIntent path.
- The current embedded payment return URL uses `window.location.origin`.

No customer-accessible checkout subdomain or iframe checkout origin was proven by source review.

## 3. Live-mode payment-method domain result

Live-mode Stripe Payment method domains could not be inspected from this environment.

Sanitized local access check:

```text
Stripe CLI: unavailable
STRIPE_SECRET_KEY: unset
STRIPE_PUBLISHABLE_KEY: unset
STRIPE_WEBHOOK_SECRET: unset
```

No Stripe Dashboard read was performed because no explicitly authorized Dashboard session was available in this task context.

Live-mode classifications:

```text
apple_pay_domain_status_unavailable_live
apple_pay_domain_and_mode_status_unavailable
```

Required live-mode read-only checks remain:

| Hostname | Must inspect in live mode | Reason |
| --- | --- | --- |
| `nuvirajuice.com` | yes | effective checkout-rendering host |
| `www.nuvirajuice.com` | conditional | verify only if checkout can render there before redirect or if Stripe/domain policy requires requested-host coverage |
| any actual iframe/WebView origin | conditional | required only if it displays the embedded payment form |

Do not register, enable, disable, or delete any domain during read-only verification.

## 4. Test/sandbox payment-method domain result

Test/sandbox Stripe Payment method domains could not be inspected from this environment for the same reason as live mode.

Test-mode classifications:

```text
apple_pay_domain_status_unavailable_test
apple_pay_domain_and_mode_status_unavailable
```

Stripe documentation states that Express Checkout payment methods depend on active/supported/setup status and that payment-method domains should be registered in both relevant test and live environments. See [Stripe Express Checkout Element](https://docs.stripe.com/elements/express-checkout-element) and [Stripe payment-method domain registration](https://docs.stripe.com/payments/payment-methods/pmd-registration).

## 5. Apple Pay payment-method activation result

Apple Pay / wallet activation state in Stripe Dashboard could not be inspected from this environment.

No Dashboard settings were changed.

Classification:

```text
apple_pay_payment_method_status_unavailable
```

Required read-only follow-up:

- Apple Pay active in live mode: unknown
- Apple Pay active in test/sandbox mode: unknown
- Express Checkout / Elements eligibility warnings: unknown
- account/merchant country context: unknown, and no account identifier should be printed

## 6. Frontend/backend/webhook mode result

Local static source can prove only that the checkout runtime is environment-driven. It cannot prove deployed key mode.

Source carry-forward:

- `createPaymentIntent` reads `STRIPE_SECRET_KEY` at runtime.
- `createPaymentIntent` returns `STRIPE_PUBLISHABLE_KEY` at runtime.
- `EmbeddedPayment` initializes Stripe with the returned publishable key.
- Existing debug UI can show key mode after payment initialization, but reaching that path can create a PaymentIntent and pending Order.

Sanitized mode result:

```text
frontend_stripe_mode: unknown
backend_stripe_mode: unknown
webhook_stripe_mode: unknown
payment_method_domain_mode: unknown
stripe_mode_consistent: unknown
mode_mismatch_category: stripe_mode_status_unavailable
```

Hard stops remain:

- do not run Apple Pay smoke while frontend/backend/domain modes are unknown or mismatched
- do not reach the NuVira wallet mount path without separate approval for PaymentIntent and pending Order creation

## 7. Stripe demo device result

No eligible-device Stripe demo test was performed by Codex because this environment has no real iPhone/Safari Wallet state and no approved external device session.

Stripe’s wallet testing documentation recommends comparing wallet rendering in Stripe demos against the merchant integration to separate device/browser setup issues from integration issues. See [Stripe wallet rendering tests](https://docs.stripe.com/testing/wallets?ui=express-checkout-element).

Current classification:

```text
apple_pay_device_baseline_not_run
```

Required no-transaction baseline:

- real Apple Pay-capable device
- Wallet configured with eligible card
- non-private browsing
- HTTPS
- Stripe wallet demo shows whether Apple Pay is available in that environment
- no payment details entered
- no transaction submitted

Interpretation remains:

```text
Apple Pay absent in Stripe demo => device_browser_wallet_ineligible_or_unconfigured
Apple Pay present in Stripe demo => device_eligible_for_nuvira_comparison
```

## 8. WebView/native-shell result

Source carry-forward:

- Capacitor is present.
- No native Stripe Apple Pay plugin dependency was found.
- Stripe documentation states Apple Pay can be supported in eligible iOS webviews, subject to standard eligibility requirements.
- Absence of a native plugin is not a proven root cause.

No mobile-shell runtime inspection occurred in CONFIG2.

Classifications:

```text
apple_pay_native_shell_context_unresolved
apple_pay_ios_webview_context_potentially_supported
```

Required later evidence:

- whether checkout opens in external Safari or embedded WebView
- effective WebView origin
- whether that origin matches the registered payment-method domain requirement
- whether Apple Pay is visible in Safari but absent in WebView

## 9. Option-contract carry-forward

Installed package versions remain:

```text
@stripe/react-stripe-js 3.10.0
@stripe/stripe-js       5.10.0
```

Installed local types support both:

```text
paymentMethods.applePay
wallets.applePay
```

The local type file marks `wallets` as deprecated and says to use `paymentMethods`, but still supports the legacy shape.

Current option-contract classification:

```text
express_checkout_option_contract_legacy_but_supported
```

Do not patch `wallets.applePay` as a root-cause fix unless runtime evidence shows it affects rendering. A later cleanup can migrate to `paymentMethods.applePay` after domain/mode evidence is clean.

## 10. Root-cause classification

CONFIG2 could not complete authorized Stripe Dashboard verification from this environment.

Current classifications:

```text
apple_pay_domain_and_mode_status_unavailable
apple_pay_domain_status_unavailable_live
apple_pay_domain_status_unavailable_test
apple_pay_payment_method_status_unavailable
stripe_mode_status_unavailable
apple_pay_device_baseline_not_run
apple_pay_native_shell_context_unresolved
express_checkout_option_contract_legacy_but_supported
```

Current overall classification:

```text
apple_pay_integration_ready_pending_authorized_stripe_domain_mode_and_device_verification
```

## 11. Exact next action

Next required action is not a checkout code patch.

Use one of these authorized read-only paths:

1. Stripe Dashboard read-only inspection by an authorized operator.
2. A tightly scoped read-only Stripe API check using an approved secret source that does not print keys, account ids, payment data, or customer data.

Minimum evidence to collect:

| Evidence | Required result to proceed |
| --- | --- |
| `nuvirajuice.com` live payment-method domain | registered, enabled, verified |
| `nuvirajuice.com` test/sandbox payment-method domain | registered, enabled, verified if testing in test/sandbox |
| `www.nuvirajuice.com` | either not a checkout-rendering origin, or registered if needed |
| Apple Pay payment method | active / no dashboard warnings in the inspected environment |
| frontend/backend/webhook mode | all aligned with the environment being tested |
| Stripe wallet demo on eligible device | Apple Pay visible before NuVira comparison |

If domain registration is missing:

```text
prepare G47F-CONFIG3 exact domain-registration approval
```

If mode alignment fails:

```text
prepare narrow environment configuration correction
```

If domain/mode/device baseline passes:

```text
prepare G47F-LIVE1 approved NuVira mount smoke
```

## 12. Transaction-smoke prerequisites

Do not run NuVira checkout mount or transaction smoke without separate approval because the current path can create a PaymentIntent and pending Customer App Order before payment submission.

A later G47F-LIVE1 must explicitly approve:

- live or test mode
- exact maximum amount
- exact customer/test identity policy
- one PaymentIntent creation
- one pending Customer App Order creation
- cleanup/cancellation policy
- refund/void policy if payment can complete
- no Hub suppression
- no unrelated checkout changes
- request-id/idempotency evidence where supported

A completed payment still requires a separate transaction approval beyond mount visibility.

## 13. No-write / no-payment confirmation

CONFIG2 did not:

- create a PaymentIntent
- create a Checkout Session
- create a pending Customer App Order
- submit checkout
- capture payment
- refund payment
- register or delete a Stripe payment-method domain
- enable or disable Apple Pay
- modify Stripe settings
- change frontend/backend keys
- change checkout code
- publish Base44 or Builder
- mutate Order, ShopifyOrder, or FulfillmentTask
- call Hub
- call providers
- send notifications
- print Stripe keys, account identifiers, or customer payment data
