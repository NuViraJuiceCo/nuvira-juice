# G46A — Customer Subscription Native Boundary Audit

## 1. Executive summary

G46A is a docs-only/static/read-only audit of the customer subscription and multi-delivery customer-facing boundary. No runtime code, schema, UI, Builder/Base44 publish, provider call, Hub mutation, subscription mutation, occurrence creation, sync/retry/repair/replay, notification, queue, or log was performed.

Current conclusion: customer subscription pages are **not ready for native-first customer-facing cutover**. The Customer App can read parent-level subscription display data natively, but billing authority, recurring subscription state, occurrence execution, fulfillment task generation, refunds, and multi-delivery lifecycle remain split across Stripe and Hub.

Key findings:

- `/account/subscriptions` reads parent subscription rows from `getCustomerAccountDashboardData` and displays Customer App `Subscription` records.
- `Account.jsx` also reads subscription summary data from `getCustomerAccountDashboardData`.
- `SubscriptionManagement.jsx` directly reads `PendingSubscriptionCheckout` and `SubscriptionPlan` for activation state and plan display.
- Customer-facing management controls still include write-capable paths for pause, skip, resume, cancel, composition update, and billing portal handoff.
- `pauseSubscription` and `cancelSubscriptionFutureRenewal` call Stripe and update Customer App `Subscription`, then notify Hub through `syncCustomerToHub`.
- Direct customer entity updates exist in the customer page for skip/resume/cancel and in `CompositionEditor` for composition updates.
- Native `ShopifyOrder` and `FulfillmentTask` schemas contain subscription/occurrence-capable fields, but the customer subscription page does not yet have a deterministic native parent/occurrence read model.
- G36 subscription occurrence preview/mirror work provides exact controlled preview/mirror groundwork, but it does not authorize customer subscription page native-first reads or writes.

Recommended next phase: **G46B — read-only subscription parent/occurrence parity preview**. It should compare exact bounded samples across Customer App parent records, Hub occurrence context, Stripe billing authority, native `ShopifyOrder`, and native `FulfillmentTask`, without changing customer behavior.

## 2. Customer subscription page data path

### 2.1 Customer-facing surfaces inspected

| Surface | Current data path | Read/write capability | Finding |
| --- | --- | --- | --- |
| Subscription management page | `src/pages/SubscriptionManagement.jsx` invokes `getCustomerAccountDashboardData` and uses `all_subscriptions` | Read plus write-capable controls | Parent subscription display is native-readable; management controls remain write-risk paths |
| Account subscription summary | `src/pages/Account.jsx` uses `active_subscriptions` from `getCustomerAccountDashboardData` | Read | Native parent summary is available, but not occurrence-complete |
| Pending activation state | `SubscriptionManagement.jsx` reads `PendingSubscriptionCheckout.filter({ customer_email })` | Read | Native pending checkout context exists, but it is not a durable occurrence ledger |
| Plan/catalog display | `SubscriptionManagement.jsx` reads `SubscriptionPlan.filter({}, 'sort_order', 50)` | Read | Native catalog display is ready for labels/count/frequency |
| Composition editor | `src/components/subscription/CompositionEditor.jsx` updates `Subscription.custom_composition` | Write-capable | Customer composition write path remains outside native migration approval |
| Billing management | `SubscriptionManagement.jsx` invokes `stripeCustomerPortal` | Provider handoff | Stripe remains payment method and billing authority |

No dedicated subscription detail page was identified in the inspected customer routes. The observed customer subscription surface is the account subscription management page plus the account summary card.

### 2.2 `getCustomerAccountDashboardData`

`getCustomerAccountDashboardData` is the actual account/subscription summary read source. It:

- authenticates the customer;
- resolves Customer App identity emails through `UserProfile`;
- reads `Subscription` rows filtered by the resolved customer identity;
- dedupes subscription rows by `stripe_subscription_id` or native `Subscription.id`;
- returns `all_subscriptions`, `active_subscriptions`, `subscription_count`, and `current_ritual`;
- also returns non-subscription dashboard data such as orders, credits, loyalty, and unread notification count.

