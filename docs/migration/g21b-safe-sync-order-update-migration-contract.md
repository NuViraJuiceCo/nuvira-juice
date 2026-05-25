# Phase G21B: Native Customer App safeSyncOrderUpdate Migration Contract

Date: 2026-05-25

Status: planning and parity-test contract only. No runtime code, schema, live data, Builder publish, Stripe call, Shopify call, sync, retry, repair, or live order mutation is included in this phase.

## 1. Scope And Controlling Decision

G21A established that the Customer App to Operations Hub bridge is transitional. The next critical retirement blocker is `safeSyncOrderUpdate`, because Hub still owns the only complete operational order write gateway.

G21B defines how to move that gateway into the Customer App backend without weakening:

- order identity resolution and idempotency
- source-based field ownership
- lifecycle locks
- subscription hard locks
- payment guardrails
- address quality quarantine
- production snapshot protection
- manual override protection
- OrderSyncLog and OrderReviewQueue auditability

This document is a contract and fixture plan. It intentionally does not create the native service, entities, tests, or migration code.

## 2. Current Hub safeSyncOrderUpdate Behavior Map

Current Hub file:

`NuViraJuiceCo/nuvira-juice-co-operations-hub/base44/functions/safeSyncOrderUpdate/entry.ts`

### Inputs

The Hub function currently accepts a JSON body with:

| Field | Current meaning | Native migration requirement |
| --- | --- | --- |
| `incomingData` | Partial `ShopifyOrder` payload to create/update. | Replace ad hoc raw object with typed `OrderWriteIntent`, but preserve compatibility mode during dark launch. |
| `source` | Source label controlling field ownership. | Continue using source labels, but derive them server-side for native internal callers. |
| `stripeEventId` | Event idempotency marker. | Preserve, and generalize to `idempotency_key` for non-Stripe events. |
| `matchBy` | Order lookup keys. | Preserve exact lookup order and add tests for every key. |
| `_internalSecret` | Internal function auth for selected Hub sources. | Retire after native migration; replace with internal service calls and provider/admin auth at boundaries. |

### Authorization

Current behavior:

- Internal calls are allowed only when `_internalSecret` matches `INTERNAL_FUNCTION_SECRET` and `source` is one of `rebuild_subscriptions`, `operations`, or `manual_recovery`.
- Non-internal calls require `base44.auth.me()`.
- Auth happens before writes.

Native requirement:

- No browser may call the native write service directly.
- External auth belongs at boundary functions only:
  - Stripe webhook signature for Stripe events.
  - Shopify HMAC for Shopify/POS events if retained.
  - authenticated admin session for admin repair.
  - scheduled job identity for internal retries.
- Internal service calls pass trusted context, not client-provided actor/source fields.

### Entity Dependencies

Current Hub reads/writes:

| Entity | Current use |
| --- | --- |
| `ShopifyOrder` | Finds existing order, creates new order, updates existing order. |
| `OrderSyncLog` | Writes success, rejected, skipped, and filtered-field audit rows. |
| `OrderReviewQueue` | Creates or dedupes quarantine incidents. |
| `FulfillmentTask` | Read-only fallback for address recovery in delivery orders. |

Current Customer App parity:

| Entity | Customer App status | Gap |
| --- | --- | --- |
| `ShopifyOrder` | Exists, but schema is smaller than Hub and lacks several operational fields. | Needs field parity for locks, snapshots, Stripe ids, address fields, source fields, audit, delivery/production metadata. |
| `OrderSyncLog` | Exists, but currently models Hub push status. | Needs unified event/write log fields or an `IntegrationEventLog` successor. |
| `OrderReviewQueue` | Missing in Customer App. | Must be added before native `safeSyncOrderUpdate` can preserve quarantine semantics. |
| `FulfillmentTask` | Exists, smaller than Hub model. | Must support address fallback and task links used by order safety logic. |
| `ProductionBatch` | Missing in Customer App. | Needed before production snapshot and production lifecycle ownership fully moves native. |

