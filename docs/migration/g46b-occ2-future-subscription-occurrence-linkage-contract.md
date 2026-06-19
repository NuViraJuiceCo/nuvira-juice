# G46B-OCC2 — Future Subscription Occurrence Linkage Contract

## 1. Executive summary

G46B-OCC1 closed the immediate G46C path:

```text
G46C customer subscription reads: blocked
```

Reasons carried forward:

- active native `Subscription` parents: 0;
- paused native `Subscription` parents: 0;
- cancelled native `Subscription` parents: 6;
- existing occurrence context lacks native Customer App `Order` and `FulfillmentTask` links;
- historical cancelled records are not valid migration pilots.

G46B-OCC2 defines the future fixture-proven linkage contract required before any customer subscription read patch can safely proceed:

```text
Subscription parent
→ occurrence/cycle
→ Customer App Order
→ native ShopifyOrder
→ native FulfillmentTask
```

This phase is static/read-only only. It does not patch runtime code, publish Base44, read or mutate live records, call Stripe/Shopify/Hub/providers, send notifications, or run repair/replay/backfill.

## 2. Current root-cause conclusion

OCC2 separates the possible causes and maps them to current evidence.

| Possible conclusion | OCC2 finding |
| --- | --- |
| `occurrence_creation_contract_gap_schema_ready` | Partially true for native `ShopifyOrder` and `FulfillmentTask`; they contain occurrence-capable fields. Not fully true because Customer App `Order` lacks explicit subscription occurrence linkage fields. |
| `occurrence_schema_linkage_gap` | True for Customer App `Order` as the customer-visible occurrence row. |
| `occurrence_native_chain_intentionally_deferred` | True. Current creation/sync paths create/repair parent records and push recurrence to Hub; broad native Customer App Order + ShopifyOrder + FulfillmentTask occurrence chains are not created. |
| `occurrence_historical_hub_only_by_design` | True for current cancelled/historical subscription evidence and existing G36/G46 notes. |
| `occurrence_preview_lookup_contract_gap` | Not proven by current evidence. It becomes relevant only if valid exact links exist in records but the preview misses supported identifiers. |

Primary OCC2 classification:

```text
occurrence_schema_linkage_gap
occurrence_native_chain_intentionally_deferred
occurrence_historical_hub_only_by_design
```

Secondary future classification if native order/task fields are populated by a later exact packet:

```text
occurrence_creation_contract_gap_schema_ready
```

## 3. Actual schema audit

### Subscription parent: `Subscription`

Relevant parent fields:

- `id`
- `customer_email`
- `plan_id`
- `bundle_id`
- `custom_composition`
- `delivery_zone_id`
- `delivery_address`
- `status`
- `cancel_at_period_end`
- `cancel_effective_date`
- `next_delivery_date`
- `started_date`
- `paused_until`
- `stripe_subscription_id`
- `stripe_customer_id`
- Hub sync metadata fields

Finding: `Subscription` is a parent/display record. It is not an occurrence ledger.

### Checkout/activation context: `PendingSubscriptionCheckout`

Relevant fields:

- `stripe_checkout_session_id`
- `stripe_subscription_id`
- `stripe_customer_id`
- `plan_id`
- `fulfillment_cadence`
- `fulfillments_per_cycle`
- `fulfillment_number`
- `production_date`
- `first_delivery_date`
- `next_delivery_date`
- `status`
- `hub_payload`

Finding: `PendingSubscriptionCheckout` is activation context and can support first-cycle context, but it is not sufficient as a durable per-occurrence customer display ledger.

### Customer-visible occurrence row: Customer App `Order`

Relevant current fields include:

- `order_number`
- production/delivery status fields;
- delivery schedule fields;
- payment/refund fields.

Missing explicit subscription occurrence keys:

- `customer_app_subscription_id`
- `subscription_parent_id`
- `stripe_subscription_id`
- `occurrence_id`
- `fulfillment_number`
- explicit cycle/billing occurrence id

Finding:

```text
occurrence_schema_linkage_gap
```