The current function does **not** natively assemble a full subscription occurrence list from `ShopifyOrder`/`FulfillmentTask`, does **not** call Stripe for current billing status, and does **not** read Hub occurrence state for customer subscription display.

### 2.3 Current customer-visible subscription fields

The customer page can display or derive:

- parent subscription status (`active`, `paused`, `cancelled`);
- plan name, bottle count, and cadence/frequency from `SubscriptionPlan`;
- product quantities from `custom_composition` where present;
- delivery address under the existing customer contract;
- next delivery date from `Subscription.next_delivery_date`;
- cancellation-at-period-end and effective cancellation date;
- paused-until date;
- created/started date for the customer-facing "since" label;
- pending activation state from `PendingSubscriptionCheckout`.

The page does not currently prove full native parity for:

- next billing date;
- complete upcoming occurrence list;
- historical occurrence list;
- skipped occurrence state;
- completed occurrence state;
- cancelled occurrence state;
- Hub-only valid occurrence preservation;
- Stripe-current subscription/payment status.

## 3. Parent/occurrence identity model

### 3.1 Native parent subscription identity

Native parent-level fields are available in `Subscription`:

- native `Subscription.id`;
- customer identity field (`customer_email`);
- `plan_id`;
- `bundle_id`;
- `custom_composition`;
- `delivery_zone_id`;
- delivery address;
- `status`;
- `next_delivery_date`;
- `started_date`;
- `paused_until`;
- `cancel_at_period_end`;
- `cancel_effective_date`;
- Stripe subscription/customer identifiers;
- Hub sync status metadata.

This is sufficient for a parent-level Customer App subscription summary, but not sufficient to claim native occurrence source-of-truth.

### 3.2 Pending checkout and first-delivery context

`PendingSubscriptionCheckout` contains customer checkout/decomposition fields such as plan/cadence, fulfillment cadence, fulfillments per cycle, first delivery date, next delivery date, delivery window, product quantities, Stripe checkout/subscription/customer identifiers, status, and a Hub payload audit field.

This is useful for activation/pending display and webhook troubleshooting. It is not a canonical recurring occurrence ledger.

### 3.3 Native occurrence-capable fields

`FulfillmentTask` includes occurrence-capable fields:

- `order_id`;
- `base44_order_id`;
- `shopify_order_id`;
- `native_shopify_order_id`;
- order number fields;
- `source_type`;
- `order_type`;
- `fulfillment_type`;
- `fulfillment_number`;
- delivery/scheduled/assigned delivery dates;
- Stripe subscription identifier;
- Customer App subscription identifier.

`ShopifyOrder` includes subscription/multi-delivery fields:

- `source_channel`;
- `order_type`;
- `is_subscription`;
- subscription cadence;
- `subscription_parent_id`;
- fulfillment mode;
- fulfillment occurrence snapshots;
- Stripe invoice/subscription context;
- delivery/fulfillment status fields.

These fields are valuable for exact parity previews and controlled mirrors. They are not yet wired into the customer subscription page as a deterministic parent/occurrence read model.

### 3.4 Deterministic join requirements

Future read previews must prove parent/occurrence joins using exact identifiers only:

- native parent `Subscription.id`;
- Stripe subscription identifier;
- Hub subscription/order/occurrence identifiers when available in preview context;
- Customer App Order link when an occurrence is intentionally represented as a customer order;
- native `ShopifyOrder` link;
- native `FulfillmentTask` link;
- fulfillment number;
- scheduled delivery date/billing-cycle identity.

Do not rely on:

- customer-name matching;
- phone matching;
- partial email matching;
- approximate dates;
- approximate totals;
- fuzzy order-number matching;
- "newest record wins" selection.

Hard stop: if parent and occurrence identity cannot be resolved deterministically, customer-facing native subscription reads must remain held.

## 4. Domain classification table

