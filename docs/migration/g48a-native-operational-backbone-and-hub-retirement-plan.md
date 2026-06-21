# G48A: Native operational backbone and Hub retirement decision plan

## 1. Executive decision summary

G48A changes the migration strategy from “mirror the Hub one behavior at a time” to “build a native operational backbone that can safely replace Hub behavior where it is actually needed.”

Final classification:

```text
native_operational_backbone_architecture_decided
```

Architecture decisions:

1. **Use a hybrid identity/linkage model.** Keep exact additive links on existing entities now, and introduce a dedicated identity/linkage model only when schema publication and operational ownership are ready. Do not rely on fuzzy matching, newest-record selection, customer name, phone, or partial email.
2. **Treat `CommandLog` as audit evidence, not an atomic lock.** It remains useful for observability and exact-command idempotency evidence, but it does not solve Base44 filter-then-create races.
3. **Block high-risk create flows that require atomic reservation.** Production Apple Pay payment confirmation remains blocked until Base44 provides atomic create-if-absent/unique constraints or ownership explicitly accepts residual risk.
4. **Separate native state changes from side effects.** Hub writes, Shopify calls, Stripe calls, route-provider calls, notifications, and loyalty/credit mutations must not be bundled into unproven state mutations.
5. **Use shared backend read-model functions first.** Customer/admin pages should converge on stable read contracts rather than page-specific Hub/native merging.
6. **Retire Hub by domain, not globally.** Hub reads and writes remain active until each domain has native identity, native read model, exact write command where needed, side-effect control, smoke proof, rollback/no-op behavior, and owner-approved cutover.

Current constraints incorporated:

- Apple Pay production payments remain blocked by Base44 platform atomicity.
- PR #545 remains draft, blocked, unmerged, and unpublished.
- Subscription occurrence schemas are merged in Git but not live because scoped schema publication is unavailable.
- G46C subscription reads remain blocked.
- G42B found no clean delivery action command candidates.
- G43B/G43C customer order surfaces remain exact-allowlist based.
- G45C Rewards reads are deployed disabled pending owning-customer smoke.
- Hub writes and fallback remain active.
- Refunds/payments, subscriptions/multi-delivery, inventory/PO, repair/replay, and notifications remain held.

Selected first implementation package after G48A:

```text
G48B — shared native identity and read-model foundation
```

Reason: it removes repeated blockers across customer order surfaces, delivery, production/compliance, admin orders, and future subscription occurrence work without requiring unavailable Base44 atomicity or unsafe broad schema publication. It can be default-off/read-only first and preserve current live behavior.

## 2. Current-state architecture

Current production reality is a transitional mixed system:

```text
Customer App UI
→ Base44 functions/entities
→ native Customer App records where available
→ Hub fallback / Hub writes where still authoritative
→ provider calls in selected legacy functions
```

The current repo contains many Hub bridge and sync functions, including order sync, subscription sync, loyalty sync, delivery status sync, event sync, refund sync, repair/replay, and manual backfill functions. Several surfaces have native-first or limited-native reads, but Hub fallback is still necessary for unsupported rows and high-risk domains.

High-signal current states:

| Domain | Current state |
| --- | --- |
| Events | Customer events can be backend/native-driven; Hub event bridge was re-enabled for Event population. |
| Admin production planning | Native-first reads are live. |
| Admin delivery route summary | Native-first read summary with Hub fallback is live. |
| Delivery actions | G42B found no clean native command candidates. Hub actions remain active. |
| Compliance | Native records exist; compliance remains partially ready pending exact locked QC proof. |
| Customer order history | G43B limited native enrichment is exact-allowlist based. |
| Customer tracker | G43C limited native enrichment is live only for `NV-MQHJR3V2`; `NV-MPZNKGNT` requires owning-customer smoke. |
| Rewards | G45C limited native reads are deployed disabled pending owning-customer smoke. |
| Subscriptions | G46C reads blocked; no active native parents; occurrence schema not live. |
| Checkout / Apple Pay | Side-effect-free diagnostic works; production payment activation blocked by Base44 atomicity. |
| Refunds/payments | Hub/payment remains source-of-truth. |
| Inventory/PO | Held. |
| Notifications | Held. |
| Repair/replay/backfill | Governed and retained as safety net. |

