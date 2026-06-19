# G46B-OCC4 — Additive Subscription Occurrence Linkage Schema Patch

## 1. OCC1-OCC3 findings carried forward

G46C customer subscription reads remain blocked.

Carry-forward blockers:

```text
subscription_occurrence_schema_and_materialization_contract_gap
occurrence_schema_linkage_gap
occurrence_native_chain_intentionally_deferred
occurrence_historical_hub_only_by_design
```

Known live-state constraints:

- active native `Subscription` parents: `0`;
- paused native `Subscription` parents: `0`;
- cancelled native `Subscription` parents: `6`;
- historical cancelled subscriptions are not valid migration pilots;
- current subscription creation/sync paths maintain parent and Hub recurrence context but do not broadly materialize `parent -> occurrence -> Customer App Order -> native ShopifyOrder -> FulfillmentTask`;
- Stripe remains billing authority;
- Hub remains recurrence/multi-delivery authority and fallback.

OCC4 is limited to additive schema support. It does not create records, backfill historical records, change customer reads, change runtime functions, publish Base44, call providers, send notifications, or mutate Hub.

## 2. Actual pre-patch schema support

| Entity | Current support before OCC4 | Existing equivalent | Gap |
| --- | --- | --- | --- |
| `Subscription` | Parent rows with `id`, `customer_email`, status, Stripe and Hub sync fields | `id`, `stripe_subscription_id`, Hub sync metadata | No current active pilot; no schema change needed for OCC4 |
| Customer App `Order` | Canonical customer-facing order row with order number, status, totals, line items, delivery and payment fields | no explicit subscription parent/occurrence/cycle fields | Missing durable occurrence linkage on the canonical customer row |
| native `ShopifyOrder` | Operational order mirror with `base44_order_id`, `subscription_parent_id`, `fulfillment_sequence_number`, `source_type`, `order_type`, `fulfillment_mode` | parent/sequence/source fields | Missing immutable occurrence id and cycle key fields |
| `FulfillmentTask` | Operational task with `order_id`, `base44_order_id`, `native_shopify_order_id`, `customer_app_subscription_id`, `fulfillment_number`, dates and source fields | parent/order/task links exist | Missing immutable occurrence id and cycle key fields |
| `CommandLog` | Supports command idempotency through `idempotency_key` | `idempotency_key` | No schema change needed for OCC4 |

## 3. Exact fields added

### Customer App `Order`

| Field | Type | Nullable | Internal-only | Immutable after first population | Expected source | Customer-visible | Historical backfill |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `customer_app_subscription_id` | string | yes | yes | yes | parent `Subscription.id` | false | false |
| `subscription_occurrence_id` | string | yes | yes | yes | future persisted occurrence identity | false | false |
| `subscription_cycle_key` | string | yes | yes | yes | secondary cycle reference | false | false |
| `fulfillment_number` | number | yes | yes | yes | occurrence fulfillment sequence/reference | false | false |
| `source_type` | string | yes | yes | yes after creation | future source classification such as `subscription_occurrence` | false in OCC4 | false |

Reason: Customer App `Order` is the canonical customer-facing row. It must be able to carry future occurrence identity without relying on delivery dates, customer PII, or native mirror creation timestamps.

### native `ShopifyOrder`

| Field | Type | Nullable | Internal-only | Immutable after first population | Expected source | Customer-visible | Historical backfill |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `subscription_occurrence_id` | string | yes | yes | yes | copied from Customer App `Order` | false | false |
| `subscription_cycle_key` | string | yes | yes | yes | copied from Customer App `Order` | false | false |

Reason: `ShopifyOrder` already has `base44_order_id`, `subscription_parent_id`, `fulfillment_sequence_number`, and source classification fields. It only needed explicit immutable occurrence and cycle linkage.

### `FulfillmentTask`

| Field | Type | Nullable | Internal-only | Immutable after first population | Expected source | Customer-visible | Historical backfill |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `subscription_occurrence_id` | string | yes | yes | yes | copied from Customer App `Order` / native `ShopifyOrder` | false | false |
| `subscription_cycle_key` | string | yes | yes | yes | copied from Customer App `Order` / native `ShopifyOrder` | false | false |

Reason: `FulfillmentTask` already has Customer App order, native ShopifyOrder, parent subscription, fulfillment number, date, and source fields. It needed the exact occurrence fields to participate in the deterministic chain.

## 4. Fields considered but not added

| Candidate | Decision | Reason |
| --- | --- | --- |
| New `SubscriptionOccurrence` entity | deferred | Not essential for this first additive patch; OCC4 keeps schema scope minimal |
| New `Subscription` parent fields | not added | Parent `Subscription.id`, status, Stripe, and Hub fields are sufficient for future parent identity |
| New `CommandLog` fields | not added | Existing `idempotency_key` is sufficient for future command idempotency |
| Required occurrence fields | not added | Would invalidate existing one-time and historical rows |
| Provider occurrence ids as customer-visible fields | not added | Provider ids remain internal and should not be exposed |
| Date-only occurrence identity | rejected | Scheduled/delivery date is schedule context, not identity |