| # | Domain | Current source of truth | Native entities available | Hub dependency | Stripe dependency | Read capable | Write capable | Customer-facing | Current controls/gates | Idempotency / exact identity | Classification | Migration readiness |
| ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Subscription parent identity | Customer App for account display; Stripe for billing lifecycle; Hub for operational recurrence | `Subscription`, `SubscriptionPlan`, `SubscriptionBundle` | Hub consumes parent context for operations | Stripe subscription/customer context | Yes, parent-level | Yes, existing update/function paths | Yes | No G46 native read gate | Parent id and Stripe subscription context exist | `native_read_partial`, `stripe_source_of_truth`, `hub_fallback_active` | Needs G46B parity before any cutover |
| 2 | Delivery occurrence identity | Hub operational source | `ShopifyOrder`, `FulfillmentTask`, `PendingSubscriptionCheckout` first-delivery context | Primary occurrence ledger/task execution | Billing-cycle context | Exact preview only | G36G mirror command exists but held/default-off | Not safely broad | G36 exact preview/mirror gates exist for selected occurrence only | Exact occurrence id/linkage not generally proven | `parent_occurrence_identity_ambiguous`, `hub_read_primary`, `exact_controlled_preview_ready` | Major blocker |
| 3 | Parent-versus-occurrence relationship | Hub + Stripe + Customer App split | Parent `Subscription`; occurrence-capable native order/task fields | Hub links parent to fulfillments | Stripe links billing cycle to parent | Partial | Write paths exist but held | Yes | No broad customer read gate | Needs parent id + occurrence id + cycle/date/task match | `blocked_by_identity_gap`, `hub_read_primary` | Needs exact model |
| 4 | Product and quantity selections | Customer App checkout/Subscription; Hub operational payload | `Subscription.custom_composition`, `PendingSubscriptionCheckout.products`, `SubscriptionPlan` | Hub receives product decomposition for fulfillments | Stripe price/product context | Partial | Composition editor writes native `Subscription` | Yes | No migration gate; RLS allows owner updates | Product identity can drift between parent and occurrence | `native_read_partial`, `hub_write_primary` | Reads possible, writes held |
| 5 | Delivery cadence/frequency | Customer App plan + Stripe subscription + Hub recurrence | `SubscriptionPlan.frequency`, pending checkout cadence fields | Hub operational recurrence | Stripe billing cadence | Partial | Subscription creation/update paths exist | Yes | No G46 gate | Cadence vs fulfillment cadence must be separated | `native_read_partial`, `hub_read_primary`, `stripe_source_of_truth` | Preview required |
| 6 | Next billing date | Stripe | No authoritative native current-period field in customer page contract | Hub may react to future cancel/pause | Primary | Not natively safe | Stripe portal/functions write billing state | Yes | Stripe provider boundary | Must not infer from delivery date | `stripe_source_of_truth`, `blocked_by_payment_authority` | Held |
| 7 | Next delivery date | Customer App display and Hub recurrence execution | `Subscription.next_delivery_date`, pending checkout first/next delivery | Operational source | Indirect | Partial | Skip writes `next_delivery_date` directly | Yes | No default-off native migration gate | Delivery date must match occurrence schedule | `native_read_partial`, `hub_read_primary`, `blocked_by_fulfillment_lifecycle` | Held for native-first |
| 8 | Payment/subscription status | Stripe | Parent status field exists but not billing-authoritative | Hub receives operational state | Primary | Partial display only | Stripe functions/portal | Yes | Provider boundary | Payment status must be provider-confirmed | `stripe_source_of_truth`, `blocked_by_payment_authority` | Held |
| 9 | Customer-facing subscription status | Mixed parent display plus Stripe/Hub realities | `Subscription.status`, pause/cancel fields | Hub owns occurrence execution after future actions | Stripe owns active/cancel/pause billing | Partial | Existing writes | Yes | No G46 read gate | Parent status does not equal occurrence status | `native_read_partial`, `customer_facing_held` | Needs parity |
| 10 | Upcoming delivery list | Hub operational recurrence | Native task/order fields may represent selected occurrences | Primary | Indirect | Exact preview only | Task/order creation held | Yes | G36 previews for exact occurrence | Requires exact occurrence/task match | `hub_read_primary`, `native_occurrence_identity_ready` for exact preview only | Held |
| 11 | Historical occurrence list | Hub operational history | Native mirrors may exist for selected occurrences | Primary | Payment context | Exact preview only | G36G mirror command held/default-off | Yes | G36 exact command gate | Historical mirror chronology risk | `hub_read_primary`, `exact_controlled_preview_ready` | Held |
| 12 | Pause/resume | Stripe + Hub future intent | `Subscription.status`, `paused_until` | Hub notified for future pause | Stripe pause collection | Write-capable today | Yes | Yes | No G46 migration gate | Idempotency not established for native migration | `hub_write_primary`, `stripe_source_of_truth`, `blocked_by_missing_idempotency` | Held |
| 13 | Skip delivery | Hub operational schedule should govern | `Subscription.next_delivery_date` direct update | Hub schedule/task impact | Indirect | Display only | Direct customer native update exists | Yes | RLS owner update; no migration gate | Occurrence identity absent | `hub_write_primary`, `native_write_command_missing`, `blocked_by_fulfillment_lifecycle` | Hard hold |
| 14 | Cancellation | Stripe and Hub | Parent cancel flags/status | Hub handles operational future/current distinction | Stripe cancel-at-period-end | Partial display | Function/direct update paths | Yes | No G46 gate | Current-cycle occurrence preservation required | `stripe_source_of_truth`, `hub_write_primary`, `blocked_by_payment_authority` | Held |
| 15 | Reactivation | Stripe portal / mixed native update | Parent cancel flags/status | Hub future state may need correction | Stripe if provider subscription exists | Partial | Portal/direct update path observed | Yes | No G46 gate | Native-only reactivation can desync billing/Hub | `stripe_source_of_truth`, `hub_write_primary`, `blocked_by_payment_authority` | Held |
| 16 | Payment-method updates | Stripe | None authoritative | None except downstream status | Primary | Portal handoff | Stripe portal | Yes | Provider boundary | Not native | `stripe_source_of_truth`, `blocked_by_payment_authority` | Held |
| 17 | Subscription fulfillment task creation | Hub / approved sync paths | `FulfillmentTask` schema supports fields | Primary | Payment prerequisite | Admin/read preview only | Creation paths held/disabled except controlled commands | Admin-facing | G36/G31/G33 gates apply in narrow scopes | Must avoid duplicate tasks | `hub_write_primary`, `blocked_by_fulfillment_lifecycle` | Held |
| 18 | Production/delivery lifecycle | Hub/admin operational systems | Native task/status fields exist | Primary for subscriptions | Indirect | Admin preview/read partial | Writes held | Customer-facing status held | Native one-time delivery work not generalized to subscriptions | Occurrence/task identity required | `hub_read_primary`, `customer_facing_held` | Held |
| 19 | Refunds/credits | Stripe/Hub/payment paths | Refund previews exist elsewhere | Hub refund cascade/review | Stripe payment authority | Preview only | Write paths high-risk/held | Customer-facing | Refund migration holds | Subscription refund affects parent/occurrences/loyalty | `stripe_source_of_truth`, `repair_replay_governed`, `blocked_by_payment_authority` | Held |
| 20 | Notifications | Existing customer/Hub notification paths | `Notification`, `CustomerMessageDeliveryLog` | Operational events may notify | Indirect | Read partial | Send paths held | Yes | Notification expansion held | Duplicate notification risk | `notification_policy_held` | Held |
| 21 | Hub sync/import/export | Hub operational system | Hub sync status fields on `Subscription`; disabled pull helpers | Active export/write paths | Stripe webhook can trigger sync | Admin read/audit | Sync/export write-capable | Indirect | Some legacy tools disabled; sync paths active | Hub response/sync status not customer contract | `hub_write_primary`, `hub_fallback_active`, `repair_replay_governed` | Held |
| 22 | Repair/replay/backfill | Manual/log-governed | Repair helper functions exist | Hub and Stripe involved | Stripe involved in some repairs | Admin only | Write-capable/high-risk | No direct customer UI | Legacy/freeze guards and manual governance observed | Idempotency varies by helper | `repair_replay_governed` | Held |
| 23 | Admin subscription visibility | Admin previews/functions/docs | Parent/order/task entities | Hub context still needed | Stripe context for billing | Partial | Admin tools include write paths | Admin-facing | Preview-first required | Exact samples required | `native_read_partial`, `hub_read_primary` | Needs G46B |
| 24 | Customer subscription page reads | Customer App parent rows | `Subscription`, `SubscriptionPlan`, pending checkout | Hub needed for occurrences | Stripe needed for billing | Parent summary yes | Page contains write controls | Yes | No G46 native read gate | Must keep parent/occurrence/customer order distinct | `native_read_partial`, `customer_facing_held` | Do not cut over yet |