## 3. Core Guardrails To Preserve

| Guardrail | Current Hub behavior | Native Customer App requirement |
| --- | --- | --- |
| Stripe idempotency | If `stripeEventId` equals existing `stripe_event_id_applied`, returns skipped. New/existing orders store `stripe_event_id_applied`. | Preserve exact duplicate-event skip and add generalized command/event id idempotency for non-Stripe callers. |
| Identity resolution | Match priority: `stripe_subscription_id`, `stripe_checkout_session_id`, `stripe_payment_intent_id`, `shopify_order_id`, `internal_id`, then `shopify_order_number` as final duplicate safety. | Preserve priority and test every match path, including duplicate order-number prevention. |
| Fake Stripe guard | Rejects customer-app paid payloads with obvious placeholder/test Stripe ids. | Preserve for all native Customer App order ingestion paths. |
| Unknown quality gate | Rejects or quarantines unknown/incomplete payloads, especially when trying to overwrite a verified order. | Preserve with deterministic completeness scoring and queue incident ids. |
| New-order quality floor | Non-admin new orders must meet score threshold; subscription rebuilds require higher score. | Preserve and make threshold constants test-covered. |
| `LOCK_FROZEN_FIELDS` | Lock statuses freeze customer identity, Stripe subscription id, line items, fulfillments, prices, payment, and address fields depending on lifecycle. | Preserve exactly during parity; only change after separate owner-approved contract. |
| `FIELD_OWNERSHIP` | Source label filters fields not owned by that source. | Preserve source-specific allowlists and expose filtered fields in dry-run/test output. |
| Subscription hard lock | Prevents subscription source downgrade, `stripe_subscription_id` erase, line item erase, fulfillment erase. | Preserve. This is a non-negotiable anti-corruption guard. |
| Manual override guard | Customer App and rebuild sources cannot overwrite protected fields when `manual_override` is true. | Preserve. Admin-only path may append audit trail. |
| Payment downgrade block | Non-admin sources cannot downgrade `paid` to pending/unpaid/empty. | Preserve. Refund flow remains the approved downgrade path. |
| Pending-to-paid upgrade | `pending/null -> paid` is forced through even under locks. | Preserve, including tests under `production_scheduled` and `in_production`. |
| Field filtering | Unauthorized fields are deleted from write plan and counted in response/log. | Preserve with dry-run and golden-output tests. |
| Line item normalization | Strips quantity prefixes and price suffixes from titles. | Preserve for parity before changing product/title rules. |
| Preserve existing if incoming empty | Protects critical fields from blank/zero overwrite. | Preserve and test for address, totals, production status, audit trail, and override fields. |
| One-time line item guard | Non-authorized sources cannot replace one-time/single-delivery line items. | Preserve. |
| POS handling | POS orders skip address/production/delivery gates and become paid/fulfilled/not_required/fulfilled locks. | Preserve and route through a native POS adapter. |
| Address quality gate | Delivery order creation requires complete address unless POS; existing-order updates may proceed after warning. | Preserve and create `OrderReviewQueue` entry for missing new delivery address. |
| FulfillmentTask address fallback | Existing delivery order may recover address from matching task. | Preserve or replace with equivalent task/occurrence address lookup. |
| Production snapshot | Captures line_items/fulfillments when entering production scheduled, blocks later mismatches. | Preserve before native production lifecycle cutover. |
| Generated internal order id | New Customer App Stripe orders get stable fallback `shopify_order_id` from session, payment intent, or order number. | Preserve or rename as canonical operational order id, but maintain compatibility during dark launch. |
| OrderSyncLog | Logs creates, Stripe events, rejected/filtered fields, admin writes, and relevant successes. | Preserve with final unified log semantics. |
| OrderReviewQueue dedupe | Creates idempotency key from source, incident type, customer/order identifier; duplicate pending issues increment occurrence count. | Preserve exactly or improve with deterministic tests. |