If a future preview proves that an occurrence must exist before any Customer App `Order`, then a separate OCC4B design can add a dedicated ledger entity. OCC4 does not add one implicitly.

## 5. Backward compatibility

The patch is backward-compatible because all added fields are:

- additive;
- nullable/optional;
- internal-only;
- unset for existing rows;
- valid for one-time orders;
- valid for historical subscription rows with null occurrence linkage;
- excluded from customer-facing payloads unless separately approved;
- not part of current required-field lists.

No existing rows require migration or backfill.

## 6. No-backfill policy

OCC4 does not backfill the six cancelled subscriptions.

Hard rules:

- no historical Customer App `Order` creation;
- no historical native `ShopifyOrder` creation;
- no historical `FulfillmentTask` creation;
- no mutation of cancelled subscriptions;
- no inferred occurrence links from dates;
- no silent customer chronology changes;
- no customer-facing duplication;
- historical Hub-only occurrences remain Hub fallback.

Any historical backfill would require a separate owner-approved, gated phase with exact evidence.

## 7. Parent, occurrence, and cycle identity rules

Parent identity:

```text
Subscription.id
```

Occurrence identity:

```text
subscription_occurrence_id
```

Cycle identity:

```text
subscription_cycle_key
```

Rules:

- `subscription_occurrence_id` is the immutable occurrence identity.
- `subscription_cycle_key` is a secondary exact cycle reference, not the sole occurrence identity.
- `customer_app_subscription_id` links the Customer App `Order` to the parent `Subscription`.
- The same scheduled date may contain multiple distinct occurrences.
- Scheduled/delivery date alone cannot identify an occurrence.
- Customer email, name, phone, address, amount, product name, and current timestamp cannot be part of the idempotency identity.
- Exact links must agree across Customer App `Order`, native `ShopifyOrder`, and `FulfillmentTask`.

## 8. Future materialization idempotency

Future commands should derive idempotency from immutable values:

```text
subscription_occurrence_materialize:<parent_subscription_id>:<subscription_occurrence_id>:<operation_type>
```

Expected future retry behavior:

- exact duplicate request resolves the same existing chain;
- no second Customer App `Order` is created;
- no second native `ShopifyOrder` is created;
- no second `FulfillmentTask` is created;
- partial-chain recovery must verify exact occurrence identity before proposing any write;
- Stripe billing and Hub recurrence authority remain active.

## 9. Schema contract tests

Added harness:

```text
scripts/migration/run-g46b-occ4-subscription-occurrence-schema-patch-tests.mjs
```

Coverage includes:

- existing one-time rows remain valid;
- existing historical subscription rows remain valid with null occurrence fields;
- existing native `ShopifyOrder` and `FulfillmentTask` rows remain valid;
- future Customer App `Order`, native `ShopifyOrder`, and `FulfillmentTask` can store matching parent/occurrence/cycle context;
- occurrence id and parent id remain distinct;
- cycle key and scheduled date cannot replace occurrence id;
- same-date occurrences remain distinguishable;
- cross-customer, occurrence mismatch, and cycle mismatch conflicts fail closed;
- no customer PII in identity keys;
- fields are internal-only;
- no provider calls, notifications, Hub mutation, or live writes.

## 10. Publish plan

Do not publish schemas during OCC4 PR prep.

After merge, use a separate `G46B-OCC4-PUB1` phase:

1. verify the exact pending schema diff;
2. publish only affected entity schemas:
   - `Order`;
   - `ShopifyOrder`;
   - `FulfillmentTask`;
3. do not use Builder Fix All;
4. do not publish runtime functions or customer UI;
5. verify live schemas contain the optional fields;
6. verify existing records remain readable;
7. create no test/live records;
8. run no-write verification.

If safe scoped schema publishing is unavailable, hold after merge and do not run a broad Builder publish.

## 11. Rollback considerations

Because the patch is additive and optional:

- existing rows are unaffected;
- runtime behavior remains unchanged;
- customer responses remain unchanged;
- rollback before publish is a normal Git revert;
- rollback after publish should be coordinated as a schema revert only if Base44 supports safe scoped schema rollback.

Do not attempt rollback by mutating live records.

## 12. Hard stops

- No G46C while active native parent count is zero.
- No G46C from cancelled/historical parents.
- No occurrence creation in OCC4.
- No historical backfill.
- No inferred occurrence identity from dates.
- No new required fields for existing records.
- No runtime function changes.
- No customer UI changes.
- No Stripe, Shopify, Hub, or provider calls.
- No notifications.
- No repair/replay/backfill.
- No Base44 publish during PR prep.

## 13. Recommendation

Merge OCC4 if schema checks pass, then run a separate OCC4-PUB1 scoped schema publish. After the optional fields are live and existing records remain readable, proceed to G46B-OCC5: a read-only future occurrence chain packet preview.

Do not proceed to G46C until a future active subscription occurrence has a complete proven native chain.