## 5. Native/Hub/Stripe source-of-truth map

### 5.1 Stripe remains authoritative for billing/payment state

Stripe remains authoritative for:

- recurring billing state;
- current period/billing-cycle authority;
- payment method updates;
- cancellation-at-period-end billing effect;
- pause collection/payment behavior;
- payment failures;
- refunds/payment reversal authority.

Customer App native fields may cache or display billing-adjacent information, but they must not override Stripe.

### 5.2 Hub remains authoritative for recurrence and multi-delivery execution

Hub remains authoritative for:

- subscription recurrence execution;
- multi-delivery occurrence generation;
- operational order/fulfillment task generation;
- production demand for subscription occurrences;
- delivery occurrence state;
- Hub-only valid occurrences;
- future-pause/future-cancel operational effects;
- repair/replay governance for subscription operational state.

Hub pull/rebuild tools are disabled in some legacy helpers, but that does not make native Customer App the source of truth. Active sync/export paths and Hub operational authority remain in force.

### 5.3 Customer App native state is parent-display and preview-capable

Customer App native state currently supports:

- parent subscription account display;
- subscription plan/catalog display;
- pending checkout activation state;
- native order/task fields that can be used for exact previews;
- controlled G36 subscription occurrence preview/mirror packet work;
- selected native write helpers that are not approved for G46 customer-facing migration.