## 4. Current Caller Map

| Current caller | Repo/path | Current source label | Payload shape | Idempotency | Queue/log behavior | Native replacement |
| --- | --- | --- | --- | --- | --- | --- |
| Stripe checkout/webhook hardened ingest | Hub `base44/functions/stripeCheckoutWebhookHardened/entry.ts` | `stripe_webhook` | Stripe-normalized order payload with payment, address, line items, ids. | `stripeEventId` from Stripe event id; `matchBy` Stripe ids. | `safeSyncOrderUpdate` writes `OrderSyncLog`; webhook may queue invalid events separately. | Customer App `stripeWebhook` boundary calls native service directly after signature verification. |
| Customer App paid order ingestion | Hub `base44/functions/ingestCustomerAppOrder/entry.ts` | `customer_app` | Customer App order payload mapped to Hub `ShopifyOrder`; may create tasks after success. | Match by checkout session, payment intent, order number. | Gateway logs; ingest creates downstream tasks outside gateway. | Native Customer App order creation should call service internally, then separate audited task generation. |
| Customer App event receiver | Hub `base44/functions/receiveCustomerAppEvent/entry.ts` | `customer_app` | `order.created`, subscription/customer/refund event payloads. | Uses session/payment id as event id where available. | Logs gateway result; creates task for one-time orders after success. | Retire bridge. Customer App event handler becomes internal function call. |
| Stripe session reconciliation | Hub `base44/functions/stripeSessionReconciliation/entry.ts` | `rebuild_subscriptions` | Rebuilt session metadata/order payload. | Session id as Stripe event id. | Logs through gateway; dry-run available in caller. | Customer App reconciliation dry-run calls native service in preview mode. |
| Shopify online webhook | Hub `base44/functions/shopifyOrderWebhook/entry.ts` | `stripe_webhook` | Shopify online order mapped to order payload. | Match by Shopify order id. | Gateway logs. | Customer App Shopify adapter, if retained, calls native service with `shopify_webhook` or compatible `stripe_webhook` until source refactor. |
| Shopify/POS ingest | Hub `base44/functions/ingestShopifyPOSOrder/entry.ts` and POS branch in `shopifyOrderWebhook` | Direct service-role create or POS path | POS payload. | Order id/order number. | Direct POS create logs `OrderSyncLog`; some POS paths bypass gateway. | Native POS adapter should route through safe service or a POS-specific wrapper that uses the same lock/quarantine/log library. |
| Driver status update | Hub `base44/functions/receiveDriverStatusUpdate/entry.ts` | `customer_app_driver` | Delivery status/proof/drop/status fields. | Match by `shopify_order_id`. | Gateway logs when applicable; separate repair audit log. | Native delivery command should own task/order status update and use safe service only for allowed order fields. |
| Admin OrderEditForm | Hub UI `src/components/orders/OrderEditForm.jsx` | `admin` | Manual partial order update. | `matchBy.internal_id`. | Admin audit trail appended when manual override true. | Customer App admin backend command, not direct frontend entity update. |
| Address reconciliation | Hub `base44/functions/reconcileAddressGaps/entry.ts` | likely repair/manual source | Address-only repair payload. | Match existing order. | Gateway writes/logs filtered fields. | Native repair preview and command, owner/admin gated. |
| Repair/rebuild tools | Hub `reconcileAndRepairStripeOrders`, `unifiedOrderRepairWorker`, `comprehensiveDataRepair`, `repairBrokenCustomerAppOrders`, `fullSyncFromCustomerApp`, `rebuildAllSubscriptionOrders` | `manual_recovery`, `rebuild_subscriptions`, `customer_app` | Repair-specific partial payloads. | Varies: Stripe ids, internal id, order number. | Gateway plus OrderReviewQueue updates. | Native repair suite after safe service parity, with preview-first and no broad mutation until audited. |
| Refund processing | Hub `processStripeRefund` | not through safeSync for final cascade | Refund event updates order/tasks/batches directly and logs `OrderSyncLog`. | `stripe_event_id` + `refund_processed` log. | Partial refund queues `OrderReviewQueue`; full refund cascades. | Separate native refund service must call safe order service for order-status portion and audited cascade helpers for tasks/batches. |

