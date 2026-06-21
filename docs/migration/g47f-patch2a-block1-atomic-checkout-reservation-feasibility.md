# G47F-PATCH2A-BLOCK1: atomic checkout reservation feasibility audit

## 1. PR #545 blocker summary

G47F-PATCH2A reached the correct hard stop before merge or publish. PR #545 remains open, draft, and blocked because the proposed deferred PaymentIntent backend cannot safely replace the current checkout ordering until NuVira has a source-proven atomic checkout-attempt reservation primitive.

Current PR #545 state for this audit:

- PR: <https://github.com/NuViraJuiceCo/nuvira-juice/pull/545>
- Changed runtime function in PR #545: `base44/functions/createPaymentIntent/entry.ts`
- Required decision before merge: prove an atomic reservation primitive that can prevent duplicate PaymentIntent and duplicate pending Order creation under concurrent browser tabs, retries, remounts, and webhook races.

Hard decisions from BLOCK1:

- Keep PR #545 draft/blocked.
- Do not merge PR #545.
- Do not publish `createPaymentIntent`.
- Do not begin G47F-PATCH2B.
- Do not run a live NuVira checkout mount or payment attempt from this phase.

## 2. Scope and method

This phase is docs/source audit plus synthetic fixture concurrency proof only.

Allowed:

- static source inspection of Base44 SDK/entity APIs, current schemas, `createPaymentIntent`, and `stripeWebhook`;
- fixture-only concurrency simulations;
- documentation of support questions and platform gaps.

Not allowed:

- runtime code changes;
- schema/entity changes;
- Base44 publish;
- live records;
- Stripe, Shopify, Hub, provider, notification, sync, replay, repair, inventory, or PurchaseOrder actions.

## 3. Base44 capability audit

Source evidence inspected:

- `node_modules/.deno/@base44+sdk@0.8.32/node_modules/@base44/sdk/dist/modules/entities.js`
- `node_modules/.deno/@base44+sdk@0.8.32/node_modules/@base44/sdk/dist/modules/entities.types.d.ts`
- `base44/entities/*.jsonc`
- existing command docs that explicitly treat Base44 entity writes as non-transactional in prior migration commands.

Capability result:

```text
caller_supplied_record_id_supported=not_proven
duplicate_record_id_rejected_atomically=not_proven
unique_field_constraint_supported=false
unique_index_supported=false
create_if_absent_supported=false
upsert_conflict_semantics_supported=false
conditional_update_supported=false
transactions_supported=false
durable_lock_supported=false
deno_kv_supported=false
atomic_reservation_primitive_available=false
```

Key findings:

1. The SDK entity `create(data)` path is a plain `POST` to the entity collection. The type documentation says the server returns a created record with an `id`; it does not document caller-supplied record id semantics or atomic duplicate-id rejection.
2. Entity handlers expose `list`, `filter`, `get`, `create`, `update`, `delete`, `deleteMany`, `bulkCreate`, `updateMany`, `bulkUpdate`, `importEntities`, and `subscribe`. They do not expose create-if-absent, upsert-with-conflict, compare-and-swap, transaction, advisory lock, or durable lock primitives.
3. `updateMany` supports query-filtered updates, but it is an update primitive, not a create-if-absent primitive. It cannot reserve a not-yet-existing checkout attempt without a separately safe creation step.
4. Current entity schemas do not contain a `unique`, `index`, `indexes`, or `constraints` declaration.
5. Existing migration docs record Base44 entity writes as non-transactional in multi-entity command contexts. That is not proof that Base44 can never provide atomic single-row creation, but it means this repository has not source-proven a usable atomic reservation primitive.
6. No `Deno.openKv` / Deno KV usage was found in current functions or migration harnesses.

## 4. Deterministic-id result

A deterministic checkout-attempt id would be an acceptable architecture only if the platform confirms all of these properties:

- caller-supplied entity ids are supported for the target entity;
- duplicate id creation is rejected atomically by the platform;
- duplicate-id rejection is distinguishable from transient errors;
- the rejected caller can safely re-read the existing attempt by id;
- the same request id with a different cart/customer fingerprint is rejected;
- the same request id from a different authenticated customer is rejected;
- no PaymentIntent or pending Order is created before the reservation succeeds.

Current source does not prove those properties. Therefore deterministic id is not accepted yet.