Customer App native state does not yet provide a broad, deterministic, customer-safe occurrence read model.

## 6. Customer read-parity gaps

The native backend cannot yet safely reproduce the full customer subscription experience without Hub/Stripe authority.

| Read-parity question | Current finding | Gap |
| --- | --- | --- |
| Can native reproduce the subscription summary? | Parent-level summary is partially native-readable | Needs Stripe/Hub consistency proof before native-first |
| Can native reproduce next billing date? | No authoritative native billing source in customer page | Stripe remains required |
| Can native reproduce next delivery date? | Parent `next_delivery_date` exists | Must prove it matches Hub recurrence/occurrence schedule |
| Can native reproduce upcoming occurrences? | Not broadly | Requires exact parent/occurrence/task model |
| Can native distinguish completed/skipped/cancelled/pending occurrences? | Not broadly | Hub occurrence/task state remains primary |
| Can native avoid duplicate parent/occurrence rows? | Not proven | Parent subscription, Customer App Order, native ShopifyOrder, and FulfillmentTask may represent different lifecycle layers |
| Can native safely display payment state? | Not without Stripe | Stripe authority must remain |
| Can native preserve customer chronology? | Parent chronology exists | Historical occurrence/mirror chronology needs proof |
| Can native preserve Hub-only valid occurrences? | Not without Hub context | Hub fallback/source remains required |
| Can native support multi-delivery order presentation? | Only exact preview/mirror contexts | No broad customer contract yet |

## 7. Write-path audit

No write path was invoked during this audit.