Caller inventory note: any Hub function that invokes `base44.asServiceRole.functions.invoke('safeSyncOrderUpdate', ...)` must be represented in parity tests before retirement. Functions that direct-write `ShopifyOrder` today, especially POS and refund paths, require either migration into the safe service or a documented exception with dedicated tests.

## 5. Final Native Customer App Service Contract

Recommended first native shape:

`base44/functions/safeSyncOrderUpdate/entry.ts`

This should be a service-role backend function that is not called by browser code. If Base44 supports shared modules later, the logic should move into an internal module and function boundaries should become thin adapters.

### Accepted Internal Request

```json
{
  "incomingData": {},
  "source": "stripe_webhook",
  "idempotency_key": "evt_...",
  "stripeEventId": "evt_...",
  "matchBy": {
    "stripe_subscription_id": "...",
    "stripe_checkout_session_id": "...",
    "stripe_payment_intent_id": "...",
    "shopify_order_id": "...",
    "internal_id": "...",
    "shopify_order_number": "..."
  },
  "mode": "dry_run",
  "actor": {
    "type": "stripe|shopify|admin|system|driver",
    "email": "admin@example.com"
  },
  "request_id": "optional-command-id"
}
```

### Modes

| Mode | Writes allowed | Purpose |
| --- | --- | --- |
| `dry_run` | none | Dark launch, fixture tests, previews. |
| `shadow_log_only` | optional parity/mismatch log only | Parallel run while Hub still writes. |
| `live` | `ShopifyOrder`, `OrderSyncLog`, `OrderReviewQueue` only | Final cutover after parity threshold. |

Live mode must remain disabled until entity parity, fixture parity, and dark launch criteria pass.

### Response Shape

Safe metadata only:

- `status`: `success`, `skipped`, `rejected`, `dry_run`
- `action`: `created`, `updated`, `would_create`, `would_update`, `duplicate_event`, `queued_for_review`
- `order_id`
- `order_number`
- `fields_written_count`
- `fields_rejected`
- `fields_filtered`
- `lock_status`
- `source`
- `idempotency_key`
- `review_queue_action`
- `sync_log_action`
- safe `error_code` / `message`

Do not return raw order records, raw provider payloads, auth headers, secrets, stack traces, or full customer-facing status history.

### Write Contract

Allowed in final live native service:

- canonical operational `ShopifyOrder` create/update
- `OrderSyncLog` or successor event/write log create
- `OrderReviewQueue` create/update occurrence count
- optional safe `ShopifyOrder.audit_trail` append for admin/manual override

Forbidden inside `safeSyncOrderUpdate`:

- FulfillmentTask generation or packing
- ProductionBatch generation or recalculation
- refund cascades
- inventory or purchase order changes
- Customer-facing notifications
- Stripe/Shopify/provider calls
- route/proof/drop mutations
- broad repair/replay/backfill

Downstream effects should be separate audited services triggered after safe order write commits or after preview approval.

## 6. Source Ownership Mapping