The weak pattern is repeated page/function-specific reconciliation. Each page rediscovers whether native records are safe, which causes duplicated matching logic, exact allowlists, bounded scan limitations, and repeated hard stops.

## 3. Selected target architecture

Target architecture:

```text
Provider event intake
→ controlled provider event ledger / checkout reservation where feasible
→ native operational entities
→ exact identity/linkage layer
→ native command layer with idempotency evidence
→ stable customer/admin read models
→ side-effect dispatcher for Hub/Shopify/notifications/providers
→ observability/manual review
```

Hub remains a temporary bridge:

- **Hub inbound bridge**: allowed where Hub is the upstream data source during transition, such as Events or legacy subscription/order context.
- **Hub outbound writes**: allowed only where current production behavior still depends on Hub.
- **Hub fallback reads**: preserved until native read models are complete and smoke-proven.
- **Hub suppression**: domain-by-domain only after retirement criteria are met.

Base44 limitations are explicit:

- No caller-supplied deterministic entity IDs.
- No schema-level unique/compound unique constraints.
- No atomic create-if-absent/upsert conflict primitive.
- No transaction/CAS/durable lock primitive.
- Scoped schema publish is not currently available for some required subscription occurrence fields.

Therefore this plan does **not** depend on unavailable atomic locks, durable transactional outbox guarantees, or schema publication that cannot currently be executed.

## 4. Source-of-truth map

| Domain | Target source of truth | Current transition rule |
| --- | --- | --- |
| Event display | Native `Event` entity/read model | Hub may populate Event; customer display uses native-safe formatting. |
| One-time customer order identity | Customer App `Order` canonical row + exact native links | Hub fallback for unsupported/risky rows. |
| Native operational order context | `ShopifyOrder` mirror + `FulfillmentTask` | Exact links only; no fuzzy matching. |
| Production | `ProductionBatch` | Exact lifecycle commands only; no broad command migration. |
| Compliance proof | `BatchComplianceLog` linked to `ProductionBatch` | Native read only after exact locked batch/log proof. |
| Delivery operational state | `FulfillmentTask` and future delivery/proof model | Hub actions retained until native commands are clean. |
| Customer delivery/tracker status | Customer App read model | No status cascade without separate approval. |
| Rewards | Native loyalty/rewards read model | G45C remains deployed disabled pending customer smoke. |
| Subscriptions | Future `Subscription` parent + occurrence chain | Blocked until future occurrence chain exists live. |
| Payments/refunds | Stripe/payment + Hub/payment policy | Do not switch authority yet. |
| Checkout reservation | Platform-dependent atomic reservation | Apple Pay confirmation blocked. |
| Inventory/PO | Native inventory/procurement model | Held. |
| Notifications | Explicit notification policy/outbox | Held. |
| Repair/replay | Manual-review safety tooling | Retain until native retirement criteria are met. |

## 5. Identity/linkage design

### Decision: hybrid model

Selected option:

```text
hybrid: additive exact linkage fields now, dedicated identity/linkage entity later when platform/schema constraints allow
```

Why not only additive fields:

- Additive fields are quickest and already partially present, but repeated matching logic still spreads across functions.
- Some links cross several domains and need consistent classifications.

Why not only a dedicated entity now:

- New schema/entity rollout is constrained by Base44 publication limitations.
- A linkage entity without uniqueness/atomicity would not by itself prevent duplicate links.

### Canonical and exact link contracts