| Path/function | Entity/API written | Stripe call | Hub call | Native write | Gate/kill switch | Ownership validation | Idempotency | Retry/rollback behavior | Notification behavior | Audit risk |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `pauseSubscription` | `Subscription.update` | Yes, Stripe subscription pause collection | Yes, `syncCustomerToHub` future-pause event | Yes | No G46 migration gate observed | Customer auth and subscription ownership check | Not established for G46 migration | Stripe failure is treated as non-blocking in source; Hub notify failure logged/non-blocking | No explicit customer notification path in audited snippet | Split Stripe/native/Hub result can drift |
| `cancelSubscriptionFutureRenewal` | `Subscription.update` | Yes, cancel at period end | Yes, `syncCustomerToHub` future-cancel event | Yes | No G46 migration gate observed | Customer auth and subscription ownership check | Not established for G46 migration | Hub notify failure handling observed | No explicit customer notification path in audited snippet | Must preserve current paid cycle and Hub tasks |
| `SubscriptionManagement.handleSkip` | `Subscription.update(next_delivery_date)` | No direct call | No direct call | Yes | No migration gate observed | RLS owner rule only | None observed | UI refetch/toast | UI toast only | High risk: native date update can desync Hub occurrence schedule |
| `SubscriptionManagement.handleResume` | `Subscription.update(status, paused_until)` | No direct call | No direct call | Yes | No migration gate observed | RLS owner rule only | None observed | UI refetch/toast | UI toast only | Can desync Stripe/Hub if provider-backed |
| `SubscriptionManagement.handleCancel` | `Subscription.update(status)` | No direct call | No direct call | Yes | No migration gate observed | RLS owner rule only | None observed | UI refetch/toast | UI toast only | Can desync Stripe/Hub if used beyond paused/local cases |
| `SubscriptionManagement.handleResumeCancelledRenewal` | Stripe portal or direct `Subscription.update` fallback | Portal if Stripe-backed | No direct Hub call in fallback | Yes in fallback | No migration gate observed | Customer UI context | None observed | Redirect or local update | UI toast only | Native fallback can diverge from billing authority |
| `CompositionEditor` | `Subscription.update(custom_composition)` | No | No | Yes | No migration gate observed | RLS owner rule only | None observed | UI callback | None observed | Product/quantity update may not update Hub recurrence |
| `stripeCustomerPortal` | Stripe portal/session | Yes | No direct Hub call from page | No direct native write by page | Provider boundary | Customer auth expected | Provider-managed | Redirect | Provider/UI | Stripe remains payment method authority |
| `syncSubscriptionWithFulfillments` | Hub endpoint and `Subscription` sync status fields | No direct Stripe call in audited path | Yes, external Hub endpoint | Yes, sync status | Admin/internal secret auth | Admin/internal | Hub 409 quarantine handling | Updates sync status | None observed | Active Hub write/export path; not customer read cutover |
| `syncSubscriptionFromHub` / `syncAllSubscriptionsFromHub` | Disabled response | No | No | No | Disabled/deprecated | Auth/admin path | N/A | Returns disabled | None | Pull disabled does not remove Hub authority |
| `manualSyncSubscription` | Can create `Subscription` from Stripe | Yes | No in audited excerpt | Yes | Legacy/freeze guard observed | Admin | Limited | Error arrays | None | Repair/sync path held |
| `manualSyncSubscriptionOrders` / `generateSubscriptionOrders` | Disabled response | No | No | No | Disabled/deprecated | Auth/admin | N/A | Returns disabled | None | Live fulfillment generation remains held |
| `syncRepairedSubscriptionToHub` | Stripe read, Hub sync, `Subscription.update` | Yes | Yes | Yes | Legacy/freeze guard observed | Admin | Not a customer path | Updates sync status | None observed | Repair/replay governed |
| `createNativeSubscriptionOccurrenceShopifyOrderMirrorForCustomerApp` | Native `ShopifyOrder` and `CommandLog` if enabled | No provider calls required by policy | Explicit no Hub mutation policy | Yes when gate open | Default-off gate, kill switch, allowlists, policy, confirmation | Admin | Request id / command log idempotency | Conflict/blocker responses | Explicit no notification policy | Exact G36 occurrence mirror only; not customer page cutover |
| Refund/repair helpers | Varies | Often yes | Often yes | Varies | Governed/held | Admin | Varies | Manual/log governed | Held | Not in G46 customer read scope |

