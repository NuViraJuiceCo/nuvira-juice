# G36A Subscription / Multi-Delivery Parity Audit

## 1. Executive summary

G36A audits Customer App and Hub subscription / multi-delivery ownership before any native subscription migration work. This is a documentation-only audit. No runtime code, schema, configuration, Builder publish, provider call, sync/retry/repair/replay, gate change, or live data mutation was performed.

Conclusion: subscription / multi-delivery is not ready for native Customer App write ownership.

Current state:

- Customer App owns subscription checkout initiation, parent `Subscription` records, account-facing subscription management, and Stripe webhook handling for subscription lifecycle events.
- Hub remains the operational source of truth for subscription fulfillment occurrences, delivery tasks, production demand, and production batch impact.
- Customer App admin/customer order views are Hub-aware and expand Hub subscription fulfillments into per-delivery display rows.
- Native one-time order previews and materialization paths intentionally block subscription / multi-delivery records.
- Refund shadow/preview work is safe but held; subscription refunds remain high risk because they can affect parent subscription state, occurrence delivery, production, Hub state, loyalty/account state, and customer communications.
- Inventory deduction and PurchaseOrder automation remain held and must not be combined with subscription migration.

Recommended next phase: **G36B subscription occurrence parity preview**. It should be read-only, exact-identifier based, and limited to a single subscription occurrence. It should not create Customer App orders, native ShopifyOrders, FulfillmentTasks, ProductionBatches, OrderReviewQueue entries, logs, notifications, provider calls, or Hub mutations.

## 2. Audit scope and source notes

Customer App source inspected:

- Entities: `Subscription`, `SubscriptionPlan`, `SubscriptionBundle`, `PendingSubscriptionCheckout`, `Order`, `ShopifyOrder`, `FulfillmentTask`, `ProductionBatch`, `BatchComplianceLog`, `OrderReviewQueue`, `OrderSyncLog`, `CommandLog`.
- Subscription/payment functions: `stripeWebhook`, `syncSubscriptionWithFulfillments`, `createSubscriptionPaymentElementIntent`, `createSubscriptionSession`, `cancelSubscriptionFutureRenewal`, `pauseSubscription`, `adminCancelAndRefundSubscription`, subscription repair helpers.
- Native migration previews: `previewNativeFulfillmentTaskMaterialization`, `previewNativeProductionDemandMaterialization`, `previewNativeOrderScheduleCorrection`, `previewNativeScheduleExceptionCorrection`, `previewNativeSafeSyncOrderUpdate`, historical backfill previews.
- Admin/customer views: `getCustomerOrdersWithHub`, `getAdminOrdersWithHub`, `getAdminFulfillmentTaskDetails`, `getAdminOrderTimeline`, `getAdminProductionPlanningSummary`, delivery queue / production planning pages.

Hub source inspected read-only from `NuViraJuiceCo/nuvira-juice-co-operations-hub` at audit clone commit `a21a46c`:

- Entities: Hub `ShopifyOrder`, `FulfillmentTask`, `ProductionBatch`, `OrderReviewQueue`, `OrderSyncLog`.
- Functions: `customerAppEventPublicGateway`, `receiveCustomerAppEvent`, `generateSubscriptionFulfillments`, `safeSubscriptionUpsert`, `createFulfillmentTasks`, `createMissingFulfillmentTasks`, `getProductionPlanningData`, `handleSubscriptionFutureCancel`, `processStripeRefund`, subscription audit/repair/test helpers.

No live Hub endpoint or Customer App endpoint was called.

## 3. Current source-of-truth map

