# G46B — Customer Subscription Parent/Occurrence Parity Preview

## 1. Current customer subscription data path

G46B adds an admin-authenticated, read-only preview mode to `previewNativeOrderCutoverReadiness`. It does not change `getCustomerAccountDashboardData`, customer subscription UI, customer subscription management actions, schemas, gates, or allowlists.

Current customer-facing subscription reads remain:

- `SubscriptionManagement.jsx` → `getCustomerAccountDashboardData` → `all_subscriptions`.
- `Account.jsx` → `getCustomerAccountDashboardData` → `active_subscriptions`.
- `SubscriptionManagement.jsx` direct reads for `PendingSubscriptionCheckout` activation context.
- `SubscriptionManagement.jsx` direct reads for `SubscriptionPlan` display labels/count/frequency.

Current customer-facing subscription writes remain unchanged and held for migration purposes:

- pause via `pauseSubscription`;
- future cancellation via `cancelSubscriptionFutureRenewal`;
- skip/resume/cancel direct `Subscription.update` paths;
- composition update via `CompositionEditor`;
- payment method updates through Stripe portal.

No customer-facing subscription cutover is introduced by G46B.

## 2. Actual parent/occurrence entities

### Parent/display entities

- `Subscription`
  - parent subscription display record;
  - customer ownership field;
  - plan/bundle/composition fields;
  - status, pause, future-cancel, next-delivery fields;
  - Stripe linkage presence;
  - Hub sync status metadata.
- `SubscriptionPlan`
  - cadence/frequency and bottle-count display context.
- `SubscriptionBundle`
  - bundle/catalog display context where used.
- `PendingSubscriptionCheckout`
  - checkout activation and first-delivery decomposition context, not a durable occurrence ledger.

### Occurrence-capable native entities

- `ShopifyOrder`
  - subscription source/channel fields;
  - subscription parent linkage fields;
  - fulfillment mode/occurrence snapshots;
  - delivery/fulfillment status fields.
- `FulfillmentTask`
  - subscription parent linkage fields;
  - native ShopifyOrder linkage fields;
  - fulfillment number;
  - delivery/schedule fields;
  - production/delivery/fulfillment status fields.
- Customer App `Order`
  - may represent a customer-visible order/occurrence link, but must not be treated as the subscription parent.

### Review/log entities

- `OrderReviewQueue`
- `OrderSyncLog`
- `SafeSyncParityLog`

These are used only as read-only hold signals. G46B does not create logs or queues.

## 3. Exact identity model

G46B supports:

```text
preview_mode=CUSTOMER_SUBSCRIPTION_PARENT_OCCURRENCE_PARITY
mode=EXACT_SUBSCRIPTION_PARENT_OCCURRENCE_PARITY
mode=BOUNDED_SUBSCRIPTION_READINESS_SCAN
```

Exact preview requires an exact internal parent identifier:

```json
{
  "preview_mode": "CUSTOMER_SUBSCRIPTION_PARENT_OCCURRENCE_PARITY",
  "mode": "EXACT_SUBSCRIPTION_PARENT_OCCURRENCE_PARITY",
  "native_subscription_id": "<exact internal parent id>",
  "user_profile_id": "<exact internal profile id if needed>",
  "request_id": "g46b_exact_subscription_parent_occurrence_parity_<timestamp>"
}
```

The preview does not resolve by:

- partial email;
- customer name;
- phone;
- approximate date;
- approximate total;
- fuzzy Stripe/Hub identity;
- newest-record selection.

Provider identifiers are not returned in preview output. Presence/match status is returned as booleans.

## 4. Stripe/Hub/native source-of-truth rules

G46B response preserves these source-of-truth rules:

- `stripe_billing_source_of_truth:true`
- `hub_recurrence_source_of_truth:true`
- `billing_write_ready:false`
- `pause_resume_write_ready:false`
- `skip_write_ready:false`
- `cancel_write_ready:false`
- `payment_method_update_ready:false`
- `occurrence_creation_ready:false`
- `notification_expansion_ready:false`
- `hub_write_suppression_ready:false`

Interpretation:

- Stripe remains authoritative for billing/payment state.
- Hub remains authoritative for recurrence and multi-delivery until exact parity is proven.
- Native parent records may become display candidates only for proven fields.
- Native occurrences must not be confused with the parent subscription.
- Customer App Orders must not be treated as subscription parents.
- Occurrences must not appear as duplicate standalone subscriptions.
- Missing Hub or Stripe context does not imply parity.
- Payment state must not be inferred from delivery state.
- Customer-facing status must not advance from incomplete occurrence context.

## 5. Parent parity contract

Exact parent parity returns safe parent analysis only:

- exact parent match count;
- duplicate parent identity risk;
- native parent presence/status;
- cadence presence;
- product selection presence;
- quantity selection presence;
- next billing/date presence signals;
- Stripe linkage presence;
- Hub linkage presence;
- native parent read candidate;
- fallback/review requirement;
- safe blockers/warnings/classification.

It does not return customer identity fields, provider identifiers, raw payment payloads, raw Hub payloads, or raw native records.

A future customer subscription parent read may be native-primary only when:

- authenticated ownership filtering occurs first;
- exactly one native parent exists;
- no duplicate parent identity exists;
- parent status is internally consistent;
- product/quantity selections are complete;
- cadence is complete;
- Stripe billing context remains authoritative and available through fallback;
- Hub recurrence context remains available for unsupported recurrence fields;
- customer-safe response can be produced without diagnostics;
- no repair/replay hold exists.

## 6. Occurrence parity contract

