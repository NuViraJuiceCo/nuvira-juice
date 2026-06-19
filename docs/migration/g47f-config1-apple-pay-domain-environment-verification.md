# G47F-CONFIG1 — Apple Pay domain, environment, and Express Checkout contract verification

## 1. G47F closeout

G47F was merged as a docs/harness-only audit.

- PR: #533
- Merge commit: `26a34e6d67724df5ac417f20d7ad6e04609ccfeb`
- Changed files:
  - `docs/migration/g47f-apple-pay-express-checkout-capability-audit.md`
  - `scripts/migration/run-g47f-apple-pay-express-checkout-audit-tests.mjs`
- Scope: docs/harness/read-only
- No runtime, UI, schema, or configuration changes
- No Base44 publish
- No PaymentIntent, Checkout Session, Order, Hub, provider, or notification action

Carry-forward classification:

```text
apple_pay_express_checkout_integration_present_config_and_live_device_validation_pending
```

This CONFIG1 phase remains read-only and makes no Stripe, checkout, Base44, Hub, provider, notification, order, or payment changes.

## 2. Exact checkout hostname inventory

Static source and public HEAD checks identify the customer-facing checkout host as the apex domain.

| Hostname requested | Public result | Redirects | Effective checkout host | HTTPS verification | Checkout path result | Notes |
| --- | --- | ---: | --- | --- | --- | --- |
| `https://nuvirajuice.com` | `200` | 0 | `nuvirajuice.com` | valid | `/checkout` returns `200` HTML | canonical effective host observed by HEAD request |
| `https://www.nuvirajuice.com` | `301` to apex | 1 | `nuvirajuice.com` | valid after redirect | `/checkout` redirects to apex `/checkout` | static SEO and old checkout source still reference `www` |

Source references:

- `src/lib/app-params.js` defaults to `https://nuvirajuice.com`.
- `src/components/SEO.jsx`, `index.html`, `public/sitemap.xml`, and `public/robots.txt` still contain `https://www.nuvirajuice.com` references.
- `base44/functions/createCheckoutSession/entry.ts` hard-codes `https://www.nuvirajuice.com`, but that hosted-session path is not the current embedded Express Checkout path audited here.
- Current embedded payment return URL is built from `window.location.origin` in `src/components/checkout/EmbeddedPayment.jsx`, so the effective origin is the hostname actually serving checkout.

No customer-accessible checkout-specific subdomain was found in source. No customer iframe checkout origin was found in source. The current component has debug logic to detect iframe usage, but CONFIG1 did not execute checkout JS.