| Surface | Current source of truth | Customer App state | Hub state | Migration readiness |
| --- | --- | --- | --- | --- |
| Subscription checkout setup | Customer App + Stripe | Creates pending checkout context and parent subscription metadata after payment/webhook | Receives synced subscription payload | Keep current path; do not broaden native operational writes |
| Parent subscription record | Customer App for app/account display; Stripe for billing status | `Subscription` stores customer email, plan, bundle, delivery address, status, next delivery, Stripe ids, Hub sync state | Hub operational order links to Stripe/customer app subscription ids | Mirror/coordination only; not enough for occurrence-level native ownership |
| Billing / recurring charge | Stripe | `stripeWebhook` handles subscription invoice events and parent subscription creation/dedupe | Hub receives paid subscription event through Customer App sync | Provider-owned; no native migration writes without stronger shadow/parity plan |
| Fulfillment occurrence identity | Hub | `PendingSubscriptionCheckout` has first/cycle context; `ShopifyOrder`/`FulfillmentTask` have occurrence-capable fields but native writes are blocked | Hub `ShopifyOrder.fulfillments` and `FulfillmentTask.fulfillment_number` represent operational occurrences | Major blocker; needs exact occurrence preview |
| Delivery task generation | Hub | Native `FulfillmentTask` schema supports subscription ids and fulfillment numbers, but native materialization blocks subscription orders | Hub creates/dedupes fulfillment tasks per fulfillment | Keep Hub-owned |
| Production demand | Hub | Customer App native production demand preview blocks subscription/multi-delivery | Hub production planning enumerates subscription fulfillments and production components | Keep Hub-owned; avoid duplicate demand |
| Production batch/compliance history | Hub for subscriptions | Customer App mirrors/previews for one-time flows only | Hub batches can include subscription order sources | Keep Hub-owned; no native deduction/PO linkage |
| Skips / pauses / future cancellations | Customer App initiates; Stripe/Hub enforce operational result | Customer App functions call Stripe and notify Hub; current cycle should remain intact | Hub marks future intent and preserves current tasks/batches | High risk; not a native write candidate |
| Immediate cancellation/refund | Stripe/Hub source of truth | Customer App `stripeWebhook` has subscription refund path and Hub notification/logging | Hub `processStripeRefund` cascades full refunds and queues partial refunds | Keep Hub-owned; preview only |
| Notifications | Customer App + existing Hub/customer flows | Subscription pages and webhook paths can invoke customer notifications | Hub operational status may feed Customer App views | Held for native expansion; duplicate notification risk |
| Admin exception handling | Hub/admin tools plus Customer App repair helpers | Many repair helpers are disabled or high-risk | Hub has repair/reconciliation functions | Hold broad migration; use preview-first parity |

## 4. Customer App ownership and gaps

### Customer App owns or participates in

- Subscription checkout UX and pending checkout staging.
- Parent `Subscription` creation/dedupe from Stripe subscription events.
- `Subscription.status` values: `active`, `paused`, `cancelled`.
- `cancel_at_period_end`, `cancel_effective_date`, `next_delivery_date`, `paused_until` display/control fields.
- Hub sync status fields on `Subscription`.
- Account-facing subscription management page.
- Customer App admin/customer views that merge Hub and local context.
- Read-only native order/refund/production previews for one-time flows.

### Customer App does not safely own yet

- Canonical subscription occurrence identity.
- Broad recurring fulfillment generation.
- Native subscription fulfillment task creation.
- Native subscription production demand materialization.
- Subscription production batch recalculation.
- Subscription refund/cancel cascade.
- Subscription notification expansion from native operational changes.
- Provider-origin subscription billing state beyond current Stripe webhook paths.

### Key schema/readiness observations

- `Subscription` is parent-level and not occurrence-level.
- `PendingSubscriptionCheckout` contains first fulfillment and cycle decomposition context, but is not a durable operational occurrence source.
- Customer App `ShopifyOrder` has subscription/multi-delivery fields: `order_type`, `fulfillment_mode`, `fulfillments`, `stripe_subscription_id`, `subscription_parent_id`, `fulfillment_instance_date`, `fulfillment_sequence_number`.
- Customer App `FulfillmentTask` has occurrence-capable fields: `stripe_subscription_id`, `customer_app_subscription_id`, `fulfillment_number`, `delivery_date`, `scheduled_date`, `production_date`, `items`.
- Those fields are useful for preview/mirror parity, but not sufficient to authorize native subscription writes because Hub is still generating operational fulfillment tasks and production demand.

## 5. Hub ownership and behavior map

Hub subscription behavior from source audit:

- `customerAppEventPublicGateway` accepts `customer.subscription_created` events from Customer App.
- It validates required subscription fields and schedule output.
- It creates or dedupes a Hub operational `ShopifyOrder` for the Stripe subscription.
- It stores multi-delivery occurrences in `ShopifyOrder.fulfillments`.
- It creates or dedupes Hub `FulfillmentTask` records per fulfillment number / scheduled date.
- It can trigger batch demand for subscription production dates.
- It has quarantine guards for retired/refunded/excluded subscription orders.
- Hub production planning enumerates subscription fulfillments into production rows.
- Hub future-cancel/future-pause preserves current cycle tasks and batches.
- Hub refund processing handles partial refunds by review queue and full refunds by cascading order/task/batch mutation.