| Object | Canonical identifier | Required exact links | Optional links | Immutable/internal rule |
| --- | --- | --- | --- | --- |
| Customer App Order | `Order.id` | `order_number` normalized exactly | Hub order id, Stripe checkout/session refs | Customer-visible row identity remains canonical; created date/totals/line items preserved. |
| Native ShopifyOrder | `ShopifyOrder.id` | `base44_order_id` or `customer_app_order_id`; exact `shopify_order_number` | Shopify provider id | Internal-only native id unless already safe. |
| FulfillmentTask | `FulfillmentTask.id` | `order_id` or `base44_order_id`; `native_shopify_order_id` or `shopify_order_id`; exact `order_number` | route/driver fields | Required for tracker/delivery operational context. |
| ProductionBatch | `ProductionBatch.id` | `batch_id`; order/source links where applicable | related orders/order_sources | Batch lifecycle source for production. |
| BatchComplianceLog | `BatchComplianceLog.id` | `source_production_batch_id` and/or exact `batch_id` | `verified_by`, `verified_at` | Locked log is compliance proof; raw notes are not customer-visible. |
| Delivery route/task | `FulfillmentTask.id` plus future route/proof id | exact task and order links | route stop, proof/drop fields | Provider/proof fields internal unless policy permits. |
| Subscription parent | `Subscription.id` | customer ownership + provider subscription id where safe | Hub subscription id | Not a valid customer order by itself. |
| Subscription occurrence | future occurrence id | parent id + cycle id + Customer App Order id + native order id + task id | skip/cancel metadata | Required before G46C reads. |
| Stripe payment attempt | PaymentIntent id, not exposed broadly | checkout/customer/order reservation | idempotency key | Requires atomic reservation for production Apple Pay confirmation. |
| Hub legacy record | Hub id/order number | exact native link where retained | legacy status fields | Transitional only. |

Duplicate or ambiguity handling:

- If zero exact links: fallback/review, not native-primary.
- If multiple exact links: manual review, not newest-record selection.
- If customer ownership cannot be proven before eligibility: no customer-facing native enrichment.
- If linkage relies on customer name, phone, partial email, approximate total, approximate date, or display label: reject.

Customer-visible vs internal-only:

- Customer-visible: order number, product/line item summaries, customer-safe dates/status labels, totals already in the customer contract.
- Internal-only: native ids, provider ids, fallback reasons, review-required flags, mismatch fields, raw Hub/provider payloads, CommandLog payload/result, ProductionBatch internal lifecycle status.

## 6. Command and idempotency design

### Decision: CommandLog is audit evidence, not a lock

`CommandLog` remains useful for:

- request/audit trail;
- idempotency evidence;
- exact target proof;
- rollback/no-op documentation;
- operator observability.

But `CommandLog` does **not** provide atomic reservation because Base44 filter-then-create is non-atomic.

### Write paths safe today

Can remain exact-gated/default-off:

- exact `ProductionBatch` start/complete/verify commands;
- exact `FulfillmentTask` lifecycle commands where identity, idempotency, rollback/no-op, and policy are proven;
- exact admin-safe corrections with one target and no provider/notification side effects;
- exact read-model previews.

### Paths blocked by atomicity

Blocked until Base44 support or explicit risk acceptance:

- production Apple Pay confirmation path that creates a PaymentIntent and pending/customer order/reservation;
- any create path requiring exactly-once semantics under double-click/retry/webhook concurrency;
- generic checkout reservation;
- broad Hub write suppression that depends on creating native records as a replacement without unique constraints.

### Operations not activated without platform support

- Apple Pay production payment confirmation through current deferred-intent backend.
- Atomic checkout reservation.
- Any design that claims `filter → create` is idempotent under concurrency.

## 7. Side-effect / outbox design with Base44 limitations

### Decision: separate side effects, but do not claim durable transactional outbox yet

Target separation:

```text
native state mutation
→ side-effect intent/audit
→ Hub write / Shopify call / Stripe call / route provider / notification / loyalty mutation
```

Base44 limitation: without transactions or atomic create-if-absent, a fully durable exactly-once outbox is not currently guaranteed.

Interim best-effort contract:

- Low-risk exact commands may record intended side effects in command results/audit metadata.
- Provider/Hub/notification calls remain separately gated.
- High-risk domains must remain blocked if the side effect cannot be safely retried or deduped.
- Outbox-like execution must include request id, target id, idempotency evidence, status, retry count, last error, and manual-review escalation.

Domains that may use interim best-effort side-effect separation:

- read-only previews;
- exact admin lifecycle commands with no provider call;
- exact notification preview only;
- exact Hub shadow previews.

Domains that remain blocked:

- Apple Pay production confirmation;
- refund/payment authority switch;
- subscription/multi-delivery authority switch;
- broad Hub suppression;
- inventory deduction/PO automation;
- route provider writes;
- notification expansion tied to unproven status mutation.

## 8. Customer/admin read-model design

### Decision: shared backend read-model functions first

Use shared backend read-model functions and shared identity helpers before introducing precomputed read-model entities. Precomputed entities can be considered later only when schema publication and idempotency are reliable.

| Surface | Target read model | Current transition |
| --- | --- | --- |
| Customer order history | Shared customer order-history read model | G43B exact allowlist remains; future G48B helper replaces repeated matching. |
| Customer tracker | Shared order-detail/tracker read model | G43C exact allowlist remains; task matching uses exact links. |
| Customer Rewards | Shared rewards read model | G45C deployed disabled pending smoke. |
| Customer subscriptions | Shared subscription occurrence read model | Blocked until future occurrence chain exists. |
| Admin orders | Shared admin order chain read model | Limited native-primary diagnostics; Hub fallback active. |
| Admin production planning | Existing native-first backend read | Keep; consume shared identity later for order/batch links. |
| Admin delivery | Native route summary + future delivery lifecycle read model | G42B says commands held; reads stay native-first/fallback. |
| Admin compliance | ComplianceOps summary + exact batch/log read parity | G41B preview path; writes/alerts held. |
| Operations dashboard | Aggregate read model from domain read models | Avoid direct page-specific Hub/native arithmetic. |
| Events | Native Event read model | Hub may populate Event; display/customer formatting native. |

Read response safety:

- Admin-only previews may include limited operational context when useful.
- Customer responses must never expose diagnostics, fallback reasons, native ids, raw payloads, or internal statuses.
- Live mutation responses stay stricter than read previews.

## 9. Preserve-versus-replace matrix

| Current Hub/native pattern | Preserve temporarily | Replace | Proposed replacement | Blocker | Package | Cutover criterion | Hub retirement criterion |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Order creation pushes/syncs to Hub | Yes | Yes | Native checkout/order reservation + provider event ledger | Base44 atomicity | E | Atomic reservation or accepted risk | Hub order write retired after native checkout proves exactly-once and downstream reads work. |
| Customer order history/tracker mixed reads | Yes | Yes | Shared customer order read models using exact identity | Identity coverage/customer ownership proof | A | Default-off read model matches current UI for safe rows | Hub read retired when all supported one-time rows native-safe and fallback unnecessary. |
| Production lifecycle wrappers | Limited exact pilots | Yes | Native `ProductionBatch` commands with CommandLog audit | Live proof per lifecycle | B | Exact command smoke and rollback/no-op proof | Hub production command retired after generalized exact native commands live. |
| Compliance general/native summary | Yes | Partially | Native batch/log read parity plus locked proof | Live QC proof | B | Exact locked batch/log candidate proven | Hub compliance read retired when native summaries cover required records. |
| Delivery action wrappers | Yes | Yes | Native delivery lifecycle commands | No clean G42B candidates; proof/drop/status policies | C | Exact clean task candidate + policies + idempotency | Hub delivery writes retired per action. |
| Subscriptions/multi-delivery | Yes | Yes | Future occurrence chain | Schema not live; no active native parents | D | Future live occurrence has full chain | Hub subscription read/write retired only after active occurrences prove native path. |
| Refund/payment source-of-truth | Yes | Eventually | Provider event ledger + native payment/refund model | Payment policy/risk | F/E | Exact refund/payment preview and owner policy | Hub/payment authority switch explicitly approved. |
| Loyalty/rewards sync | Yes | Yes | Native rewards read model and exact reward commands | Owning-customer smoke pending | A/F | G45C smoke passes and read model stable | Hub loyalty read/write retired after points parity proven. |
| Inventory/PO | Yes | Yes | Native inventory deduction and PO command model | Owner policy, exact ingredient/stock proof | F/B | Exact preview and owner approval | Hub inventory/PO retired after no-op/rollback proof. |
| Events Hub bridge | Yes as inbound | Yes | Native Event source/display contract | Need bridge/source consistency | A | Native Event records/display stable | Hub event display dependency retired; inbound bridge optional. |
| Notifications | Yes held | Yes | Notification policy + side-effect dispatcher | Owner policy | F | Exact notification preview + policy | Legacy notification paths retired per template/event. |
| Repair/replay/backfill | Yes | Later | Native manual-review playbooks and exact repair commands | Native domains incomplete | F | Native source-of-truth stable | Legacy repair retired after equivalent native safety exists. |
| Admin operations page aggregates | Yes | Yes | Aggregates built from domain read models | Incomplete read models | A/F | Domain read models complete | Hub aggregate reads retired per metric. |

