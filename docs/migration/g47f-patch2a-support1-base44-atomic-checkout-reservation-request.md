# G47F-PATCH2A-SUPPORT1: Base44 atomic checkout reservation capability request

## 1. Purpose

NuVira needs written Base44 platform confirmation of a genuinely atomic reservation primitive before continuing the deferred Apple Pay / Express Checkout backend patch.

Support subject:

```text
NuVira Juice — atomic checkout reservation capability required for Stripe Apple Pay idempotency
```

Current carry-forward classification:

```text
apple_pay_atomic_checkout_reservation_pending_base44_platform_confirmation
```

Related internal context:

- G47F-CONFIG3 confirmed Stripe domain and mode configuration is clean.
- G47F-PATCH1 confirmed Apple Pay renders in NuVira through the side-effect-free diagnostic mount.
- G47F-PATCH2A was blocked because the deferred PaymentIntent backend needs application-level atomic checkout reservation.
- G47F-PATCH2A-BLOCK1 concluded that the current repository source does not prove caller-supplied deterministic ids, atomic duplicate-id rejection, unique constraints/indexes, create-if-absent, upsert conflict semantics, transactions, compare-and-set, durable locks, or Deno KV.
- PR #545 remains blocked, draft, and unmerged until this capability is resolved.

This request is not asking Base44 to run a live NuVira payment or create live NuVira Orders.

## 2. Why Stripe idempotency is not enough

Stripe idempotency can protect Stripe PaymentIntent creation. NuVira still needs a separate application reservation that guarantees all of the following under concurrent requests:

- at most one checkout attempt for one authenticated customer request id;
- at most one Customer App Order for that checkout attempt;
- at most one Stripe PaymentIntent linked to that checkout attempt;
- safe retry after browser/network timeout;
- safe two-tab or remount behavior;
- safe webhook replay and concurrent webhook delivery;
- safe manual review for partial Order / PaymentIntent failures.

A pattern of:

```text
filter -> if missing -> create
```

is not sufficient for payment/order idempotency because two backend function invocations can both observe no row and both create rows.

## 3. Current source evidence and blocker

BLOCK1 source audit found:

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

Webhook risk:

- The existing Stripe webhook finds Orders by `stripe_payment_intent_id`.
- If a pre-created Order exists, the webhook can finalize it with idempotency guards.
- If no pre-created Order exists, the safety-net path creates an Order after a filter.
- Concurrent duplicate webhook delivery can race through that no-order branch unless the platform enforces atomic uniqueness.

## 4. Support questions: caller-supplied record ids

Please confirm:

1. Can a Base44 entity record be created with a caller-supplied deterministic `id`?
2. What SDK/API syntax is supported for caller-supplied ids?
3. Is the supplied id preserved exactly, or can the platform replace it?
4. Are two concurrent creates with the same supplied id guaranteed to result in exactly one stored record?
5. What HTTP status, SDK error, or error code does the losing request receive?
6. Is duplicate-id rejection atomic across concurrent backend-function invocations?
7. After duplicate-id rejection, can the losing invocation immediately read the winning record by exact id?
8. Does this behavior apply to service-role writes from Base44 backend functions?

Minimum acceptable deterministic-id answer:

```text
caller_supplied_record_id_supported=true
duplicate_record_id_rejected_atomically=true
service_role_duplicate_id_behavior_confirmed=true
```

## 5. Support questions: unique constraints and indexes

Please confirm:

1. Can an entity field be declared unique?
2. Can a compound unique constraint be created?
3. What exact schema JSONC syntax is supported?
4. Are unique constraints enforced atomically under concurrent creates?
5. Do service-role writes obey the same constraint?
6. Can Base44 support add or approve a compound unique constraint for:

```text
authenticated_user_id + checkout_request_id
```

7. Is there a migration/backfill or deploy step required before that constraint becomes active?
8. What duplicate-conflict error/status is returned?

Minimum acceptable unique-constraint answer:

```text
unique_field_or_compound_constraint_supported=true
constraint_enforced_atomically=true
service_role_constraint_behavior_confirmed=true
```

## 6. Support questions: atomic create-if-absent or upsert

Please confirm:

1. Is there a create-if-absent primitive for Base44 entities?
2. Is there an atomic upsert with a conflict target?
3. Can the upsert target be a compound key such as `authenticated_user_id + checkout_request_id`?
4. Can the response indicate whether the call inserted a new row or reused an existing row?
5. Can the response safely return the existing row on conflict?
6. Does Base44 provide compare-and-set, expected-version updates, or equivalent conditional updates?
7. Are these semantics atomic across concurrent backend-function invocations?

Minimum acceptable create-if-absent/upsert answer:

```text
create_if_absent_or_upsert_supported=true
conflict_semantics_atomic=true
inserted_vs_reused_response_supported=true
```

## 7. Support questions: transactions and locking

Please confirm:

1. Are transactions available across entity operations inside Base44 backend functions?
2. If yes, are they serializable enough to protect checkout reservation plus Order / PaymentIntent linkage?
3. Is a durable per-key lock available?
4. Is Deno KV available in deployed Base44 backend functions?
5. If Deno KV is available:
   - is it durable across deployments and instances?
   - does it support atomic transactions?
   - is it approved for payment/order idempotency?
   - what operational limits apply?

Minimum acceptable transactional reservation answer:

```text
durable_transactional_reservation_supported=true
payment_order_idempotency_use_approved=true
```

## 8. Support questions: concurrency and consistency

Please confirm:

1. Can two backend function invocations for the same customer run concurrently?
2. What consistency model applies to entity creates and exact-id reads?
3. Is a newly created record immediately visible to concurrent invocations?
4. Are entity list/filter reads strongly consistent with recent creates?
5. Is `filter -> if missing -> create` ever recommended for payment/order idempotency?
6. If not recommended, what officially supported primitive should replace it?

NuVira will treat an answer recommending only filter-then-create as insufficient for production checkout payment/order idempotency.

## 9. Requested Base44 recommended pattern

Please provide the officially supported Base44 pattern and example source code for this workflow:

1. Authenticated customer starts checkout with a stable `checkout_request_id`.
2. Backend atomically reserves the attempt for that customer/request id.
3. A retry with the same request id and same cart fingerprint returns the existing reservation.
4. A retry with the same request id and a different cart fingerprint is rejected.
5. A request from a different authenticated customer cannot reuse or observe another customer's reservation.
6. Exactly one Customer App Order can be attached to the reservation.
7. Exactly one Stripe PaymentIntent can be attached to the reservation.
8. A lost frontend response can safely recover by rereading the existing reservation.
9. A two-tab duplicate request creates or reuses exactly one reservation.
10. Partial Order-created / PaymentIntent-missing states are distinguishable and safe for manual review or cleanup.
11. Partial PaymentIntent-created / Order-missing states are distinguishable and safe for manual review or cleanup.

## 10. Webhook atomicity questions

Please confirm the recommended pattern for Stripe webhook finalization:

1. How should a webhook atomically ensure one Customer App Order per PaymentIntent?
2. Can the PaymentIntent id or a deterministic internal hash be used as a Base44 entity record id?
3. Can webhook replay and concurrent delivery be resolved through atomic duplicate-id rejection?
4. Is there a recommended unique payment-attempt linkage field?
5. Can Base44 guarantee one successful finalization under concurrent duplicate webhook deliveries?
6. Should webhook finalization attach to the same checkout reservation row or to a separate atomic webhook-event row?
7. If a webhook event arrives before the frontend receives the PaymentIntent response, what recovery pattern should be used?

Do not include real PaymentIntent ids, customer ids, Stripe keys, webhook secrets, card data, or customer/payment details in any support examples.

## 11. Optional non-production proof request

If available, please provide one of:

- a sandbox/test app;
- a documented concurrency-test procedure;
- a support-assisted proof;
- example test code using Base44's supported primitive.

Required proof shape:

```text
attempts=2
reservation_key=same_deterministic_key
stored_records=1
successful_insertions=1
duplicate_conflicts=1
```

NuVira will not run this proof in the live production project without separate approval.

## 12. Sufficient answer criteria

A Base44 response is sufficient only if it confirms at least one of these paths.

### A. Deterministic record id

```text
caller_supplied_record_id_supported=true
duplicate_record_id_rejected_atomically=true
```

### B. Unique application reservation

```text
unique_field_or_compound_constraint_supported=true
constraint_enforced_atomically=true
```

### C. Transactional create-if-absent

```text
create_if_absent_or_upsert_supported=true
conflict_semantics_atomic=true
```

### D. Durable transactional lock/store

```text
durable_transactional_reservation_supported=true
```

A recommendation to perform filter-then-create is not sufficient.

## 13. Unsafe alternatives NuVira will reject

NuVira will not use these approaches for production payment/order idempotency:

- filter-then-create as an atomic reservation;
- customer email, name, or phone as reservation identity;
- amount, date, cart contents, or delivery date alone as reservation identity;
- Stripe idempotency as a substitute for Customer App Order idempotency;
- deleting duplicate Orders after creation as the primary safety mechanism;
- best-effort cleanup as the primary duplicate-prevention mechanism;
- an unverified external lock provider;
- a broad schema push to add uniqueness without Base44 platform confirmation;
- a webhook fallback path that can create multiple Orders for one PaymentIntent;
- relying on newest timestamp selection after duplicates exist.

## 14. Decision classifications

Use these classifications after the Base44 response.

Base44 confirms deterministic-id atomicity:

```text
apple_pay_atomic_checkout_reservation_ready_deterministic_id
```

Base44 confirms unique constraint/upsert:

```text
apple_pay_atomic_checkout_reservation_ready_unique_constraint
```

Base44 confirms transactional reservation store:

```text
apple_pay_atomic_checkout_reservation_ready_transactional_store
```

Support says no atomic primitive exists:

```text
apple_pay_deferred_intent_backend_blocked_by_platform_atomicity
```

Support response remains pending:

```text
apple_pay_atomic_checkout_reservation_pending_base44_platform_confirmation
```

Support answer is ambiguous or only recommends filter-then-create:

```text
apple_pay_atomic_checkout_reservation_unresolved
```

## 15. PR #545 decision path

If a supported atomic primitive is confirmed:

1. Update PR #545 to use only that documented primitive.
2. Add concurrency tests matching the support contract.
3. Keep deferred Apple Pay disabled/default-off.
4. Request another full audit before merge.
5. Do not publish until the new audit and approval pass.

If no atomic primitive is available:

1. Close PR #545 as blocked.
2. Do not proceed to PATCH2B.
3. Retain the side-effect-free Apple Pay diagnostic only.
4. Keep the existing production card checkout architecture.

## 16. Submission tracking template

Fill this after submitting through an authenticated Base44 support channel.

```text
support_submission_date=
support_channel=
support_ticket_or_reference=safe_to_record_or_unavailable
requested_capability=atomic_checkout_attempt_reservation
response_status=pending
final_classification=apple_pay_atomic_checkout_reservation_pending_base44_platform_confirmation
```

Do not paste credentials, customer information, payment information, live provider ids, raw records, or webhook secrets into the support request or this tracking section.

## 17. No-write / no-payment confirmation

SUPPORT1 is docs-only.

Confirmed scope:

- no runtime changes;
- no schema changes;
- no Base44 publish;
- no Builder publish;
- no PaymentIntent;
- no Checkout Session;
- no Customer App Order;
- no Stripe call;
- no Shopify call;
- no provider call;
- no Hub call;
- no notification;
- no sync/repair/replay;
- no inventory deduction;
- no PurchaseOrder creation;
- no PR #545 merge or publish.
