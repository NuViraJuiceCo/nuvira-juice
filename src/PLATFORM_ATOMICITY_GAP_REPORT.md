# Platform Atomicity Gap Report
**Date:** 2026-06-21  
**Scope:** Base44 entity write primitives — assessed for payment/order idempotency requirements  
**Status:** OPEN BLOCKER — Apple Pay / Express Checkout activation gated

---

## Finding

Base44 entity writes do not provide any of the atomic reservation primitives required for safe payment-grade Order creation:

| Primitive | Base44 Support | Notes |
|---|---|---|
| Caller-supplied deterministic entity ID | ❌ | IDs are platform-assigned UUIDs; callers cannot supply them |
| Unique / compound unique field constraints | ❌ | No schema-level uniqueness enforcement; no atomic rejection on duplicate field values |
| Atomic create-if-absent / upsert with conflict semantics | ❌ | `filter → create` is non-atomic (TOCTOU race window exists) |
| Transaction / CAS / compare-and-swap | ❌ | No transaction API, no compare-and-swap, no optimistic locking |
| Advisory / durable lock | ❌ | No lock primitive available to backend functions |

---

## Race Condition in Current Architecture

`createPaymentIntent` currently performs `filter(stripe_payment_intent_id) → Order.create`.  
This is a **TOCTOU** (time-of-check / time-of-use) race. Duplicate Orders for the same PaymentIntent can be created under:

- Stripe webhook replay arriving concurrently with the PI response handler
- Apple Pay / Express Checkout double-fire before the first call settles
- Network retry delivering a second `createPaymentIntent` invocation before the first Order is committed
- Any concurrent Base44 function invocation (Deno isolates have no shared memory / mutex)

Stripe-level idempotency key (`nv-pi-{checkout_idempotency_key}`) prevents duplicate PaymentIntents but does **not** prevent duplicate Base44 Order records.

---

## Mitigation Options Evaluated

### Option A — Webhook-only Order creation
- Remove `Order.create` from `createPaymentIntent`; `stripeWebhook` becomes the sole Order writer, gated on `payment_intent.succeeded` + `stripe_event_id` deduplication
- **Still not atomic**: two concurrent `payment_intent.succeeded` deliveries for the same event_id can both pass the `filter → create` guard (low probability, not zero)
- Requires: explicit risk acceptance, E2E tests for duplicate-event scenario, reconciliation/rollback plan
- **Status: Not yet implemented — pending explicit approval**

### Option B — CheckoutSession as soft reservation token
- `createPaymentIntent` writes `CheckoutSession`; webhook checks `status = completed` before creating Order, then marks completed
- Still non-atomic (two-phase write), but reduces collision window
- Does not close the race; only narrows it

### Option C — Platform unique index (preferred)
- Base44 exposes a unique index on a caller-specified field (e.g. `stripe_payment_intent_id` on `Order`)
- Atomic rejection at the database layer; closes the race entirely
- **This is the minimum platform primitive required for safe Apple Pay activation**

---

## Platform Feature Request

**Request to Base44 platform team:**  
Expose a **unique field constraint** (or compound unique constraint) on entity schemas that produces an atomic duplicate-rejection error on `create`. This is a standard database capability (unique index) and is the minimum primitive needed for payment-grade order idempotency on this platform.

Acceptable forms:
- Schema-level `"unique": true` on a field definition → atomic rejection with a distinct error code on create
- `bulkCreate` with `on_conflict: "ignore"` / `"error"` semantics
- `createOrGet(filter, data)` upsert primitive returning the existing record on conflict

---

## Activation Gate

**Apple Pay / Express Checkout activation is blocked** until one of the following is true:

1. Base44 provides a unique constraint or equivalent atomic primitive (Option C), OR
2. Option A (webhook-only) is explicitly risk-accepted with documented tests and a rollback plan, and NuVira accepts the residual duplicate-order risk

---

## Current Idempotency State (as of 2026-06-21)

| Layer | Mechanism | Atomic? |
|---|---|---|
| Stripe PaymentIntent | `idempotencyKey: nv-pi-{checkout_idempotency_key}` | ✅ Yes (Stripe-side) |
| Base44 CheckoutSession | Written by `createPaymentIntent` for webhook recovery | ❌ No unique constraint |
| Base44 Order (pending) | `filter(stripe_payment_intent_id) → create` | ❌ TOCTOU race |
| Base44 Order (final) | Written by `stripeWebhook` on `payment_intent.succeeded` | ❌ TOCTOU race |