## 10. Shared blocker/root-cause map

| Root cause | Affected domains | Repo-fixable | Requires Base44 | Requires owner policy | Requires live evidence | Resolution |
| --- | --- | --- | --- | --- | --- | --- |
| Missing exact identity | Customer orders, delivery, production/compliance, admin orders, subscriptions | Yes | Sometimes schema publish | No | Yes | G48B shared identity/read-model helper and exact-link contracts. |
| Missing atomic reservation | Checkout, Apple Pay, exactly-once creates | Partially no | Yes | Or risk acceptance | Yes | Keep payment activation blocked; request platform primitive. |
| Missing schema publication path | Subscription occurrence | No | Yes | No | Yes | Keep G46C blocked; use docs/fixtures until schema can publish. |
| Inline side effects | Checkout, delivery, notifications, Hub writes, Shopify calls | Yes | For durable outbox yes | Yes | Yes | Separate native state from side effects; exact policies. |
| Page-level Hub/native merging | Customer/admin reads, operations dashboard | Yes | No | No | Yes | Shared read-model functions. |
| Status cascade coupling | Production→order/task, delivery→customer, compliance→status | Yes | No | Yes | Yes | Preview cascades first; customer status separately approved. |
| Incomplete read models | Customer surfaces, subscriptions, operations dashboard | Yes | Sometimes | No | Yes | G48B then domain packages. |
| Incomplete owner-session proof | Rewards, `NV-MPZNKGNT` tracker | No | No | Owner session needed | Yes | Smoke with owning accounts only. |
| Lack of natural live candidates | Delivery, subscriptions, compliance | No | No | Sometimes | Yes | Wait for native-born/owned live candidates; do not fake production. |
| Repair/replay ambiguity | Hub suppression, customer reads, subscriptions | Yes | No | Yes | Yes | Manual-review classifications and exact repair command design. |

## 11. Coherent implementation packages

### Package A — Native identity and read-model foundation

Purpose:

- centralize exact linkage and matching;
- remove repeated page-specific reconciliation;
- define shared customer/admin read contracts.

Scope:

- one-time order identity graph helpers;
- order/task/native-order linkage helpers;
- safe matching rules;
- shared blocker/review classifications;
- read-model contracts for customer/admin order surfaces;
- no writes by default.

Prerequisites:

- none beyond current repo.

Dependencies:

- `Order`, `ShopifyOrder`, `FulfillmentTask`, `OrderReviewQueue`, `OrderSyncLog`, `SafeSyncParityLog`.

Platform blockers:

- none for read-only/default-off implementation.

Owner inputs:

- customer-safe status wording only if UI behavior later changes.

Acceptance criteria:

- existing G43B/G43C/G42B/G47B matching logic can use shared classifications;
- no customer-visible diagnostics;
- no write behavior changes;
- exact ownership filtering remains before eligibility.

Rollback:

- disable/default-off; preserve current page behavior.

Hub during transition:

- fallback active; allowlists unchanged.

Estimated migration impact:

- high; removes duplicated blocker logic across many future phases.

### Package B — Production and compliance lifecycle

Purpose:

- connect `ProductionBatch → BatchComplianceLog → admin compliance/production reads`;
- keep exact commands separate and gated.

Prerequisites:

- real production/QC proof or exact locked batch/log candidate.

Platform blockers:

- no hard platform blocker for exact updates; broad create/idempotency still limited.

Owner inputs:

- QC/pass-fail policy and customer-facing status policy.

Acceptance criteria:

- exact locked batch/log read parity;
- production lifecycle commands proven exact;
- no customer status cascade without approval.

Rollback:

- exact command no-op/rollback where possible; otherwise manual review.

Hub during transition:

- compliance fallback active.

Estimated impact:

- medium/high for admin operations and production confidence.

### Package C — Delivery lifecycle

Purpose:

- assignment → route → out-for-delivery → delivered;
- customer status and notifications separate;
- provider calls last.

Prerequisites:

- natural clean delivery task candidate;
- exact identity chain;
- proof/drop policy;
- idempotency/rollback policy.

Platform blockers:

- none for exact single-target update; side-effect/outbox limited.

Owner inputs:

- proof/drop policy, customer status wording, notification policy.

Acceptance criteria:

- exact driver assignment candidate;
- exact out-for-delivery candidate;
- exact delivered candidate;
- no provider/notification/customer status side effects until approved.

Rollback:

- command-specific no-op/revert policy.

Hub during transition:

- delivery actions stay Hub-active.

Estimated impact:

- high but blocked by lack of clean candidates.

### Package D — Subscription occurrence chain

Purpose:

- parent → occurrence → Customer App Order → native ShopifyOrder → FulfillmentTask;
- future-only;
- no cancelled historical backfill.

Prerequisites:

- subscription occurrence schema live;
- future active subscription occurrence with full chain.

Platform blockers:

- scoped schema publication unavailable.

Owner inputs:

- occurrence lifecycle policy.

Acceptance criteria:

- future occurrence has exact parent/cycle/order/native-order/task linkage;
- skip/cancel affects exact occurrence only;
- no historical cancelled record used as pilot.

Rollback:

- exact occurrence hold/manual review.

Hub during transition:

- Hub remains subscription source-of-truth.

Estimated impact:

- high for subscription migration, currently blocked.

### Package E — Checkout/payment architecture

Purpose:

- resolve checkout reservation and Apple Pay production payment activation.

Prerequisites:

- Base44 atomic reservation primitive or owner risk acceptance.

Platform blockers:

- atomic create-if-absent/unique constraint missing.

Owner inputs:

- risk decision if platform support is unavailable.

Acceptance criteria:

- exactly one reservation/order/payment attempt per checkout intent under retries;
- no duplicate pending orders;
- no unsafe PaymentIntent/order race.

Rollback:

- cancel PaymentIntent and approved pending-order cleanup path.

Hub during transition:

- existing card checkout and Hub writes remain active.

Estimated impact:

- critical but platform-blocked.

### Package F — Side effects and Hub retirement

Purpose:

- separate Hub/Shopify/notification/provider effects from core state;
- retire Hub writes domain-by-domain.

Prerequisites:

- domain read model and native command proof.

Platform blockers:

- durable exactly-once outbox limited without atomicity.

Owner inputs:

- notification/provider/Hub suppression policy.

Acceptance criteria:

- side effects explicit, observable, retryable where safe;
- no provider calls bundled with unproven mutations;
- Hub suppression per domain only.

Rollback:

- re-enable Hub fallback/write path per domain.

Hub during transition:

- active until each domain retires.

Estimated impact:

- final retirement enabler.

## 12. Selected first implementation package

Selected next package:

```text
G48B — shared native identity and read-model foundation
```

Why this is first:

- It addresses the largest shared root cause: repeated exact identity and matching logic.
- It does not require Base44 atomicity.
- It does not require unsafe schema publication.
- It can be read-only/default-off first.
- It preserves current live behavior.
- It reduces future micro-phases across G43 customer order surfaces, G42 delivery, G41 compliance/production, G47 checkout diagnostics, and admin operations.

Expected PR scope:

- shared pure identity/readiness helpers;
- default-off preview mode or fixture-only proof first;
- no UI change;
- no schema change;
- no write commands;
- no Base44 publish unless runtime preview is explicitly approved later.

Expected runtime files, subject to source fit:

- `base44/functions/previewNativeOrderCutoverReadiness/entry.ts` for the first read-only proof mode, or a small shared helper module if Base44 function import patterns are confirmed safe;
- no new standalone Base44 function unless function-count constraints are explicitly waived.

