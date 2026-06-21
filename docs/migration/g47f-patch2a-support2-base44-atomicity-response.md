# G47F-PATCH2A-SUPPORT2: Base44 atomicity response

## 1. Executive summary

Base44 confirmed that the current Base44 entity platform does not provide the atomic application-level reservation primitive required for production Apple Pay payment activation under the G47F-PATCH2 deferred-intent design.

Final SUPPORT2 classification:

```text
apple_pay_deferred_intent_backend_blocked_by_platform_atomicity
```

Operational state remains:

```text
production_apple_pay_activation_allowed=false
patch2b_allowed=false
pr_545_merge_allowed=false
```

PR #545 remains draft, open, blocked, unmerged, and unpublished. SUPPORT2 does not revise, merge, or publish PR #545.

## 2. Source report search result

Search target:

```text
PLATFORM_ATOMICITY_GAP_REPORT.md
```

Search result:

```text
source_report_found=false
source_report_location=unavailable
source_report_committed_to_git=false
source_report_contains_sensitive_data=unavailable_no_file_found
```

A standalone `PLATFORM_ATOMICITY_GAP_REPORT.md` file was not found in the available local project/worktree paths during SUPPORT2. This migration document therefore uses the retained Base44 platform-response evidence from the current thread and normalizes it into Git without inventing ticket references, direct platform guarantees beyond the response, or private support metadata.

## 3. Base44 capability summary

Base44 response summary:

| Capability | Base44 response | SUPPORT2 interpretation |
| --- | --- | --- |
| Caller-supplied deterministic entity IDs | Not supported; IDs are platform-assigned | Cannot reserve an attempt by deterministic record id. |
| Atomic duplicate-id rejection | Not supported for caller-supplied IDs | No duplicate-id conflict primitive is available. |
| Unique field constraints | Not supported | Cannot enforce one row per checkout key through schema uniqueness. |
| Compound unique constraints | Not supported | Cannot enforce `authenticated_user_id + checkout_request_id`. |
| Atomic create-if-absent | Not supported | Application code cannot atomically reserve if missing. |
| Atomic upsert conflict semantics | Not supported | No insert-or-reuse conflict target exists. |
| Transactions | Not supported | Cannot serialize reservation + Order/PaymentIntent linkage through entity transactions. |
| Compare-and-set | Not supported | Cannot safely conditionally update based on expected version. |
| Durable per-key lock | Not supported | No platform lock primitive is available for checkout idempotency. |
| Transactional reservation store | Not supported | No equivalent durable atomic store was confirmed. |

Required finding record:

```text
caller_supplied_deterministic_entity_ids=false_or_not_supported
atomic_duplicate_id_rejection=false_or_not_supported
unique_field_constraints=false_or_not_supported
compound_unique_constraints=false_or_not_supported
atomic_create_if_absent=false_or_not_supported
atomic_upsert_conflict_semantics=false_or_not_supported
transactions=false_or_not_supported
compare_and_set=false_or_not_supported
durable_per_key_lock=false_or_not_supported
transactional_reservation_store=false_or_not_supported
```

## 4. NuVira impact analysis

### 4.1 Customer App Order creation remains TOCTOU-prone

Any checkout or webhook path implemented as:

```text
filter for existing attempt
→ if none found
→ create Order
```

remains vulnerable to a time-of-check/time-of-use race. Two concurrent backend invocations can both observe no existing row and both create Customer App Orders.

This applies to:

- frontend retry after network timeout;
- browser double-submit or two-tab checkout;
- Express Checkout confirmation double-fire;
- component remount before the first response settles;
- webhook replay or concurrent webhook delivery;
- any recovery path that creates an Order after a non-atomic query.

### 4.2 Stripe idempotency is necessary but insufficient

Stripe idempotency can protect Stripe POST requests such as PaymentIntent creation. It does not guarantee one NuVira Customer App Order.

A duplicated NuVira Order can still occur if both application invocations reuse or receive the same PaymentIntent and then both run non-atomic Order creation logic.

### 4.3 Webhook-only Order creation is not atomic

Base44 suggested webhook-only Order creation as a safer mitigation than pre-creating an Order during `createPaymentIntent`. That approach reduces some frontend retry surface area, but it does not solve the core atomicity problem if webhook processing still uses filter-then-create.

Webhook-only creation remains a best-effort mitigation, not an accepted production activation fix.

### 4.4 CheckoutSession or PaymentIntent soft locks are not atomic