Customer App `Order` is the canonical customer-facing order row, but the schema does not currently provide deterministic subscription occurrence linkage fields. Without those fields, a future subscription read must not infer occurrence ownership from delivery date, customer name, email, phone, amount, or newest-record selection.

### Native operational occurrence mirror: `ShopifyOrder`

Occurrence-capable fields include:

- `base44_order_id`
- `shopify_order_number`
- `source_channel`
- `source_type`
- `order_type`
- `fulfillment_mode`
- `is_subscription`
- `fulfillments`
- `stripe_subscription_id`
- `subscription_parent_id`
- `fulfillment_instance_date`
- `fulfillment_sequence_number`
- `source_invoice_id`
- status and schedule fields

Finding:

```text
occurrence_creation_contract_gap_schema_ready
```

for this entity only. The schema can carry an occurrence mirror, but current creation paths do not broadly materialize all customer-visible subscription occurrences as native `ShopifyOrder` rows.

### Native operational task: `FulfillmentTask`

Occurrence-capable fields include:

- `order_id`
- `base44_order_id`
- `shopify_order_id`
- `native_shopify_order_id`
- `shopify_order_number`
- `order_number`
- `fulfillment_task_id`
- `source_channel`
- `source_type`
- `order_type`
- `fulfillment_type`
- `fulfillment_number`
- `delivery_date`
- `scheduled_date`
- `assigned_delivery_date`
- `status`
- `delivery_status`
- `production_status`
- `sync_status`
- `stripe_subscription_id`
- `customer_app_subscription_id`
- `plan_id`

Finding:

```text
occurrence_creation_contract_gap_schema_ready
```

for this entity only. The task schema can link a subscription occurrence to native operational work, but current G46B evidence found no native-read-ready occurrence and no broad active parent chain.

## 4. Occurrence creation and sync path audit

### `createSubscriptionPaymentElementIntent`

Creates `PendingSubscriptionCheckout` before Stripe subscription creation. Stores decomposition, schedule, customer-entered delivery context, and Stripe metadata.

Does not create:

- Customer App `Order` occurrence rows;
- native `ShopifyOrder` occurrence rows;
- native `FulfillmentTask` occurrence rows.

### `stripeWebhook`

For subscription checkout/invoice success, creates or updates the parent `Subscription`, marks pending checkout completed, and dispatches Hub subscription sync.

Does not broadly create the full native customer occurrence chain.

### `syncSubscriptionWithFulfillments`

Calculates fulfillments and sends them to Hub. Hub remains recurrence/multi-delivery source-of-truth.

Does not create the local Customer App Order → ShopifyOrder → FulfillmentTask occurrence chain.

### `repairMissingSubscriptionForPaidInvoice` and `repairMissingCASubscriptionFromStripeAndHub`

Repair paths can create/repair parent records and send subscription context to Hub. They are not OCC2 actions and are not a basis for automatic customer subscription read migration.

### `createNativeSubscriptionOccurrenceShopifyOrderMirrorForCustomerApp`

Default-off exact-gated command for a historical Hub subscription occurrence mirror. It creates only native `ShopifyOrder` when explicitly approved. It intentionally holds Customer App Order creation, FulfillmentTask creation, production, compliance, notifications, providers, Hub mutation, repair/replay, inventory, and PO.

Finding:

```text
occurrence_native_chain_intentionally_deferred
```

## 5. Future required linkage contract

A future native-readable subscription occurrence must have all of these exact links.

### Parent identity

Required:

- exact parent `Subscription.id`;
- exact authenticated customer ownership before any customer-facing eligibility;
- exact Stripe subscription linkage presence for billing fallback;
- Hub recurrence fallback retained;
- no duplicate parent identity.

### Occurrence identity

Required:

- exact `occurrence_id` or exact cycle identity;
- exact `fulfillment_number`/cycle number;
- exact scheduled/delivery date;
- exact parent link;
- no duplicate occurrence identity.

Date alone is not enough.

### Customer App Order link

Required:

- exact Customer App `Order.id` or exact `base44_order_id`;
- exact unique order number only when already tied to the owned Customer App Order;
- original Customer App chronology/totals/line items preserved;
- subscription occurrence fields added or an equivalent exact link proven.

### Native ShopifyOrder link

Required:

- exact `ShopifyOrder.id`;
- `base44_order_id` to Customer App Order where available;
- exact subscription parent/occurrence fields;
- exact order number only as a secondary uniqueness confirmation;
- no duplicate native order identity.

### Native FulfillmentTask link

Required:

- exact `FulfillmentTask.id`;
- exact `native_shopify_order_id` or `shopify_order_id`;
- exact `base44_order_id`/`order_id` to Customer App Order;
- exact `customer_app_subscription_id`, `stripe_subscription_id`, and `fulfillment_number` when used;
- no duplicate task identity.

## 6. Idempotency contract

Future occurrence creation or linkage must be idempotent at these levels:

- parent id;
- occurrence/cycle id;
- Customer App Order id/order number;
- native ShopifyOrder id/base44 link;
- FulfillmentTask id/native order link;
- request id/idempotency key.

Duplicate processing must return the existing exact chain or block as duplicate identity risk. It must not create a second Customer App Order, a second native ShopifyOrder, or a second FulfillmentTask.

## 7. Skip/cancel contract

OCC2 does not approve skip or cancel writes. The fixture contract only defines what future commands must prove.

A future skip/cancel must affect only the exact intended occurrence or parent state:

- skip by exact parent + occurrence id/cycle id;
- cancel by exact parent id and approved Stripe/Hub policy;
- never by customer name, email, phone, delivery date alone, or newest occurrence;
- no customer-facing status change without separately approved policy;
- no provider or Hub mutation outside an approved write command.

## 8. Customer-facing safeguards

A future subscription read must preserve:

- Customer App ownership filtering;
- parent identity;
- original customer-safe display fields;
- Stripe billing authority;
- Hub recurrence fallback;
- occurrence order/task uniqueness;
- no diagnostics in customer payload;
- no provider ids or raw payloads;
- no internal sync/log fields.

It must never expose:

- native eligibility;
- mismatch fields;
- fallback reasons;
- review-required flags;
- Stripe ids;
- Hub payloads;
- raw Shopify payloads;
- internal auth/session data.

## 9. Fixture proof coverage

Harness:

```text
scripts/migration/run-g46b-occ2-future-subscription-occurrence-linkage-tests.mjs
```

The fixture harness proves:

- exact parent and cycle identity;
- separate occurrences remain distinct;
- exact Customer App Order, native ShopifyOrder, and FulfillmentTask linkage;
- duplicate processing is idempotent;
- cross-customer and fuzzy matching are rejected;
- skip/cancel target only the exact intended fixture row;
- missing order/task links block native-read readiness;
- provider calls, notifications, Hub mutation, and live writes remain false.

## 10. Hard stops

- No G46C from cancelled/historical parents.
- No G46C while active native parent count is zero.
- No customer subscription reads with zero native-ready occurrences.
- No inferred occurrence links from schedule dates.
- No occurrence backfill without a separate gated command plan.
- No Stripe or Hub authority change.
- No pause/resume/skip/cancel/payment-method work.
- No notifications.
- No provider calls.
- No Base44 publish for OCC2.

## 11. Recommendation

Do not proceed to G46C.

The next runtime phase, if approved, should be OCC3 only after this contract is accepted. OCC3 should not create customer-facing reads. It should be a preview-only/runtime diagnostic patch or exact occurrence packet that can prove which of these applies against a future active parent:

- valid links exist but preview misses them (`occurrence_preview_lookup_contract_gap`);
- schema supports the chain but fields are unpopulated (`occurrence_creation_contract_gap_schema_ready`);
- Customer App Order needs explicit occurrence linkage (`occurrence_schema_linkage_gap`);
- native order/task creation is intentionally deferred (`occurrence_native_chain_intentionally_deferred`);
- historical records must remain Hub-only (`occurrence_historical_hub_only_by_design`).

Until then, keep customer subscriptions on Hub/Stripe fallback and keep all subscription writes held.