Result:

```text
deterministic_record_id_strategy=not_source_proven
```

## 5. Unique-field/index result

A `CheckoutAttempt` entity with a unique key such as `customer_id + checkout_request_id` would be an acceptable architecture only if Base44 schema tooling supports a real unique constraint or unique index and duplicate inserts fail atomically.

Current source evidence:

- Existing entity JSONC files do not declare unique fields or unique indexes.
- `CommandLog.idempotency_key`, `OrderSyncLog.idempotency_key`, and similar fields are plain strings.
- Existing idempotency patterns are mostly `filter` then `create` or `filter` then update. Those are useful for duplicate retries after the fact, but they are not a concurrency-safe reservation primitive.

Result:

```text
unique_checkout_attempt_strategy=requires_platform_schema_support
```

## 6. Transaction / CAS / lock result

The audit found no source-proven transaction, compare-and-swap, create-if-absent, upsert-conflict, durable lock, or Deno KV primitive available to Base44 functions in this repository.

Prior migration docs explicitly treat Base44 entity writes as non-transactional for multi-entity lifecycle commands. This supports a conservative checkout posture: do not build payment/order creation around an assumed transaction primitive unless Base44 confirms the exact behavior.

Result:

```text
transactional_checkout_reservation_strategy=not_available_from_current_source
```

## 7. Webhook concurrency result

Current `stripeWebhook` behavior for `payment_intent.succeeded`:

1. It filters Customer App `Order` rows by `stripe_payment_intent_id`.
2. If a pending pre-created Order exists, it finalizes the first match, with terminal-state and already-captured guards.
3. If no pre-created Order exists, it uses a safety-net path to create a new `Order` from PaymentIntent metadata, then syncs to Hub and sends notifications.

The existing pending-order path has useful idempotency once the Order exists. The no-order safety-net path is still filter-then-create. Under concurrent duplicate webhook delivery where both handlers filter before either creates, the fixture shows two safety-net Orders can be created for one PaymentIntent unless the platform provides an atomic uniqueness primitive on `stripe_payment_intent_id` or a separate checkout attempt reservation.

Result:

```text
webhook_order_finalization=webhook_order_finalization_duplicate_risk
```

This is especially important for the proposed PaymentIntent-first / deferred Order strategy: if the backend creates a PaymentIntent before atomically reserving an Order/attempt, webhook finalization can race into safety-net creation.

## 8. Architecture comparison

| Option | Accept? | Reason |
| --- | --- | --- |
| A. Deterministic id on existing entity | Not accepted yet | Caller-supplied ids and atomic duplicate-id rejection are not source-proven. |
| B. New `CheckoutAttempt` entity with unique request key | Not accepted yet | Requires schema/tooling support for real unique constraint or index. |
| C. PaymentIntent-first without atomic Order reservation | Rejected | Webhook no-order safety net remains filter-then-create and can race into duplicate Orders. |
| D. Order-first deterministic identity | Not accepted yet | Still requires caller-supplied id or unique Order key semantics. |
| E. External transactional store | Documented only | Would need separate platform/product decision and explicit approval. |

## 9. Fixture concurrency evidence

Fixture harness:

- `scripts/migration/run-g47f-patch2a-block1-atomic-reservation-tests.mjs`

Covered cases:

1. two simultaneous identical checkout requests;
2. two simultaneous different carts with same request id;
3. same customer/request id after timeout;
4. two browser tabs;
5. PaymentIntent request succeeds but response is lost;
6. reservation succeeds but Order creation fails;
7. Order creation succeeds but PaymentIntent creation fails;
8. duplicate webhook events concurrently;
9. different webhook events for the same PaymentIntent concurrently;
10. deterministic record id exactly-one-create fixture;
11. non-atomic filter-then-create failure fixture;
12. unique constraint exactly-one-create fixture;
13. unsupported fake uniqueness rejection;
14. cross-customer request-id collision rejection;
15. same request/fingerprint returning the prior attempt;
16. same request/different fingerprint conflict;
17. one attempt to at most one Order;
18. one attempt to at most one PaymentIntent;
19. one PaymentIntent to at most one Order;
20. no PII in reservation keys;
21. no live records;
22. no providers;
23. no notifications;
24. no Hub mutation.

Fixture conclusion:

- Filter-then-create is unsafe under concurrent actors.
- Atomic deterministic id or true unique constraint would solve the reservation race in principle.
- Current repository source does not prove that either primitive is available in Base44 today.

## 10. Schema-tooling dependency

A production-safe PATCH2A backend requires one of the following source-proven capabilities before merge:

1. caller-supplied deterministic entity id with atomic duplicate rejection; or
2. a `CheckoutAttempt` entity with a real unique key/index on the checkout request identity; or
3. a supported create-if-absent / upsert conflict primitive; or
4. a supported transaction/CAS/lock primitive strong enough to serialize checkout attempt creation.

Without one of those, PATCH2A cannot safely guarantee:

- at most one pending Customer App Order per checkout attempt;
- at most one PaymentIntent per checkout attempt;
- at most one Customer App Order per PaymentIntent;
- safe retry behavior after lost responses, remounts, or duplicate tabs;
- safe webhook finalization when the pending Order is missing.

## 11. Base44 platform/support questions

Before reviving PR #545, ask Base44/platform support for explicit answers to these exact questions:

1. Can a Base44 entity `create(data)` accept a caller-supplied `id`?
2. If yes, is duplicate `id` creation rejected atomically under concurrent requests?
3. What error code/status identifies duplicate-id rejection?
4. Can a function reliably `get(id)` immediately after duplicate-id rejection to recover the existing row?
5. Does entity schema JSONC support `unique` fields or unique indexes?
6. If yes, what exact JSONC syntax is supported?
7. Are unique constraints enforced atomically on concurrent creates?
8. Does Base44 support create-if-absent, upsert with conflict semantics, conditional update, compare-and-swap, transactions, or durable locks inside functions?
9. Does the Deno runtime support `Deno.openKv` or any equivalent durable atomic store for deployed functions?
10. Are there documented maximum retry or consistency windows after entity create that affect immediate duplicate recovery?

## 12. Selected classification

Selected classification:

```text
apple_pay_atomic_checkout_reservation_pending_base44_platform_confirmation
```

Interpretation:

- The current source does not prove a usable atomic reservation primitive.
- The repository has evidence that normal entity writes are treated as non-transactional in prior command designs.
- Filter-then-create idempotency is not sufficient for checkout/payment initialization.
- PR #545 must remain blocked until Base44 confirms deterministic id / unique key / create-if-absent semantics or a new schema/platform primitive is approved.

If Base44 confirms no such primitive exists, the practical classification becomes:

```text
apple_pay_deferred_intent_backend_blocked_by_platform_atomicity
```

## 13. Recommended change to PR #545

Do not merge PR #545 as currently drafted.

Recommended path:

1. Keep PR #545 draft/blocked.
2. Add a blocker note that PATCH2A requires source-proven atomic reservation before merge.
3. If Base44 confirms deterministic id or unique constraint support, update PR #545 to use that exact primitive and add live-source-backed concurrency tests.
4. If Base44 requires schema work, create a separate schema/support phase for `CheckoutAttempt` uniqueness before touching checkout runtime.
5. If no primitive exists, close or supersede PR #545 and do not proceed to PATCH2B.

## 14. Hard stops

- No `createPaymentIntent` publish.
- No checkout mount execution from this phase.
- No PaymentIntent creation.
- No pending Customer App Order creation.
- No Apple Pay sheet opening.
- No payment submission.
- No webhook or live Stripe event testing.
- No Hub sync.
- No Shopify push.
- No notification.
- No loyalty mutation.
- No inventory deduction.
- No PurchaseOrder creation.
- No schema/entity mutation without a separate approved schema phase.
- No reliance on filter-then-create idempotency for checkout payment/order initialization.

## 15. No-write / no-payment confirmation

BLOCK1 is docs/static/fixture-only.

Confirmed by scope:

- no live records created;
- no Customer App `Order` mutation;
- no `ShopifyOrder` mutation;
- no `FulfillmentTask` mutation;
- no `CheckoutSession` mutation;
- no Stripe call;
- no PaymentIntent creation/cancellation/capture;
- no Checkout Session creation;
- no payment submission;
- no Hub mutation;
- no provider call;
- no notification;
- no sync/repair/replay;
- no Base44 publish;
- no G43B/G43C or Apple Pay diagnostic gate changes.