Stripe’s Express Checkout documentation notes domain registration should be done for domains/subdomains that display wallet buttons and that iframe origin behavior can matter for Apple Pay. See [Stripe Express Checkout Element](https://docs.stripe.com/elements/express-checkout-element) and [Stripe payment-method domain registration](https://docs.stripe.com/payments/payment-methods/pmd-registration).

## 3. Live/test payment-method domain registration findings

CONFIG1 did not have repo-local Stripe Dashboard/API credentials and did not use a logged-in Stripe Dashboard session. Therefore Stripe payment-method domain status is not asserted.

No Stripe Dashboard mutation was performed:

- no domain registration
- no domain deletion
- no domain enable/disable
- no payment-method setting changes
- no key or account id printed

Current domain classification:

```text
apple_pay_domain_status_unavailable
```

Required read-only Stripe follow-up:

| Effective checkout host | Live mode registration | Test/sandbox registration | Required decision |
| --- | --- | --- | --- |
| `nuvirajuice.com` | unknown | unknown | verify in Stripe payment-method domains before live Apple Pay smoke |
| `www.nuvirajuice.com` | unknown | unknown | verify if any customer can avoid redirect or if Stripe requires the requested host as well as the effective host |

Potential future classifications after authorized Stripe inspection:

```text
apple_pay_domain_registered_live_and_test
apple_pay_domain_missing_live
apple_pay_domain_missing_test
apple_pay_domain_unverified
apple_pay_top_level_iframe_domain_mismatch
apple_pay_domain_status_unavailable
```

## 4. Stripe mode findings

Source behavior:

- `base44/functions/createPaymentIntent/entry.ts` reads `STRIPE_SECRET_KEY` from runtime environment.
- The same function returns `STRIPE_PUBLISHABLE_KEY` from runtime environment.
- `src/components/checkout/EmbeddedPayment.jsx` calls `loadStripe(publishableKey)` using the returned key.
- Static source cannot prove whether the deployed frontend/backend pair is live or test mode.
- CONFIG1 did not print or inspect key values.

Current mode finding:

| Item | Finding |
| --- | --- |
| frontend publishable key mode | unknown from static source |
| backend Stripe secret key mode | unknown from static source |
| payment-method domain mode | unknown because Stripe Dashboard/API was not inspected |
| production website environment | public HTTPS checkout host is reachable at `nuvirajuice.com/checkout` |
| frontend/backend/domain mode agreement | not proven |

Classification:

```text
unknown_environment_configuration
```

Hard stop:

Do not run Apple Pay smoke while frontend/backend/domain environments are unverified or disagree.

## 5. Installed package and Express Checkout option-contract findings

Installed packages:

```text
@stripe/react-stripe-js 3.10.0
@stripe/stripe-js       5.10.0
```

Current source option shape in `src/components/checkout/EmbeddedPayment.jsx`:

```js
wallets: { applePay: 'always', googlePay: 'always' }
```

Installed local type findings from `node_modules/@stripe/stripe-js/dist/stripe-js/elements/express-checkout.d.ts`:

- `paymentMethods.applePay` is supported.
- `paymentMethods.googlePay` is supported.
- `wallets.applePay` is also supported by the installed type package.
- `wallets` is explicitly marked deprecated with the instruction to use `paymentMethods` instead.
- `applePay: 'always'` is a supported value in both shapes.

Current contract classification:

```text
express_checkout_option_contract_legacy_but_supported
```

This is not a proven runtime blocker. It is still a narrow cleanup candidate because current Stripe docs and installed types prefer `paymentMethods`.

Recommended PATCH1 scope if approved later:

- replace deprecated `wallets` with `paymentMethods`
- preserve `applePay: 'always'` and `googlePay: 'always'` only if product policy still wants always-display behavior where Stripe permits it
- preserve card fallback
- remove or sanitize payment-id/token-prefix debug output
- no payment behavior expansion beyond current wallet/card contract

## 6. Availability-event finding

Current source listens through React Stripe.js `onReady` and reads `availablePaymentMethods`:

```jsx
onReady={({ availablePaymentMethods }) => { ... }}
```

Installed `@stripe/react-stripe-js` props document `onReady` for Express Checkout and state it includes the list of payment methods that could possibly show. Installed `@stripe/stripe-js` type definitions expose `availablePaymentMethods` on the ready event.

Current Stripe web docs also reference `availablepaymentmethodschange` as a diagnostic event. That event name is not exposed in the installed local `@stripe/stripe-js@5.10.0` Express Checkout type definitions inspected by CONFIG1.

Classification:

```text
apple_pay_readiness_observed_through_onReady
apple_pay_availablepaymentmethodschange_docs_current_but_not_installed_type_exposed
```

Recommended diagnostic stance:

- Do not add `availablepaymentmethodschange` until the installed package contract or an approved package upgrade supports it cleanly.
- A PATCH1 diagnostic can continue using `onReady` safely, or can upgrade the package contract in a separate approved patch.
- Any diagnostic should store only safe booleans and should not log client tokens, payment ids, customer wallet data, or raw Stripe event payloads.

## 7. Browser and device matrix

No live-device checkout test was performed because the current mount path requires `createPaymentIntent`, which also pre-creates a pending Customer App Order.

Stripe’s Express Checkout documentation states wallet visibility depends on active payment methods, supported browser/currency, customer setup, domain registration, and device/browser context. It also notes iOS webview Apple Pay support can exist subject to standard Apple Pay eligibility requirements.

Required matrix for a later approved smoke:

| Environment | Preconditions | Expected read-only signal | Current CONFIG1 status |
| --- | --- | --- | --- |
| iPhone Safari | HTTPS production host, Apple Pay configured, eligible card, non-private browsing | Apple Pay visible or safe unavailable category | pending |
| iOS non-Safari browser | real browser/device eligibility | Apple Pay visibility compared with Stripe docs/demo | pending |
| macOS Safari | Apple Pay configured | Apple Pay visible or safe unavailable category | pending |
| Capacitor iOS WebView | exact WebView origin known, wallet eligibility known | compare with Safari behavior | pending |
| noneligible browser/device | card fallback remains usable | Apple Pay absence not classified as defect | pending |

No transaction or payment-initialization smoke is approved by CONFIG1.

## 8. Safe Stripe demo comparison design

A later approved diagnostic should compare the same eligible device/browser against Stripe’s own wallet rendering demo before NuVira checkout.

Interpretation:

| Stripe demo | NuVira checkout | Likely category |
| --- | --- | --- |
| Apple Pay absent | Apple Pay absent | device/browser/wallet eligibility issue |
| Apple Pay present | Apple Pay absent | domain, mode, integration, mount, or UI issue |
| Apple Pay present | Apple Pay present | integration likely available; payment-flow smoke still separately approved |

No customer payment data should be entered or submitted in CONFIG1 or in a no-transaction demo comparison.

## 9. WebView / native-shell finding

Capacitor is present in source. No native Stripe Apple Pay plugin dependency was found.

Current finding is more nuanced than G47F’s initial static risk: absence of a native plugin does not prove root cause because Stripe documents Apple Pay support in eligible iOS webviews, subject to normal eligibility requirements. However, Capacitor/WebView behavior still must be tested separately from mobile Safari.

Classification:

```text
apple_pay_webview_context_unverified
```

Do not assume a native plugin is mandatory unless Safari succeeds and WebView fails, or Stripe/native platform requirements prove a separate native path is required.

## 10. UI and mount findings

Current source observations:

- Express Checkout container has `minHeight: '48px'`.
- No obvious local `hidden` class is applied to the Express Checkout element.
- Card fallback remains present.
- `onLoadError` records a sanitized error message through current callback state.
- The wallet section appears only after payment initialization returns a client token.
- Checkout debug paths can log payment initialization identifiers and token prefixes after `createPaymentIntent`; this should be removed or narrowed before any broader production diagnostic work.

Classifications:

```text
apple_pay_express_checkout_mount_ready_after_payment_initialization
apple_pay_mount_blocked_until_payment_intent
apple_pay_readiness_event_observed_through_onReady
apple_pay_hidden_by_ui_layout_not_observed_static
apple_pay_mount_failure_unresolved
```

## 11. Root-cause classification

CONFIG1 narrows the likely root cause but does not prove one final blocker.

Current classification set:

```text
apple_pay_domain_status_unavailable
unknown_environment_configuration
express_checkout_option_contract_legacy_but_supported
apple_pay_readiness_observed_through_onReady
apple_pay_webview_context_unverified
apple_pay_mount_blocked_until_payment_intent
apple_pay_integration_ready_pending_domain_mode_and_device_verification
```

Notably:

- The installed Stripe package supports the existing `wallets` option, but marks it deprecated.
- `wallets.applePay` is therefore not a proven blocker by itself.
- Domain registration and Stripe mode remain the highest-priority external configuration checks.
- Device/browser/wallet eligibility remains untested.

## 12. PATCH1 recommendation

Do not patch checkout before Stripe domain/mode status is verified.

If CONFIG2 or an approved dashboard read proves domain/mode are correct, prepare a narrow G47F-PATCH1:

1. Replace deprecated `wallets` with current `paymentMethods` in `ExpressCheckoutElement` options.
2. Preserve card fallback.
3. Keep wallet availability diagnostics safe and boolean-only.
4. Remove or sanitize payment id / token prefix debug logging.
5. Do not change payment capture, refund, checkout submission, Hub writes, order creation, or notification behavior.
6. Publish only the required customer UI scope after merge.

## 13. Transaction-smoke prerequisites

No transaction or mount path that creates a PaymentIntent/pending Order may run without separate approval.

A future G47F-LIVE1 approval must define:

- live or test mode
- exact maximum amount
- exact customer/test identity policy
- expected pending Order creation
- cleanup or cancellation policy
- refund/void policy if a charge can complete
- no Hub suppression
- no unrelated checkout changes
- request-id/idempotency evidence where supported

## 14. No-write / no-payment confirmation

CONFIG1 did not:

- create a PaymentIntent
- create a Checkout Session
- submit checkout
- capture or refund payment
- register, delete, enable, or disable Stripe domains
- modify Stripe settings
- print Stripe credentials or account ids
- mutate Order, ShopifyOrder, FulfillmentTask, Hub, inventory, or PurchaseOrder records
- call Hub
- call providers
- send notifications
- publish Base44 or Builder
- change runtime/UI/schema/configuration files

## 15. Recommendation

Immediate next step:

```text
G47F-CONFIG2 exact Stripe payment-method-domain and mode verification
```

CONFIG2 should be an authorized read-only Stripe Dashboard/API inspection of:

- `nuvirajuice.com` in live mode
- `nuvirajuice.com` in test/sandbox mode
- `www.nuvirajuice.com` if any customer-visible path can display checkout before redirect or if Stripe requires requested-host coverage
- frontend/backend key mode agreement without printing key values

Only after domain/mode are clean should G47F-PATCH1 or a live device smoke proceed.