## 8. Lifecycle dependencies

### 8.1 Billing lifecycle

Billing lifecycle remains provider-owned. Native reads must not infer paid/current/future billing state from parent `Subscription.status` alone. Cancellation and pause semantics must preserve the current paid cycle and must not create customer-facing contradictions between Stripe, Hub, and Customer App display.

### 8.2 Occurrence lifecycle

Subscription parent state does not equal occurrence state. Each upcoming or historical delivery occurrence needs a deterministic parent/cycle/fulfillment-number/date/task/order identity before it can be shown as native-primary.

### 8.3 Production and delivery lifecycle

Production and delivery status for subscription occurrences remain Hub/operations-governed. Native one-time order production/delivery work must not be generalized to subscriptions until occurrence identity, task ownership, production demand, and customer status mapping are proven.

### 8.4 Repair/replay lifecycle

Repair/replay/backfill remains manual/log-governed. Native customer subscription reads must not mask repair ambiguity or silently drop Hub-only occurrences.

## 9. Recommended G46B–G46F sequence

1. **G46B — read-only subscription parent/occurrence parity preview**
   - Exact bounded samples.
   - Compare Customer App parent `Subscription`, Hub occurrence context, Stripe billing authority, native `ShopifyOrder`, and native `FulfillmentTask`.
   - No writes, no provider calls unless separately approved, no Hub mutation.

2. **G46C — limited native-first customer subscription summary reads**
   - Exact safe account/subscription allowlist only.
   - Parent summary reads only.
   - Hub and Stripe fallback retained.
   - No management actions.

3. **G46D — upcoming occurrence native-read parity**
   - Exact occurrence identity required.
   - No task/production writes.
   - No customer-facing status advancement from incomplete native context.

4. **G46E — pause/resume/skip/cancel write-path design**
   - Docs-only first.
   - Explicit Stripe/Hub/native ordering, idempotency, rollback, customer messaging, and audit policy.
   - No live writes.

5. **G46F — subscription fulfillment lifecycle planning**
   - Held until parent/occurrence identity and native reads are proven.
   - Must address task creation, production demand, delivery lifecycle, duplicate prevention, and customer-facing chronology.

Do not recommend broad subscription customer-facing native-first migration yet.

## 10. Hard stops

- No customer-facing subscription cutover.
- No Stripe write.
- No Shopify call.
- No Hub write suppression.
- No Hub mutation.
- No pause/resume/skip/cancel/reactivation.
- No payment-method change.
- No occurrence creation.
- No `FulfillmentTask` creation.
- No Customer App Order creation for subscription occurrences.
- No production/delivery mutation.
- No notification/message send.
- No sync/repair/replay/backfill.
- No broad subscription command.
- No source-of-truth switch.
- No fuzzy parent/occurrence matching.
- No duplicate parent/occurrence/customer-order presentation.
- No raw Hub/provider/payment payload exposure.

## 11. Recommendation

Keep subscriptions and multi-delivery on the current Hub/Stripe source-of-truth boundaries. Treat native Customer App subscription data as parent-display and exact-preview-capable only.

Proceed next with **G46B read-only subscription parent/occurrence parity preview**. It should prove exact identity, read parity, Hub-only occurrence preservation, Stripe billing authority boundaries, chronology safety, and customer-safe display rules before any native-first customer subscription page plan is proposed.

G45C should remain `customer_rewards_limited_native_first_deployed_disabled_pending_owner_smoke`, and G43B/G43C exact customer order allowlists should remain unchanged.
