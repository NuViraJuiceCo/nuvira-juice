# G47F-PATCH1-CONFIG1: frontend Stripe publishable-key configuration audit

## 1. BLOCK2 merge result

G47F-PATCH1-BLOCK2 was merged before this CONFIG1 audit.

- PR: `https://github.com/NuViraJuiceCo/nuvira-juice/pull/540`
- merge commit: `3775786ade6706ee8a729cb6e663adc706cc605c`
- BLOCK2 classification carried into CONFIG1:

```text
apple_pay_diagnostic_frontend_key_configuration_required
```

PR #539 remains open and unmerged. The side-effect-free Apple Pay diagnostic must not be merged, published, or smoked until a live frontend publishable-key source is proven.

## 2. Builder Web environment capability

The NuVira Juice Base44 app/dashboard was accessible and the project identity was confirmed from the Builder UI.

Observed app context:

```text
builder_web_environment_accessible=true
builder_project_confirmed=true
builder_environment=production
```

The visible Base44 dashboard exposes:

- Dashboard → Settings → Secrets / Application Secrets
- Dashboard → Code
- Dashboard → App Settings
- Base44 CLI `site deploy` / `site open`
- Base44 CLI `secrets list|set|delete`

No distinct Web/customer frontend build environment-variable pane or command was found for `VITE_STRIPE_PUBLISHABLE_KEY`.

Base44's visible Application Secrets area and CLI `secrets` command are project secrets. Current Base44 documentation describes secrets as environment variables available to backend functions via `Deno.env.get()`, not as a proven frontend Vite build-time variable injection path.

Capability result:

```text
builder_frontend_env_supported=false
builder_key_injection_supported=false
builder_configuration_scope_safe=false
```

## 3. Existing-variable finding

The Builder UI was inspected for a Web/customer variable source. No existing frontend variable source was proven.

```text
existing_variable_present=false
existing_variable_mode=unknown
frontend_key_variable_present=false
frontend_key_source=NONE
frontend_key_mode=unknown
```

Important distinction:

- Existing backend payment functions use server/runtime `STRIPE_PUBLISHABLE_KEY` and return it after creating payment intent context.
- That backend path is intentionally not usable for PATCH1 because PATCH1 must mount Stripe Elements without creating a PaymentIntent or pending Customer App Order.

## 4. Selected variable name

The intended frontend variable remains:

```text
VITE_STRIPE_PUBLISHABLE_KEY
```

CONFIG1 did not configure it because no safe Builder Web/customer Vite injection path was found.

No runtime global was configured:

```text
window.__NUVIRA_STRIPE_PUBLISHABLE_KEY__ configured=false
```

## 5. Stripe key type/mode verification

Stripe Dashboard was available in the authenticated browser session, but CONFIG1 stopped before copying or entering any key because Builder Web/frontend injection was not proven safe.

No Stripe key value was opened, copied, pasted, printed, committed, or stored.

```text
stripe_frontend_key_available=not_used_due_builder_delivery_path_block
stripe_frontend_key_type=unknown
stripe_frontend_key_mode=unknown
```

The required future value, if a safe Web/frontend delivery path is later established, remains:

```text
stripe_frontend_key_type=publishable
stripe_frontend_key_mode=live
```

A secret key, restricted secret key, webhook secret, client secret, PaymentIntent id, or payment/customer identifier must never be used as the frontend diagnostic key.

## 6. Key value omitted confirmation

This document intentionally omits all key values.

Not recorded:

- publishable key value
- secret key value
- restricted key value
- webhook signing secret
- client secret
- PaymentIntent id
- Checkout Session id
- Stripe account identifier
- auth/session token
- customer email/phone/address
- payment method details

## 7. Production Web scope

No production Web/customer environment variable was saved.

```text
production_web_configuration_saved=false
production_publish_performed=false
```

Reason:

- The visible Base44 configuration surface only proved backend/application secrets, not Web/Vite build-time frontend variables.
- Saving `VITE_STRIPE_PUBLISHABLE_KEY` into a backend/application secrets area would not satisfy PATCH1 unless Base44 documents or proves that those secrets are injected into the Web/customer Vite bundle.
- Using the backend payment-intent function as a fallback would violate the side-effect-free diagnostic contract.

## 8. Save/rebuild behavior

No configuration save was performed.

No Builder rebuild or production publish was triggered by CONFIG1.

```text
builder_save_performed=false
builder_preview_rebuild_triggered=false
builder_production_publish_performed=false
```

## 9. No-production-publish confirmation

CONFIG1 did not publish:

- Builder Web/customer UI
- Base44 functions
- entities/schemas
- backend secrets
- unrelated UI changes

PR #539 remains blocked and unmerged.

## 10. Rollback

No rollback is required because no frontend variable was configured.

If a future approved configuration path is found and `VITE_STRIPE_PUBLISHABLE_KEY` is added, rollback must remove only that frontend variable and must not alter:

- backend `STRIPE_SECRET_KEY`
- backend `STRIPE_PUBLISHABLE_KEY`
- webhook secrets
- Stripe payment-method domains
- payment-method settings
- Builder source files
- checkout runtime code

## 11. No-write / no-payment confirmation

CONFIG1 did not perform:

- PR #539 merge
- Builder/Web publish
- Base44 publish
- function/entity/schema publish
- checkout diagnostic route open
- PaymentIntent creation
- Checkout Session creation
- pending Customer App Order creation
- ShopifyOrder creation
- FulfillmentTask creation
- checkout mount
- Apple Pay sheet open
- payment submission
- Stripe configuration mutation
- Stripe key rotation
- webhook mutation
- Hub mutation
- provider call
- notification/message
- loyalty/credit mutation
- inventory deduction
- PurchaseOrder creation

## 12. Readiness decision for PR #539

Final CONFIG1 classification:

```text
apple_pay_diagnostic_frontend_key_delivery_path_unavailable
```

PR #539 must remain open and unmerged.

Do not resume PATCH1 closeout until one of these is true:

1. Base44 provides or documents a Web/customer frontend build-time variable mechanism that can inject `VITE_STRIPE_PUBLISHABLE_KEY` into the Vite build without publishing unrelated changes; or
2. a separate narrow source patch introduces a safe runtime global delivery path for `window.__NUVIRA_STRIPE_PUBLISHABLE_KEY__`; or
3. a replacement side-effect-free diagnostic strategy is approved that does not require a frontend key and still does not create a PaymentIntent or pending Order.

Do not use `createPaymentIntent` as a key fallback for PATCH1.

## 13. Recommendation

Hold PR #539 under:

```text
apple_pay_diagnostic_frontend_key_delivery_path_unavailable
```

Recommended next phase:

```text
G47F-PATCH1-CONFIG2 — runtime-global or source-level key delivery design
```

CONFIG2 should choose between:

- a safe Builder-supported runtime global injection mechanism, if Base44 support confirms one exists; or
- a narrow runtime source patch that obtains the publishable key without creating a PaymentIntent or Customer App Order; or
- abandoning PATCH1 and returning to the approved PaymentIntent/pending Order mount-smoke path with explicit side-effect cleanup.

Until then:

- do not merge PR #539;
- do not publish the Web/customer bundle for PATCH1;
- do not open `/checkout?apple_pay_mount_diagnostic=1`;
- do not create a PaymentIntent or pending Order.