This makes Hub the operational source of truth for subscription occurrence execution today.

## 6. Subscription lifecycle map

| Stage | Current behavior | Classification | Notes / required migration work |
| --- | --- | --- | --- |
| 1. Subscription creation | Customer App checkout/webhook creates parent `Subscription` and sends subscription event to Hub | Customer App + Hub split | Customer App parent creation is live; Hub operational creation remains source of truth |
| 2. Customer setup / account completion | Customer App owns account/profile UX; Hub receives customer/order context | Customer App candidate for profile only | Not an occurrence migration blocker by itself, but identity drift affects subscription matching |
| 3. Subscription payment | Stripe owns payment state; Customer App webhook creates/updates records | Provider-owned / high-risk | No native billing rewrite; no provider calls in previews |
| 4. Renewal / recurring charge | Customer App invoice webhook path can create/dedupe subscription and sync Hub | High-risk | Needs provider event parity and idempotency before native ownership |
| 5. Fulfillment occurrence generation | Hub creates/dedupes operational order and tasks from fulfillment array | Hub source of truth | Major G36 blocker; needs single-occurrence read-only preview first |
| 6. Production planning | Hub production planning enumerates subscription fulfillment components | Hub source of truth | Native production demand blocks `subscription_multi_delivery_out_of_scope` |
| 7. Delivery task creation | Hub creates FulfillmentTasks; Customer App can display Hub/native route context | Hub source of truth | Native task creation preview blocks subscription orders |
| 8. Delivery completion | Hub/operations own subscription delivery task status; Customer App displays merged context | Hub source of truth | Native one-time delivery commands are not generalized to subscriptions |
| 9. Skips / pauses | Customer App initiates pause/future-cancel paths; Stripe/Hub state changes occur | High-risk split | Current paid cycle must remain intact; no native subscription occurrence mutation |
| 10. Cancellations | Future cancellation differs from immediate/admin cancellation | High-risk split | Parent-level vs occurrence-level ambiguity must be previewed explicitly |
| 11. Refunds / partial refunds | Hub refund source of truth; Customer App refund preview/shadow exists for one-time context | High-risk | Subscription refunds can affect parent subscription, tasks, batches, loyalty, Hub state |
| 12. Failed payment / repair | Multiple Customer App and Hub repair helpers exist, many disabled/high-risk | Held | Do not include in first native subscription preview |
| 13. Customer notifications | Existing paths can notify subscription lifecycle/payment events | High-risk | Notification duplication risk; native subscription previews must default to held/no notification |
| 14. Admin review / exceptions | Hub review/repair tools plus Customer App repair/diagnostic functions | Hub/source-specific | Need exact preview and owner-approved runbooks before any writes |

## 7. Customer App vs Hub ownership table

| Capability | Customer App current role | Hub current role | Native migration position |
| --- | --- | --- | --- |
| Parent subscription display | Owns account-facing record | Mirrors/uses ids for operations | Keep Customer App parent display; not enough for operational takeover |
| Subscription plan/bundle metadata | Owns plan/bundle entities | Uses plan/products in received payloads | Mirror/reference only |
| Fulfillment decomposition | Customer App can calculate/send fulfillment array | Hub accepts and persists operational occurrences | Preview parity needed before any native generation |
| Fulfillment task creation | Schema supports fields; native materialization blocks subscriptions | Creates/dedupes per fulfillment | Keep Hub-owned |
| Production demand | Native one-time preview only; subscriptions blocked | Enumerates subscription fulfillments | Keep Hub-owned |
| Delivery queue | Customer App displays Hub/native route summary | Hub-backed operational tasks | Keep merged display; no native subscription writes |
| Cancellation / pause | Customer App customer actions call Stripe/Hub paths | Hub marks future intent/preserves current cycle | High-risk; do not migrate first |
| Refund | G35 previews/shadow exist; source-of-truth remains Hub | Partial review/full cascade | Keep Hub source of truth |
| Repairs/replays | Some Customer App helpers exist; disabled/held/high-risk | Multiple repair/reconciliation tools | Exclude from native eligibility |
| Notifications | Existing Customer App paths may notify | Operational status may drive customer context | Held by default |

## 8. Multi-delivery risks

Specific risks that block broad native migration:

1. **Parent vs occurrence identity** — parent subscription id, Stripe subscription id, Hub order id, fulfillment number, delivery date, and Customer App/native ids can point to different lifecycle layers.
2. **Duplicate task generation** — Customer App native task creation could duplicate Hub `FulfillmentTask` rows for the same fulfillment number/date.
3. **Delivery date drift** — subscription schedule engines, Hub operational dates, Customer App pending checkout dates, and admin corrections can diverge.
4. **Customer-facing status confusion** — parent subscription status does not equal each occurrence status.
5. **Production demand duplication** — native production planning could double-count Hub subscription fulfillment demand.
6. **Refund/cancellation ambiguity** — a refund or cancel may apply to one occurrence, current paid cycle, future renewals, or the whole subscription.
7. **Notification duplication** — native actions could send duplicate customer messages already sent by webhook/Hub/subscription flows.
8. **safeSync collisions** — existing safeSync logic recognizes subscriptions and hard-locks some fields; broad native updates could conflict with Hub or Stripe-owned fields.
9. **Hub/native split-brain** — Hub may quarantine/retire a subscription while Customer App still has an active parent record or stale pending checkout state.
10. **Historical repair/replay risk** — disabled/legacy repair functions show prior complexity; broad repair migration is not safe.
11. **Schedule changes** — skips, pauses, and route/date corrections require occurrence-level identity and current-cycle policy.
12. **Compliance/history preservation** — verified batches and delivery history must never be deleted or silently rewritten by subscription refund/cancel logic.

## 9. Native subscription eligibility policy draft

A future native subscription occurrence preview may be eligible only when all are true:

- Exact `stripe_subscription_id` or Customer App `subscription_id` is known.
- Exact occurrence identity is known: `fulfillment_number`, `occurrence_id` if available, and delivery date.
- Exact Customer App parent `Subscription` id is known if present.
- Exact Hub operational order id or order number is known if present.
- Exact Customer App/native `ShopifyOrder` id is known if present.
- Exact native/Hub `FulfillmentTask` id is known if present.
- Payment/charge state is clear from local records or already-approved safe preview input.
- Delivery occurrence date and production date are clear.
- Line items/products for the occurrence are present and decomposed to per-fulfillment quantities.
- No active repair, replay, sync retry, refund, cancellation, or pause ambiguity exists.
- No duplicate task/order context exists.
- Hub fallback/source-of-truth remains active.
- Preview returns no blockers and read consistency is stable.
- Notifications remain held.
- Provider calls remain false.
- No inventory deduction or PurchaseOrder automation is involved.

Exclude from early native subscription migration:

- Broad recurring automation.
- Parent-level cancellation commands.
- Partial refunds and refund/cancel cascades.
- Failed-payment repair flows.
- Historical repairs/backfills/replays.
- Ambiguous occurrence mapping.
- Multi-address or route-review ambiguity.
- Notification expansion.
- Provider calls.
- Hub mutations.
- Inventory deduction or PurchaseOrder automation.

## 10. Migration strategy options

### Option A — Keep Hub source of truth for subscriptions

Safest short-term option. Customer App continues to show account/admin context and can use read-only parity previews. Hub continues to own operational fulfillment/task/batch behavior.

Pros:

- Avoids duplicate delivery tasks and production demand.
- Preserves existing Hub cancellation/refund policies.
- Avoids provider/billing ownership changes.
- Keeps customer notification risk contained.

Cons:

- Hub retirement remains blocked for subscriptions.
- Customer App remains dependent on Hub operational views.

### Option B — Native read-only subscription occurrence preview

Recommended next technical step. Customer App computes a parity view for a single exact subscription occurrence without writes.

Pros:

- Builds evidence for migration without changing operations.
- Forces explicit parent/occurrence id mapping.
- Can surface duplicate task/demand risks before command design.

Cons:

- Does not retire Hub by itself.
- Requires careful Hub/Customer App read consistency and safe payload summaries.

### Option C — Controlled exact subscription occurrence pilot

Possible later only after G36B preview proves a specific occurrence is clean and owner approval is explicit.

Pros:

- Could migrate one controlled occurrence.

Cons:

- Still high risk if Hub batch/delivery/notification ownership is not isolated.

### Option D — Broad native subscription automation

Not ready.

Risks:

- Recurring task duplication.
- Production demand duplication.
- Provider state drift.
- Notification duplication.
- Refund/cancel split-brain.

## 11. Recommended strategy

Use Option A now and Option B next:

1. Keep Hub source of truth for all subscription / multi-delivery operational behavior.
2. Add a read-only `previewNativeSubscriptionOccurrenceParity` phase next.
3. Do not create native subscription fulfillment writes yet.
4. Do not run broad subscription sync/replay/repair.
5. Do not connect subscription migration to refund commands, inventory deduction, PurchaseOrder automation, or notifications.