| Current source | Final source/context | Keep, rename, or retire | Notes |
| --- | --- | --- | --- |
| `stripe_webhook` | `stripe_webhook` | Keep | Provider boundary remains Stripe-signed. |
| `customer_app` | `customer_app_checkout` or `customer_app_order_intent` | Rename after parity | Current label is ambiguous once Customer App owns backend. It should not gain operational fields for existing orders. |
| `rebuild_subscriptions` | `subscription_rebuild_job` | Keep as internal source | Must remain service-only and dry-run first. |
| `operations` | `operations_command` | Keep/refine | For production/delivery operational updates only. |
| `customer_app_driver` | `driver_command` | Rename/refine | Delivery commands should own task status and call safe service only for permitted order summary fields. |
| `admin` | `admin_manual_override` | Keep with stricter actor metadata | Must derive actor from authenticated admin. |
| `manual_recovery` | `owner_repair` | Keep owner-gated | Preview-first and request-id logged. |
| Hub bridge labels | none | Retire | `pullOrdersFromCustomerApp`, `receiveCustomerAppEvent`, and Hub sync sources disappear after cutover. |

Final rule: field ownership must become more explicit, not broader. No migration step should let browser-provided `source` or `actor` select write privileges.

## 7. Entity Parity And Gap Table

| Entity | Hub status | Customer App status | Required before native live |
| --- | --- | --- | --- |
| `ShopifyOrder` | Full operational order with locks, snapshots, source fields, fulfillments, Stripe ids, audit metadata. | Exists, but lacks or differs on several Hub fields. | Schema parity delta PR and migration tests. |
| `OrderSyncLog` | Gateway audit log with source/event/action/reason/fields. | Exists, but is Hub-sync oriented. | Add native write/event fields or create successor while preserving existing records. |
| `OrderReviewQueue` | Required quarantine queue. | Missing. | Add entity before native live writes. |
| `FulfillmentTask` | Used by order/driver/production flows. | Exists, partial. | Parity for order linkage/address fallback/status meanings. |
| `ProductionBatch` | Drives production_snapshot lock implications. | Missing. | Required before production-owned order lock transitions cut over. |
| `Bundle` / `Recipe` | Hub production demand calculation. | Customer App has product/subscription bundle models, but not full Hub production recipe model. | Later G21C/G21D entity delta; not a blocker for safeSync dry-run fixtures. |
| `Order` | Customer-facing customer order. | Exists and is customer-facing. | Must not be blindly merged with `ShopifyOrder`; define projection/sync policy. |
| `Subscription` | Customer App canonical customer subscription. | Exists. | Native safeSync must protect subscription id/fulfillment occurrences. |

Schema changes are not approved in G21B. The next schema phase must stop before live use if required fields are unknown.

## 8. Fixture Library Plan

Fixtures should live under `docs/migration/fixtures/` first, then become executable JSON/table tests after runtime implementation.

Each fixture must define:

- starting record state
- incoming payload
- source label
- idempotency key
- match keys
- expected write plan
- expected rejected/filtered fields
- expected `OrderSyncLog`
- expected `OrderReviewQueue`
- expected response
- explicit confirmation that FulfillmentTasks and ProductionBatches are untouched

### Required Fixture Matrix