Occurrence analysis discovers subscription-like context in native order/task/checkout rows and validates that each occurrence is distinct from the parent.

Safe occurrence summaries include only:

- `occurrence_ref`;
- parent-link presence;
- scheduled-date presence;
- status classification;
- Customer App Order link presence;
- native ShopifyOrder link presence;
- FulfillmentTask link presence;
- native-read eligibility;
- fallback/review requirement;
- classification and safe blockers.

A future occurrence read may be native-primary only when:

- exact parent link exists;
- exact occurrence identity exists;
- scheduled date is present;
- no duplicate occurrence identity exists;
- exact Customer App Order/native ShopifyOrder/FulfillmentTask links agree where required;
- no schedule/status mismatch exists;
- no repair/replay hold exists;
- no customer-facing internal metadata is exposed.

Even when a parent or occurrence is read-ready, subscription management writes remain unchanged and Hub/Stripe fallback remains active.

## 7. Bounded scan strategy

`BOUNDED_SUBSCRIPTION_READINESS_SCAN` performs one bounded read per source and joins in memory:

```json
{
  "preview_mode": "CUSTOMER_SUBSCRIPTION_PARENT_OCCURRENCE_PARITY",
  "mode": "BOUNDED_SUBSCRIPTION_READINESS_SCAN",
  "subscription_parent_limit": 25,
  "occurrence_limit": 100,
  "related_entity_limit": 100,
  "request_id": "g46b_bounded_subscription_readiness_<timestamp>"
}
```

Sources read:

- `Subscription`
- `SubscriptionPlan`
- `PendingSubscriptionCheckout`
- `Order`
- `ShopifyOrder`
- `FulfillmentTask`
- `OrderReviewQueue`
- `OrderSyncLog`
- `SafeSyncParityLog`

The scan reports:

- source read counts;
- source row counts;
- truncation;
- aggregate parent counts;
- aggregate occurrence counts;
- fallback/review/mismatch counts;
- classification counts;
- safe parent summaries;
- safe occurrence summaries.

If any required source is truncated, G46B does not claim fleet-wide readiness and uses follow-up/exact preview guidance.

## 8. Customer-read eligibility

A candidate can feed future G46C planning only when the parent and any occurrence context are deterministic and customer-safe.

Readiness does not authorize:

- pause;
- resume;
- skip;
- cancel;
- reactivation;
- payment method update;
- occurrence creation;
- Hub write suppression;
- notifications;
- repair/replay/backfill.

Future customer-facing reads must still run after authenticated customer ownership filtering. Admin preview proof does not replace customer-auth isolation proof.

## 9. Write-path hard stops

G46B hard stops:

- no `Subscription` mutation;
- no occurrence creation/update;
- no Customer App Order creation;
- no native `ShopifyOrder` creation;
- no native `FulfillmentTask` creation;
- no Stripe call;
- no Shopify call;
- no Hub call or mutation;
- no provider call;
- no notification;
- no sync/repair/replay;
- no `CommandLog` or `OrderSyncLog` creation;
- no customer-facing status change;
- no customer diagnostics exposure;
- no provider ids or raw payloads returned.

## 10. Response safety

All G46B responses include:

- `dry_run:true`
- `writes_performed:false`
- `pii_returned:false`
- `raw_payloads_returned:false`
- `provider_call_impact:false`
- `stripe_calls:false`
- `shopify_calls:false`
- `hub_calls:false`
- `notifications_sent:false`
- `hub_mutation_performed:false`
- `subscription_mutation_performed:false`
- `occurrence_mutation_performed:false`
- `payment_method_updated:false`
- `subscription_paused:false`
- `subscription_resumed:false`
- `subscription_cancelled:false`
- `delivery_skipped:false`
- `command_log_created:false`

Broad preview output omits customer names, customer emails, phone numbers, full addresses, Stripe subscription ids, Hub ids, Shopify provider ids, payment method fields, raw Hub payloads, raw Stripe payloads, raw Shopify payloads, and internal auth/session data.

## 11. Tests

Harness:

```text
scripts/migration/run-g46b-customer-subscription-parent-occurrence-parity-tests.mjs
```

Coverage includes:

- admin auth boundary;
- exact parent resolution;
- duplicate parent identity;
- ownership-link mismatch;
- Stripe/Hub authority flags;
- missing Stripe/Hub fallback;
- cadence/product/quantity/date parity signals;
- occurrence parent link, schedule, status, order link, native order link, task link;
- orphan and duplicate occurrence holds;
- repair/replay holds;
- bounded one-read-per-source behavior;
- source truncation safety;
- no PII/provider ids/raw payloads;
- no subscription mutation;
- no occurrence create/update;
- no Stripe/Shopify/Hub/provider calls;
- no notifications;
- no logs/queues created.

## 12. Recommendation

Close/merge G46B if checks pass, then publish only `previewNativeOrderCutoverReadiness` in a separate post-merge phase.

Post-merge sequence should be:

1. Boundary verify `previewNativeOrderCutoverReadiness`.
2. Resolve one exact safe parent subscription using internal ids.
3. Run one exact parent/occurrence parity preview.
4. Run one bounded readiness scan.
5. Run no-write verification.
6. Do not activate customer subscription reads.

Proceed to G46C planning only when exact parent identity is unambiguous, exact occurrence identities are deterministic, native parent fields can reproduce the customer summary safely, native occurrence fields can reproduce upcoming/history rows safely, Stripe fallback remains authoritative for billing, Hub fallback remains active for recurrence/multi-delivery, no repair/replay hold exists, and no customer diagnostics are exposed.