Expected tests:

- exact Customer App Order ↔ native ShopifyOrder matching;
- exact ShopifyOrder ↔ FulfillmentTask matching;
- duplicate identity rejection;
- missing identity fallback;
- ownership-before-eligibility proof;
- no fuzzy matching;
- no customer-visible diagnostics;
- no raw payloads;
- no writes/providers/notifications/Hub mutation;
- regression compatibility with G43B/G43C/G42B/G47B fixtures.

Functions/pages that would eventually consume it:

- `getCustomerAccountDashboardData`
- `getCustomerOrderDetail`
- `getAdminOrdersWithHub`
- `getAdminDeliveryRouteSummary`
- `DeliveryQueue.jsx` native previews
- `previewNativeOrderCutoverReadiness`
- production/compliance previews where order/task linkage matters
- future subscription occurrence preview functions
- operations dashboard aggregate diagnostics

What it replaces:

- repeated page-specific native/Hub matching;
- repeated order/task/native-order blocker classifications;
- repeated exact allowlist-only reasoning where automatic eligibility can later be proven.

What remains unchanged:

- G43B/G43C allowlists;
- G45C deployed-disabled rewards state;
- G42 delivery Hub actions;
- G46 subscription holds;
- Apple Pay payment block;
- Hub writes/fallback;
- refund/payment/subscription/inventory/notification authority holds.

## 13. Domain scorecards

State definitions:

- `blocked`
- `planned`
- `preview-proven`
- `deployed-disabled`
- `exact-pilot-live`
- `limited-live`
- `generalized-live`
- `Hub-read-retired`
- `Hub-write-retired`

| Domain | Native identity complete | Native read model live | Native write command live | Side effects controlled | Smoke passed | Rollback/no-op proof | Hub fallback required | Hub outbound write required | Current state |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Events | partial | yes | n/a | inbound bridge only | yes for recent fixes | n/a | limited | yes inbound | `limited-live` |
| Customer order history | partial | limited | n/a | n/a | exact allowlist | n/a | yes | yes | `limited-live` |
| Customer tracker | partial | exact pilot | n/a | n/a | `NV-MQHJR3V2` only | n/a | yes | yes | `exact-pilot-live` |
| Rewards | partial | deployed disabled | n/a | n/a | pending | n/a | yes | yes | `deployed-disabled` |
| Subscriptions | no | no | no | no | no valid active native pilot | no | yes | yes | `blocked` |
| Checkout / Apple Pay | partial diagnostic | diagnostic only | blocked | no | diagnostic visible | cleanup not enough | yes | yes | `blocked` |
| Production planning | partial | yes | exact commands | partial | exact pilots | partial | yes | yes | `limited-live` |
| Compliance | partial | preview planned/proposed | exact verify command gated | no alerts expansion | pending locked QC proof | partial | yes | yes | `preview-proven` after G41B merge/publish |
| Delivery route reads | partial | yes | no | no | admin route summary | n/a | yes | yes | `limited-live` |
| Delivery actions | partial | preview only | no broad clean candidate | no | no | no | yes | yes | `planned/blocked` |
| Refunds/payments | partial | preview/shadow | no authority switch | no | exact previews only | no | yes | yes | `blocked` |
| Inventory/PO | partial | preview | no | no | no | no | yes | yes | `blocked` |
| Notifications | no | n/a | no | no | no | no | yes | yes | `blocked` |
| Admin operations dashboard | partial | diagnostics | no | n/a | partial | n/a | yes | yes | `preview-proven` |
| Repair/replay/backfill | n/a | n/a | legacy retained | n/a | n/a | n/a | yes | yes | `planned/retained` |

## 14. Hub retirement criteria

Hub read retirement per domain requires all of:

1. Native identity complete for supported records.
2. Native read model live and smoke-proven.
3. Customer/admin output contract preserved.
4. Unsupported/risky records still retained or explicitly routed to fallback/manual review.
5. No customer-visible diagnostics or internal ids.
6. Owner smoke where customer-owned data is involved.
7. Rollback path to re-enable Hub fallback.

Hub write retirement per domain additionally requires:

1. Native write command live for that domain.
2. Idempotency/no-op behavior proven for exact target.
3. Side effects separated and observable.
4. Notifications/provider calls separately approved.
5. Repair/replay replacement or retained emergency path.
6. No duplicate/missing record risk.
7. Post-cutover monitoring and rollback.

Global Hub retirement is not a near-term safe target. Domain retirement is the correct sequence.

## 15. Platform / owner / evidence dependencies

Platform dependencies:

- atomic create-if-absent / unique constraint / atomic upsert for checkout reservation;
- reliable schema publication for subscription occurrence fields;
- eventually better support for durable outbox semantics if exactly-once side effects are required.

Owner inputs:

- Apple Pay risk acceptance if Base44 atomicity is unavailable;
- notification policy;
- delivery proof/drop policy;
- customer-facing status wording;
- subscription occurrence behavior;
- refund/payment authority cutoff;
- inventory deduction and PurchaseOrder automation policy;
- Rewards owning-customer smoke;
- `NV-MPZNKGNT` owning-customer tracker smoke.

Natural live evidence needed:

- native-born one-time orders beyond exact pilots;
- real locked QC `ProductionBatch`/`BatchComplianceLog` pairs;
- clean delivery action candidate;
- future active subscription occurrence chain;
- customer-owned reward/account smoke.

## 16. Hard stops

Non-negotiable boundaries:

- No production Apple Pay payment activation without atomicity or explicit owner risk acceptance.
- No merge/publish of PR #545 while blocked.
- No historical subscription backfill from cancelled records.
- No broad Hub suppression.
- No refund/payment authority switch.
- No subscription/multi-delivery authority switch.
- No inventory deduction or PO automation.
- No notification expansion.
- No provider calls bundled with unproven state mutations.
- No fuzzy identity.
- No customer-visible diagnostics.
- No live command without exact target, idempotency evidence, rollback/no-op policy, and separate approval.
- No schema-dependent subscription read migration until schema is live.
- No delivery G42C command without a natural clean candidate and policy coverage.

## 17. Stop-work criteria

Pause these tracks now:

- further checkout anomaly scanning that does not resolve Base44 atomicity;
- PATCH2B while atomic reservation is blocked;
- additional G43 generalized scanner expansion until shared identity/read-model foundation exists;
- G42C delivery commands without a natural clean candidate;
- G46C before a future live occurrence chain and schema publish path;
- repeated wrapper functions that duplicate existing matching logic;
- broad Hub write suppression planning before domain read/write criteria are met.

Allowed to continue:

- exact read-only previews;
- docs/fixture proof;
- owner-session smoke for already deployed-disabled/exact-pilot surfaces;
- exact natural-candidate previews;
- platform support follow-up for atomicity/schema publication.

## 18. Implementation order without calendar promises

### First tranche

1. G48B shared native identity and read-model foundation.
2. Use G48B to simplify G43B/G43C/G42B/G47B-style matching and classifications.
3. Keep all existing allowlists and gates unchanged.

### Second tranche

4. Production/compliance exact read parity and lifecycle hardening when locked QC evidence exists.
5. Rewards owning-customer smoke and default-off activation decision.
6. Customer order read-model broadening only where G48B proves identity and ownership safely.

### Third tranche

7. Delivery lifecycle exact command candidates if natural clean tasks exist.
8. Subscription occurrence work only after schema publication and future live occurrence evidence.
9. Checkout/Apple Pay only after Base44 atomicity or owner risk decision.

### Fourth tranche

10. Side-effect/Hub suppression package per domain.
11. Notifications/provider calls last.
12. Repair/replay retirement only after equivalent native safety exists.

## 19. Recommendation

Adopt the native operational backbone architecture and stop treating Hub behavior as the design target.

Proceed next with:

```text
G48B — shared native identity and read-model foundation
```

G48B should be default-off/read-only first and should not alter live customer/admin behavior. It should create the shared identity/readiness contract needed to reduce repeated micro-phases and make later domain cutovers simpler and safer.

Do not start broad G43E/G43F, G42C, G46C, PATCH2B, or Hub write suppression before the G48B foundation or the listed hard prerequisites are satisfied.
