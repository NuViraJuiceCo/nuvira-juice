# G47F-PATCH1-BLOCK2: frontend Stripe publishable-key source audit

## 1. Executive summary

G47F-PATCH1 remains blocked at the publish/smoke boundary because the side-effect-free Apple Pay diagnostic requires a frontend Stripe publishable key source, and the current repository/local build evidence does not prove one is available to the Web/customer bundle.

Current classification:

```text
apple_pay_diagnostic_frontend_key_configuration_required
```

This is a configuration-only blocker for PR #539. The PATCH1 diagnostic code remains designed to avoid checkout side effects, but it must not be merged, published, or smoked until the Builder Web/customer environment is confirmed to provide a live-mode frontend publishable key.

## 2. PR #539 hard-stop result

PR #539:

- `https://github.com/NuViraJuiceCo/nuvira-juice/pull/539`
- branch: `codex/g47f-patch1-side-effect-free-apple-pay-mount`
- status at this audit: open and mergeable
- hard-stop classification carried into BLOCK2:

```text
apple_pay_diagnostic_publishable_key_source_missing
```

Hard-stop reason:

- PATCH1 supports frontend-only Stripe Elements initialization without a `clientSecret`.
- PATCH1 intentionally does not call `createPaymentIntent` as a fallback.
- No source/local environment evidence proves that either supported frontend key source is available in the Web/customer production bundle.

## 3. Supported diagnostic key sources

The PATCH1 diagnostic supports only frontend-safe publishable key sources:

1. `window.__NUVIRA_STRIPE_PUBLISHABLE_KEY__`
2. `import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY`

The audit found no committed key value and no local `.env*` file. This is correct from a secret-handling perspective; the publishable key value must not be committed or printed.

## 4. Builder Web environment finding

BLOCK2 did not change Builder configuration and did not publish Builder/Web.

Repository evidence:

```text
frontend_key_variable_present=false
frontend_key_source=NONE
frontend_key_mode=unknown
builder_environment=unknown
builder_key_injection_supported=unknown
```

Local repo search found no existing Web/customer source for:

- `VITE_STRIPE_PUBLISHABLE_KEY`
- `NUVIRA_STRIPE_PUBLISHABLE_KEY`
- `window.__NUVIRA_STRIPE_PUBLISHABLE_KEY__`

The repository does use Vite-style frontend environment variables elsewhere, including:

- `VITE_WEB_PUSH_VAPID_PUBLIC_KEY`
- `VITE_BASE44_APP_ID`
- `VITE_BASE44_FUNCTIONS_VERSION`
- `VITE_BASE44_APP_BASE_URL`
- `VITE_ENABLE_AUTH_PROVIDER_BUTTONS`

That supports a narrow configuration path using `VITE_STRIPE_PUBLISHABLE_KEY`, but the actual Builder production Web environment still must be inspected/configured through authorized Builder access before PATCH1 can proceed.

## 5. Runtime-global finding

No existing runtime global injection source was found for:

```text
window.__NUVIRA_STRIPE_PUBLISHABLE_KEY__
```

BLOCK2 does not introduce a new runtime global mechanism. If Builder cannot supply Vite frontend variables, a separate runtime-global configuration plan would be required before PR #539 can be safely published and smoked.

Runtime-global status:

```text
builder_runtime_global_present=false
runtime_global_configuration_required=false
runtime_global_patch_added=false
```

## 6. Stripe key-mode finding

Existing backend payment-intent functions read `STRIPE_PUBLISHABLE_KEY` from server/runtime environment and return it alongside a created PaymentIntent. That backend path cannot be reused for PATCH1 because it would create checkout side effects.

BLOCK2 did not inspect or modify Stripe Dashboard settings. The live frontend publishable key value remains intentionally omitted.

Current evidence:

```text
stripe_frontend_key_available=unknown
stripe_frontend_key_mode=unknown
```

Required evidence before resuming PATCH1:

```text
stripe_frontend_key_available=true
stripe_frontend_key_mode=live
```

The key value itself must not be recorded in docs, logs, screenshots, commits, or chat.

## 7. Actual key value omitted confirmation

This audit intentionally records only presence and mode. It does not include:

- full publishable key value
- secret key value
- webhook signing secret
- Stripe account identifiers
- client secret
- PaymentIntent id
- Checkout Session id
- auth/session tokens

## 8. Decision classification

Selected classification:

```text
apple_pay_diagnostic_frontend_key_configuration_required
```

Rationale:

- No existing frontend key source is proven in repo/local evidence.
- The PATCH1 diagnostic has a safe frontend-only key contract.
- The repo already uses Vite frontend environment variables, making `VITE_STRIPE_PUBLISHABLE_KEY` the narrowest likely Builder Web configuration path.
- A separate configuration approval is still required because Builder production environment state and Stripe key mode were not changed during BLOCK2.

If authorized Builder inspection later shows a live frontend key already exists and is injected into the customer Web bundle, this can be reclassified as:

```text
apple_pay_diagnostic_frontend_key_source_confirmed
```

If Builder cannot provide Vite frontend variables but can safely populate an existing runtime global, use:

```text
apple_pay_diagnostic_runtime_global_configuration_required
```

If neither path exists, hold PR #539 under:

```text
apple_pay_diagnostic_frontend_key_delivery_path_unavailable
```

## 9. Exact configuration plan if required

Recommended next phase:

```text
G47F-PATCH1-CONFIG1
```

Proposed configuration-only change:

- Add `VITE_STRIPE_PUBLISHABLE_KEY` to the Base44 Builder production Web/customer environment.
- Use the existing live Stripe publishable key.
- Do not commit the value to Git.
- Do not print the value in logs, docs, screenshots, or chat.
- Do not change backend `STRIPE_SECRET_KEY`.
- Do not change backend `STRIPE_PUBLISHABLE_KEY` unless separately audited.
- Do not change webhook settings.
- Do not change Stripe payment-method domains.
- Do not publish functions/entities/schemas.
- Do not use Builder Fix All.
- Confirm the Builder pending scope is Web/customer configuration only.

Required CONFIG1 evidence:

```text
frontend_key_variable_present=true
frontend_key_source=VITE_ENV
frontend_key_mode=live
builder_environment=production
builder_key_injection_supported=true
stripe_frontend_key_available=true
stripe_frontend_key_mode=live
```

After CONFIG1 succeeds, return to PR #539 closeout:

1. Merge PR #539.
2. Verify Builder preview/source contains PATCH1 and the live frontend key source resolves without exposing the key.
3. Publish only the Web/customer UI bundle.
4. Run the side-effect-free iPhone Apple Pay diagnostic smoke.

## 10. Rollback

If `VITE_STRIPE_PUBLISHABLE_KEY` is added in a later approved configuration step and needs rollback:

- remove only the new Web/customer frontend variable;
- do not change backend Stripe secrets;
- do not change webhook settings;
- do not change payment-method domains;
- do not publish unrelated Builder scope;
- keep PR #539 held until a safe frontend key delivery path is restored.

Rollback must not create a PaymentIntent, pending Order, Checkout Session, Hub sync, notification, ShopifyOrder, FulfillmentTask, loyalty mutation, inventory deduction, or PurchaseOrder.

## 11. No-write / no-payment confirmation

BLOCK2 is docs-only and configuration-audit-only.

Confirmed not performed:

- no PR #539 merge
- no Builder/Web publish
- no Base44 publish
- no function/entity/schema publish
- no diagnostic route open
- no PaymentIntent
- no Checkout Session
- no pending Customer App Order
- no `createPaymentIntent` fallback
- no backend key-return endpoint
- no Stripe setting changed
- no Stripe secret key changed
- no webhook changed
- no Hub mutation
- no Shopify call
- no provider call
- no notification
- no loyalty/credit mutation
- no inventory deduction
- no PurchaseOrder creation

## 12. Recommendation

Do not merge or publish PR #539 yet.

Proceed to `G47F-PATCH1-CONFIG1` only after authorized Builder/Stripe access can confirm or configure a live frontend publishable key source for the Web/customer bundle.

The preferred path remains:

```text
VITE_STRIPE_PUBLISHABLE_KEY in Builder production Web/customer environment
```

Then resume PR #539 closeout and side-effect-free iPhone smoke.