This keeps momentum toward Hub retirement while respecting the current operational boundary.

## 12. Future preview contract

Suggested function:

```text
previewNativeSubscriptionOccurrenceParity
```

Suggested inputs:

```text
subscription_id
stripe_subscription_id
order_number
hub_order_id
occurrence_id
fulfillment_number
customer_app_order_id
native_shopify_order_id
native_fulfillment_task_id
delivery_date
production_date
preview_mode
request_id
```

Suggested response:

```text
success
dry_run:true
writes_performed:false
preview_mode:NATIVE_SUBSCRIPTION_OCCURRENCE_PARITY
subscription_present
hub_subscription_present
customer_app_subscription_present
occurrence_present
occurrence_identity
hub_operational_order_present
customer_app_subscription_parent_present
native_order_present
native_task_present
hub_task_present
production_demand_preview
delivery_task_preview
batch_history_preview
refund_cancellation_risk
notification_impact
provider_call_impact:false
hub_fallback_required:true
blockers
warnings
next_action
```

Required preview separations:

- parent subscription impact
- single occurrence impact
- delivery task impact
- production demand impact
- batch/compliance history impact
- refund/cancellation policy impact
- notification impact
- Hub fallback/source-of-truth impact

No writes are allowed.

## 13. Remaining blockers table

| Blocker | Status | Classification | Required next step |
| --- | --- | --- | --- |
| Parent vs occurrence identity | Known | High risk | Build exact occurrence preview |
| Native subscription task creation | Blocked intentionally | Held | Keep blocked until preview proves no duplicate Hub task |
| Native subscription production demand | Blocked intentionally | Held | Keep blocked until occurrence-level production preview exists |
| Billing/payment ownership | Known | High risk | Stripe remains provider source of truth; no provider calls in previews |
| Subscription refund/cancel ownership | Known | High risk | Keep Hub refund source of truth; no native cascade |
| Partial refund occurrence handling | Known | Held | Use G35 preview/review policy; no subscription write expansion |
| Future cancel/pause semantics | Known | High risk | Preserve current cycle; preview only |
| Delivery date drift | Known | Preview-ready | Compare Customer App/Hub/native dates in G36B |
| Fulfillment number/id mapping | Known | Needs preview | Require exact `fulfillment_number` and date |
| Duplicate task risk | Known | High risk | G36B should detect existing Hub/native tasks |
| Duplicate production demand risk | Known | High risk | G36B should detect existing Hub batches/demand |
| Notification duplication | Known | Held | Notifications held by default |
| Hub repair dependencies | Known | Held | Exclude from G36B |
| Admin UI parity | Known | Preview-ready | Show read-only occurrence parity only if useful |
| Monitoring/read consistency | Known | Needs preview work | Include read consistency metadata in future preview |
| Inventory/PO effects | Known | Held | Keep inventory deduction and PO automation out of scope |

## 14. Hard stops

Stop before any native subscription write if any of the following is true:

- Exact subscription and occurrence identifiers are missing.
- Hub source-of-truth/fallback would be disabled.
- Preview is unstable, incomplete, or has read consistency blockers.
- Occurrence date or fulfillment number is ambiguous.
- Existing Hub task or production demand could be duplicated.
- Refund/cancellation/partial refund state is active or ambiguous.
- Failed payment or repair/replay context is present.
- Provider calls would be required.
- Notification sends would be required.
- Customer-facing parent status would be changed to represent an occurrence state.
- ProductionBatch or BatchComplianceLog history would be deleted or altered.
- Inventory deduction or PurchaseOrder automation would be triggered.
- Broad recurring automation or batch migration is requested.
- Owner approval is missing for any future controlled write.

## 15. Recommended next phase

Recommended next phase: **G36B — subscription occurrence parity preview**.

G36B should be read-only and exact-targeted. It should compare one subscription occurrence across:

- Customer App parent `Subscription`
- Customer App/native `ShopifyOrder` mirror if present
- Customer App/native `FulfillmentTask` if present
- Hub operational `ShopifyOrder`
- Hub `FulfillmentTask`
- Hub production planning / batch demand context

G36B should return blockers/warnings and no-write impact, but must not create or update any record.

Alternative if migration velocity is needed elsewhere: hold subscription migration and continue one-time order generalization. Broad subscription migration should remain held.
