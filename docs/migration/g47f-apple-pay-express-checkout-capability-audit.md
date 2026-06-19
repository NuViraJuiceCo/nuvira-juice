# G47F — Apple Pay / Express Checkout capability audit

## 1. Executive summary

G47F is a docs/harness-only audit of the live customer checkout Apple Pay / Express Checkout capability. It follows G47C-FOLLOWUP4 closeout.

G47C-FOLLOWUP4 result:

- PR: #532
- Merge commit: `1e1dd894b3fef00d6a5061e08d9b8566dc24b232`
- Final checkout-anomaly classification: `checkout_native_chain_anomalies_no_clean_remediation_candidates`
- Final exact anomaly result for `NV-MOF1S04J`: `checkout_chain_repair_replay_hold`
- No native ShopifyOrder or FulfillmentTask materialization packet was proven.
- Hub writes remain required.
- G47D suppression/shadow work remains held.

G47F finding:

- Stripe Express Checkout integration is present in source.
- Apple Pay is not hard-disabled in the current checkout component.
- Card fallback remains available.
- Static audit did not create a PaymentIntent, Checkout Session, Order, payment, Hub write, provider call, or notification.
- Root cause is not proven from static source alone because Apple Pay visibility depends on Stripe domain registration, Stripe live/test mode alignment, browser/device/wallet eligibility, and live Express Checkout readiness.

Current root-cause classification set:

```text
apple_pay_integration_present_live_device_validation_pending
apple_pay_domain_registration_status_unknown
apple_pay_express_checkout_option_contract_mismatch_risk
apple_pay_backend_payment_initialization_required_for_mount
apple_pay_webview_unsupported_or_separate_native_path_required
apple_pay_csp_or_origin_unverified
apple_pay_root_cause_unresolved
```

References used for the policy checks:

- [Stripe Express Checkout Element](https://docs.stripe.com/elements/express-checkout-element)
- [Stripe Apple Pay on web](https://docs.stripe.com/apple-pay?platform=web)
- [Stripe payment-method domain registration](https://docs.stripe.com/payments/payment-methods/pmd-registration)
- [Stripe wallet rendering tests](https://docs.stripe.com/testing/wallets?ui=express-checkout-element)
- [React Stripe.js ExpressCheckoutElement reference](https://docs.stripe.com/js/react_stripe_js/elements/express_checkout_element)

## 2. Scope and hard boundaries

This audit is static/read-only.

No G47F action:

- submits a real checkout
- creates a PaymentIntent solely for testing
- creates a Checkout Session solely for testing
- captures, voids, or refunds a payment
- changes Stripe live or test configuration
- registers or removes a payment-method domain
- changes checkout UI/runtime code
- publishes Base44
- mutates Order, ShopifyOrder, FulfillmentTask, Hub, inventory, or PurchaseOrder records
- sends notifications
- suppresses Hub writes

## 3. Current integration map

### Customer checkout page

Path: `src/pages/Checkout.jsx`

Observed behavior:

- Checkout invokes `createPaymentIntent` before the embedded Stripe payment step renders.
- The embedded payment step renders `EmbeddedPayment` only after a returned payment initialization token exists.
- Checkout logs diagnostic payment initialization metadata after the backend response. The log redacts the full client token from the structured response, but still logs the PaymentIntent id and a token prefix in browser console paths. This is not new in G47F, but should be narrowed before any broader customer diagnostics are left enabled.

### Embedded payment component

Path: `src/components/checkout/EmbeddedPayment.jsx`

Observed behavior:

- Uses `loadStripe`, `Elements`, `ExpressCheckoutElement`, `CardNumberElement`, `CardExpiryElement`, and `CardCvcElement`.
- Renders `ExpressCheckoutElement` in a container with `minHeight: '48px'`.
- Tracks `availablePaymentMethods` through the `onReady` handler.
- Handles Express Checkout confirmation with `stripe.confirmPayment` and `redirect: 'if_required'`.
- Keeps card fallback through `stripe.confirmCardPayment`.
- Sets wallet-related options currently shaped as:

```js
wallets: { applePay: 'always', googlePay: 'always' }
```

Current Stripe Express Checkout documentation describes `paymentMethods.applePay` and `paymentMethods.googlePay` for the always/never behavior. This audit does not patch that contract, but it flags a narrow follow-up risk:

```text
apple_pay_express_checkout_option_contract_mismatch_risk
```

### Backend payment initialization

Path: `base44/functions/createPaymentIntent/entry.ts`

Observed behavior:

- Uses runtime Stripe environment variables for the secret key and returned publishable key.
- Creates a Stripe PaymentIntent.
- Uses `payment_method_types: ['card']`.
- Omits `automatic_payment_methods` intentionally in source comments.
- Pre-creates a pending Customer App `Order` after PaymentIntent creation.

Consequence:

A live UI smoke that reaches the payment step would create a PaymentIntent and pending Order through the current runtime path. G47F therefore does not perform a live checkout mount smoke without a separate approved payment/order test plan.

### Legacy hosted checkout function

Path: `base44/functions/createCheckoutSession/entry.ts`

Observed behavior:

- Uses a hard-coded origin of `https://www.nuvirajuice.com`.
- Creates a Stripe Checkout Session with `payment_method_types: ['card']`.
- This is not the primary embedded checkout path audited for G47F.

## 4. Production hostname map

Static source references include:

- `https://www.nuvirajuice.com`
- `https://nuvirajuice.com`

The current embedded payment return URL is generated from `window.location.origin`, so the effective payment-method domain depends on the actual hostname used by the customer at checkout.

Payment-method domain verification remains unknown because G47F did not inspect or change Stripe Dashboard/API configuration.

Required follow-up for each live customer checkout host:

| Hostname | Stripe domain status | Mode | Current finding |
| --- | --- | --- | --- |
| `www.nuvirajuice.com` | unknown | live/test not inspected | `apple_pay_domain_registration_status_unknown` |
| `nuvirajuice.com` | unknown | live/test not inspected | `apple_pay_domain_registration_status_unknown` |
| preview/Base44 hostnames | unknown | not customer canonical | inspect only if customers can reach checkout there |

Stripe documents that wallet button availability depends on active/setup payment methods, supported browser/currency, customer setup, and domain registration. It also documents that domains should be registered for the relevant testing and live environments.

## 5. Stripe environment and mode finding

Source finding:

- Frontend receives `publishableKey` from `createPaymentIntent`.
- Backend reads `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY` from runtime environment.
- Static source cannot prove live/test mode alignment.
- The debug bar can show key mode to a user with `?debug=1`, but G47F did not trigger payment initialization.

Classification:

```text
unknown_environment_configuration
```

Required G47F-CONFIG1 checks:

- confirm production frontend receives the intended live publishable key
- confirm backend uses matching live Stripe credentials
- confirm payment-method domain status in the same mode
- do not print key values
- do not change Stripe configuration without separate approval

## 6. Payment-method domain finding

Static code cannot prove domain registration.

Required read-only Stripe check:

- inspect payment-method domain registration for exact production hostnames
- verify both `www` and non-`www` variants if both can host checkout
- inspect the matching live/test Stripe mode
- do not register, remove, or edit domains during the audit

Likely blocker if absent:

```text
apple_pay_domain_registration_missing
```

Current classification because the status is unverified:

```text
apple_pay_domain_registration_status_unknown
```

## 7. Safari / iPhone eligibility finding

Stripe documents Apple Pay availability on web in Safari beginning with iOS 10/macOS Sierra, subject to compatible device, wallet, supported currency, and customer setup. Express Checkout also only shows eligible payment methods for the current browser/device context.

G47F did not complete live-device validation.

Required no-transaction device smoke:

- real iPhone Safari session
- customer checkout host over HTTPS
- Apple Pay configured with an eligible card
- checkout reaches Express Checkout mount only under an approved non-mutating or approved payment-init test plan
- record only browser class, hostname, HTTPS status, wallet configured yes/no, Express Checkout mounted yes/no, Apple Pay visible yes/no, and safe error category

Classification:

```text
apple_pay_browser_or_wallet_ineligible_possible
apple_pay_integration_present_live_device_validation_pending
```

## 8. Native shell / WebView finding

Source finding:

- Capacitor is present.
- No native Stripe Apple Pay plugin dependency was found in `package.json`.
- Current Apple Pay path is Stripe web Express Checkout rendered inside the web app.

Stripe documents that in-app webview support differs from normal browser support, and mobile app integrations may require Stripe mobile SDK paths depending on product requirements and environment.

Classification:

```text
apple_pay_webview_unsupported_or_separate_native_path_required
```

Follow-up:

- test web Safari separately from the Capacitor/native shell
- do not assume Safari web behavior proves native-shell behavior
- if WebView behavior is the blocker, plan a separate native Apple Pay implementation path rather than forcing the web path

## 9. Browser console/network finding

Not live-tested in G47F.

Static risks to inspect in a live diagnostic session:

- Stripe iframe load errors
- unsupported origin/domain messages
- Content Security Policy blocks
- Express Checkout mount errors
- unavailable payment-method results from `availablePaymentMethods`
- element remount loops
- amount/currency errors
- debug output exposing PaymentIntent id or token prefix after payment initialization

Do not print:

- Stripe secret keys
- publishable key values
- client tokens
- PaymentIntent ids
- Checkout Session ids
- payment method data
- raw Stripe responses

Classification:

```text
apple_pay_csp_or_origin_unverified
```

## 10. UI/layout finding

Static source finding:

- Express Checkout container has `minHeight: '48px'`.
- The element is not locally hidden by an obvious `hidden` class.
- Card fallback remains available and does not remove the Express Checkout section.
- No G47F runtime/UI patch was made.

Current classification:

```text
apple_pay_hidden_by_ui_layout_not_observed_static
```

A live iPhone/Safari diagnostic should still verify:

- nonzero rendered width/height
- no overlay or safe-area clipping
- button not behind another layer
- loading state clears
- card fallback remains usable
- focus/accessibility behavior remains usable

## 11. Root-cause classification

G47F does not prove a single root cause.

Current classifications:

```text
apple_pay_integration_present_live_device_validation_pending
apple_pay_domain_registration_status_unknown
unknown_environment_configuration
apple_pay_browser_or_wallet_ineligible_possible
apple_pay_webview_unsupported_or_separate_native_path_required
apple_pay_csp_or_origin_unverified
apple_pay_express_checkout_option_contract_mismatch_risk
apple_pay_backend_payment_initialization_required_for_mount
apple_pay_root_cause_unresolved
```

## 12. Safest patch/config path

Recommended sequence:

1. **G47F-CONFIG1 — Stripe domain/mode read-only verification**
   - verify production hostnames in Stripe payment-method domains
   - verify live/test key mode consistency
   - no domain registration changes without separate approval

2. **G47F-PATCH1 — narrow Express Checkout option/debug patch, if approved**
   - update Express Checkout option shape to the current Stripe documented `paymentMethods` contract if confirmed compatible with installed Stripe.js/React Stripe.js versions
   - sanitize or remove payment-id/token-prefix debug output
   - preserve card fallback
   - no payment behavior expansion beyond the audited wallet path

3. **G47F-SMOKE1 — live eligible-device smoke**
   - real iPhone/Safari
   - exact production hostname
   - approved no-transaction or explicitly approved payment-init plan
   - no checkout completion unless separately approved

4. **Native-shell decision**
   - if web Safari works but Capacitor shell does not, plan a native-shell Apple Pay phase separately

## 13. Live transaction test requirements

A real payment test is not approved by G47F.

If needed later, require separate approval specifying:

- exact test/live mode
- exact amount
- exact customer/test account
- exact product/cart fixture
- void/refund plan
- expected Order/PaymentIntent side effects
- Hub behavior expectations
- no Hub suppression
- no unrelated checkout changes

## 14. Rollback

Because G47F is docs/harness-only, rollback is limited to reverting the audit artifacts.

If a future patch is made:

- preserve card fallback as the immediate operational fallback
- disable only the new wallet-specific change if it causes checkout instability
- do not disable payment collection broadly unless checkout is unsafe
- do not suppress Hub writes as part of Apple Pay work

## 15. No-write confirmation

G47F did not:

- submit checkout
- create PaymentIntent
- create Checkout Session
- create or mutate Order
- mutate ShopifyOrder
- mutate FulfillmentTask
- call Stripe API
- call Shopify
- call Hub
- call providers
- create logs/queues
- send notifications
- change Stripe configuration
- publish Base44

## 16. Recommendation

Do not patch checkout blindly yet.

Proceed with G47F-CONFIG1 read-only Stripe/domain/mode verification first. If the domain/mode configuration is correct, prepare a narrow G47F-PATCH1 for the Express Checkout option contract and debug-output cleanup, then perform an approved eligible-device smoke. If the issue is isolated to Capacitor/WebView behavior, split native Apple Pay into a separate implementation phase.