Using `CheckoutSession` status, PaymentIntent metadata, or a soft reservation token can reduce the collision window. It does not provide a platform-enforced at-most-one guarantee unless the soft-lock row itself is atomically reserved.

### 4.5 Post-hoc duplicate cleanup is not an idempotency control

Detecting and deleting duplicate Orders after creation is not acceptable as the primary payment-idempotency strategy. It may be a repair process, but it does not prevent customer-facing, webhook, Hub, notification, or fulfillment side effects from starting from duplicate state.

### 4.6 PR #545 fails closed correctly

PR #545 must remain blocked because the required platform atomic primitive is unavailable. The PR cannot be treated as production-ready through Stripe idempotency, webhook-only Order creation, CheckoutSession soft locks, or best-effort duplicate cleanup.

## 5. Rejected non-atomic mitigations

SUPPORT2 explicitly rejects treating these as sufficient for production Apple Pay activation:

- filter-then-create as atomic idempotency;
- Stripe idempotency as Customer App Order idempotency;
- frontend `useRef` idempotency key alone;
- customer email, name, phone, amount, cart, date, or delivery window as reservation identity;
- webhook-only Order creation without a platform-enforced one-Order-per-PaymentIntent primitive;
- CheckoutSession status as a soft lock without atomic reservation;
- PaymentIntent metadata as an application lock;
- deleting duplicate Orders after creation;
- relying on delayed Stripe retries as a concurrency guarantee;
- selecting the newest or first Order after duplicates exist;
- broad schema or runtime changes without a confirmed platform primitive.

## 6. Platform feature request

Requested platform feature:

```text
requested_platform_feature=unique index, atomic duplicate-key reservation, or equivalent transactionally enforced checkout-attempt primitive
```

The required future primitive must be enforced by Base44 or an approved durable transactional store, not by application-level filter-then-create code.

Required guarantee shape:

```text
concurrent_attempts=2
stored_checkout_reservations=1
customer_app_orders_created_at_most=1
stripe_payment_intents_created_at_most=1
```

Acceptable future solutions include one of:

1. caller-supplied deterministic entity id with atomic duplicate rejection;
2. platform-enforced unique or compound unique constraint;
3. atomic create-if-absent or upsert with conflict semantics;
4. transaction, compare-and-set, durable per-key lock, or transactional storage approved for payment/order idempotency.

## 7. Activation gate

Current activation gate:

```text
production_apple_pay_activation_allowed=false
patch2b_allowed=false
pr_545_merge_allowed=false
```

Activation may be reconsidered only when either:

A. Base44 provides a documented, platform-enforced atomic primitive that satisfies the guarantee shape in section 6; or

B. NuVira ownership explicitly accepts the duplicate-order/payment-attempt fallback risk through a separate written risk-acceptance phase.

SUPPORT2 does not create risk acceptance. SUPPORT2 does not approve webhook-only creation, CheckoutSession soft locks, or any non-atomic fallback.

## 8. Current safe behavior

The following may remain live under their current controls:

- admin-only side-effect-free Apple Pay mount diagnostic;
- read-only Stripe public-config endpoint;
- existing production card checkout architecture;
- existing Hub writes and fallback;
- existing Stripe webhook behavior.

The following remain blocked:

- production Apple Pay payment confirmation;
- deferred Apple Pay backend activation;
- G47F-PATCH2B customer UI activation;
- PR #545 merge or publish;
- Hub suppression;
- payment-flow refactor relying on best-effort idempotency;
- webhook-only or CheckoutSession soft-lock mitigation without separate risk acceptance.

## 9. PR #545 state

PR #545 remains:

```text
pr_545_state=open
pr_545_draft=true
pr_545_blocked=true
pr_545_unmerged=true
pr_545_unpublished=true
```

Do not revise PR #545 based on webhook-only or soft-lock alternatives. Do not publish `createPaymentIntent`. Do not begin PATCH2B.

## 10. No-write / no-payment confirmation

SUPPORT2 is documentation-only source capture.

Confirmed scope:

- no runtime change;
- no schema change;
- no Base44 publish;
- no Builder publish;
- no PaymentIntent;
- no Checkout Session;
- no Customer App Order;
- no ShopifyOrder;
- no FulfillmentTask;
- no Stripe call;
- no Hub call;
- no provider call;
- no notification;
- no loyalty/credit mutation;
- no inventory deduction;
- no PurchaseOrder creation;
- no checkout run;
- no Apple Pay submission;
- no PR #545 merge, publish, or implementation change.