| Fixture | Starting state | Incoming source/payload | Expected result |
| --- | --- | --- | --- |
| clean new one-time delivery order | no existing order | `customer_app` paid delivery order with complete address and line items | create operational order, log success, no queue. |
| clean new pickup/POS order | no existing order | POS or pickup payload | accept, set POS/no-delivery semantics where applicable, no address quarantine for POS. |
| incomplete delivery address | no existing order | delivery payload missing address fields | reject with `delivery_order_missing_address`, create/refresh queue. |
| low-quality new order | no existing order | score below threshold | reject with low-quality reason, queue. |
| duplicate Stripe event | existing `stripe_event_id_applied` | same `stripeEventId` | skipped, no mutation. |
| duplicate order number | existing order with same number but different Stripe id | incoming has same `shopify_order_number` | match existing by number, do not create duplicate. |
| paid attempted downgrade | existing `payment_status=paid` | non-admin incoming `payment_status=pending` | reject/drop payment field, preserve paid. |
| pending upgrade to paid | existing pending | Stripe incoming paid under production lock | force paid through. |
| subscription order update | existing subscription order | subscription update with safe fields | preserve subscription channel/id, update allowed fields only. |
| subscription downgrade attempt | existing subscription | incoming `source_channel=online` | queue downgrade attempt, force subscription. |
| erase `stripe_subscription_id` | existing subscription id | incoming null/empty id | preserve existing id. |
| erase `line_items` | existing line items | incoming empty/null line items | preserve existing. |
| erase `fulfillments` | existing fulfillments | incoming empty/null fulfillments | preserve existing. |
| manual override protected update | existing `manual_override=true` | `customer_app` overwrites protected fields | strip protected fields, log filtered/rejected fields. |
| production scheduled line mismatch | existing snapshot | incoming changed line items | queue overwrite rejection, preserve snapshot line items. |
| in-production address overwrite | existing lock/address | incoming blank or different address | preserve complete existing address and/or freeze field. |
| refunded/cancelled exclusion | existing refunded/canceled | stale customer_app paid/scheduled update | preserve terminal state; refund service owns downgrade/cancel. |
| partial refund review | existing paid | partial refund event | create queue, no silent production mutation. |
| unknown order attempt | existing good order | incomplete unknown payload | reject and queue. |
| subscription ghost duplicate | existing subscription with same Stripe sub | incoming new order by same email but bad ids | match by subscription id or queue; never dedupe by email alone. |
| POS address bypass | no address | POS payload | no missing-address queue; no production/delivery demand. |
| production snapshot mismatch | existing scheduled/in production with snapshot | incoming fulfillments count mismatch | queue overwrite rejection; drop fulfillments. |
| `FIELD_OWNERSHIP` rejection | existing order | source attempts unauthorized fields | filter fields, log rejection count. |
| `LOCK_FROZEN_FIELDS` rejection | existing locked order | source attempts frozen field | reject/drop frozen fields, log rejection count. |

## 9. Parity Test Plan

### Test Layers

1. Static extraction tests:
   - Validate native constants match Hub constants for `LOCK_FROZEN_FIELDS`, `FIELD_OWNERSHIP`, `ALWAYS_SAFE_FIELDS`, operational fields, manual protected fields, and meaningful production statuses.
2. Pure planner tests:
   - Given starting record + incoming payload, compute write plan without writes.
   - Assert accepted fields, rejected fields, filtered fields, queue/log actions, and response.
3. Golden-output parity:
   - Run Hub implementation in isolated fixture harness or freeze expected Hub outputs from G21B fixture cases.
   - Run native service dry-run.
   - Compare write plan and side-effect plan.
4. Integration dry-run:
   - Stripe webhook sample, Customer App order sample, subscription sample, driver update sample.
   - No Stripe/Shopify calls and no live data.
5. Idempotency tests:
   - Repeat duplicate event/request and assert skipped/no duplicate log/write.

### Comparison Dimensions

- found/matched order id
- create vs update vs reject vs queue
- field-level accepted/rejected/filtered list
- final order patch
- OrderSyncLog shape
- OrderReviewQueue shape and idempotency key
- response status/error code
- no FulfillmentTask/ProductionBatch mutation
- no customer-facing status_history or notifications

### Required Test Data Rules

- Use synthetic ids, emails, order numbers, and Stripe ids.
- No live Customer App or Hub records.
- No provider calls.
- No raw secrets.
- No customer PII beyond synthetic fixture data.

## 10. Dark Launch Strategy

Preferred dark-launch path:

1. Keep Hub as live writer.
2. Add native Customer App `safeSyncOrderUpdate` in dry-run mode only.
3. At every Customer App order-ingestion boundary, compute native dry-run output from the same payload sent to Hub.
4. Continue sending live write to Hub bridge.
5. Compare Hub response/write plan to native dry-run result.
6. Log only safe parity metadata:
   - fixture/caller type
   - source
   - idempotency key hash or event id suffix
   - action match/mismatch
   - fields accepted/rejected counts
   - queue/log action match
   - mismatch category
7. Do not write native `ShopifyOrder` until parity threshold is met.

Mismatch categories:

- identity resolution mismatch
- action mismatch
- accepted-field mismatch
- rejected-field mismatch
- queue incident mismatch
- log-shape mismatch
- response-code mismatch
- downstream side-effect mismatch
- schema gap

Cutover readiness threshold:

- 100 percent pass on required fixtures.
- Zero high-risk mismatches for live dark-launch events.
- Any low-risk formatting mismatch documented and accepted.
- No increase in OrderReviewQueue false positives.
- Rollback plan validated: disable native live flag and keep Hub bridge active.

## 11. Retirement Mapping

| Hub function/path | Current purpose | Final replacement | Retirement condition |
| --- | --- | --- | --- |
| `safeSyncOrderUpdate` | Hub order write gateway. | Native Customer App safe sync service. | Native service live, parity proven, Customer App operational entities canonical. |
| `pullOrdersFromCustomerApp` | Hub pulls Customer App orders. | None; native Customer App writes operational order directly. | Native order ingestion live and bridge disabled. |
| `receiveCustomerAppEvent` | Hub receives Customer App event bridge. | Internal Customer App event dispatch. | All event types handled natively. |
| `receiveOrderFromCustomerApp` | Legacy/direct Customer App order ingest. | Native order ingestion. | No external caller remains. |
| `ingestCustomerAppOrder` | Paid Customer App order to Hub. | Native service call from checkout/webhook. | Native one-time order fixture parity passes. |
| `customerAppEventPublicGateway` | Public gateway for Customer App events. | Native internal event routing. | Hub bridge disabled and no external integrations use it. |
| `fullSyncFromCustomerApp` | Bulk-ish Customer App to Hub sync. | Native repair/dark-launch tools only. | All missing-order recovery tools ported. |
| `syncOrderToHub` | Customer App pushes order to Hub. | Native safe sync service call/no-op compatibility wrapper during cutover. | Hub no longer receives order pushes. |
| `syncSubscriptionWithFulfillments` | Customer App pushes subscription fulfillment data to Hub. | Native subscription occurrence/order generation. | Subscription fixture parity passes. |
| `syncRefundToHub` | Customer App refund bridge to Hub. | Native refund service. | Refund parity and cascade tests pass. |
| `retryFailedHubSyncs` | Retries failed Hub syncs. | Native retry for internal failed event logs. | No Hub sync logs remain retryable. |
| `processStripeRefund` | Hub refund cascade. | Native refund service calling safe order service and cascade helpers. | Refund full/partial duplicate tests pass. |
| Hub repair/rebuild tools | Recover or repair unsafe order states. | Native owner-gated preview-first repair tools. | Equivalent native tools tested and Hub bridge read-only. |

## 12. Next Implementation Phases

1. G21C: Customer App entity parity delta contract.
   - Document exact schema additions for `ShopifyOrder`, `OrderReviewQueue`, `OrderSyncLog`, and safe operational logs.
   - Stop before schema changes if field semantics are ambiguous.
2. G21D: Fixture files and pure planner skeleton.
   - Add docs fixtures first, then non-live test harness.
   - No live sync or provider calls.
3. G21E: Native dry-run service PR.
   - Implement `safeSyncOrderUpdate` in dry-run mode only.
   - No live `ShopifyOrder` writes.
4. G21F: Dark-launch adapter planning.
   - Attach dry-run comparison to Customer App order ingestion while Hub remains live writer.
5. G21G: Live cutover gate.
   - Only after fixture parity, dark launch, and owner approval.

## 13. G21B Documentation-Only Confirmation

This phase changed documentation only. It did not:

- modify runtime code
- modify schemas/entities
- publish Builder
- call Stripe, Shopify, providers, Hub, or Customer App endpoints
- mutate live orders, tasks, batches, inventory, purchase orders, logs, review queues, compliance records, status_history, notifications, or sync state
