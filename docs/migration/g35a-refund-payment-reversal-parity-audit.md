# G35A — Refund / Payment Reversal Parity Audit and Native Migration Plan

Date: 2026-06-09
Scope: docs/read-only audit. No runtime code, schema, function, UI, config, or live data changes.

## 1. Executive summary

G35A reviewed refund/payment reversal behavior in the Customer App and the local Hub source tree to define the next native migration phase.

Current conclusion: **do not migrate refund processing to native live writes yet.** Keep Hub refund processing as the operational source of truth while adding a native, read-only refund impact preview next.

Reasons:

- The Hub has a full refund cascade path through `processStripeRefund` and Customer App event ingestion.
- The Customer App already receives Stripe refund webhooks and has live one-time refund handling, but that path mutates Customer App `Order`, invokes Hub sync, can invoke refund notification code, and does not yet match the preview-first migration boundary used for the native one-time order rollout.
- Native entities have enough fields to model refund impact, but not enough proven policy to safely execute native cancellation across Customer App Order, native ShopifyOrder, FulfillmentTask, ProductionBatch, notification, loyalty, and Hub fallback surfaces.
- Partial refund behavior is inconsistent between Hub and Customer App source: Hub queues manual review, while the Customer App one-time webhook path still sets the Customer App order to refunded.
- `Order.status` enum does not include `refunded` or `cancelled`, but current Customer App refund code writes those strings in some paths. That schema/status mismatch must be resolved before any native refund command.
- Refunds after production, verification, or delivery need explicit safety policy; native should preserve compliance history and avoid automatic delivery/compliance rewrites.

Recommended next phase: **G35B — build `previewNativeRefundImpact` as a read-only function and harness.** Do not add a live native refund command until preview parity and status mapping are proven.

## 2. Source audit note

Customer App audit was performed in this repository. Hub audit was performed against the local Hub checkout at:

- `/Users/nuvisionary/Documents/NuVira Juice Co./NuVira-Hub-Temp`

That Hub checkout is behind `origin/main` and contains local changes. Findings below are source-derived from that local checkout and should be refreshed against the current Hub default branch before treating them as live-production truth.

No provider, Stripe, Shopify, Hub, Base44 live data, webhook replay, sync, repair, or mutation was run for this audit.

## 3. Hub refund behavior map

### 3.1 Full refund

Primary Hub path: `processStripeRefund/entry.ts`.

Observed behavior from local Hub source:

- Intended trigger is Stripe `charge.refunded` or `refund.created`.
- Accepts internal function secret or authenticated admin user.
- Requires `stripe_event_id` and at least one order locator.
- Looks up Hub `ShopifyOrder` by manual order number or Stripe payment intent id.
- Detects duplicate processed refund events by `OrderSyncLog` with matching `stripe_event_id` and `action: refund_processed`.
- For full refund, updates Hub `ShopifyOrder`:
  - `payment_status -> refunded`
  - `production_status -> canceled`
  - `fulfillment_status -> cancelled`
  - adds `refunded` and `excluded` tags
  - `sync_status -> do_not_sync`
  - `refunded_at`
  - `stripe_event_id_applied`
  - `cancel_type`
  - internal notes and audit trail entry
- Cancels linked Hub `FulfillmentTask` rows where status is not `Cancelled` and not `Completed`:
  - `status -> Cancelled`
  - `delivery_status -> cancelled`
  - `cancelled_at`
  - notes append
- Removes the order from Hub `ProductionBatch.order_sources`, subtracts planned units, appends batch audit trail, and archives a batch if no order sources or planned units remain.
- Writes Hub `OrderSyncLog` with `action: refund_processed`.
- Returns task cancellation and production batch update counts.

Implication for native: a full native refund command would need to touch many surfaces and preserve audit history. It is not safe to implement as a first native refund step.

### 3.2 Partial refund

Hub `processStripeRefund` treats partial refunds as manual review events:

- Determines full vs partial using explicit flag or amount comparison.
- For partial refunds, creates `OrderReviewQueue` with `incident_type: partial_refund_received`.
- Writes `OrderSyncLog` with `action: flagged`.
- Returns `partial_refund_flagged_for_review`.
- Does not perform the full operational cancellation cascade.

Native policy should match this safer behavior: **partial refunds should preview a review queue entry and not automatically cancel or refund the customer-facing order.**

### 3.3 Duplicate refund event

Hub duplicate handling has two layers:

- Processed-event idempotency: matching `OrderSyncLog` by `stripe_event_id` and `action: refund_processed` returns skipped/idempotent.
- Terminal-state idempotency: if the Hub order is already `payment_status: refunded` and `production_status: canceled`, the cascade is skipped and an `OrderSyncLog` skip entry is written.

Native parity should separate these cases:

- duplicate event with prior success
- duplicate event against an already terminal order
- failed prior event that is not a success
- partial-refund review dedupe

### 3.4 Refund after production started/completed/verified

The Hub cascade removes order sources from ProductionBatch rows and recalculates planned units without a visible stage-specific stop for `in_progress`, completed, verified, or locked compliance states in the audited function. It skips cancelling tasks only when a Hub task status is `Completed` or already `Cancelled`.

Native should not copy this broadly. Native refund impact should classify risk by lifecycle stage:

- before production materialization
- task scheduled / pending
- ProductionBatch planned
- production in progress
- production completed
- production verified / BatchComplianceLog locked
- task packed/delivered
- Customer App status delivered

For verified or delivered orders, native refund preview should preserve batch/compliance/delivery history and require explicit owner approval for any customer-facing or operational status changes.

### 3.5 Subscription and multi-delivery refund

Hub `receiveCustomerAppEvent` routes `customer.subscription_cancelled` to the same full refund cascade when it finds an active Hub order by subscription id, Customer App subscription id, payment intent id, or order number. The same file also routes `order.refunded` events into `processStripeRefund`.

Subscription and multi-delivery refund migration remains out of scope for one-time native refund parity. Native preview should classify subscription/multi-delivery refunds separately and block automatic one-time order mutation.

### 3.6 Hub repair/refund duplicate functions

The local Hub source includes manual repair behavior that applies a similar refund cascade to stuck refunded orders. Customer App also includes repair utilities for refunded duplicates and subscription refund dry-runs. These are useful references, but they are not a safe native live command model because they are corrective, targeted, and historically context-specific.

## 4. Customer App current refund readiness

### 4.1 Stripe webhook receipt

Customer App `stripeWebhook/entry.ts` currently handles refund-related Stripe events.

Observed behavior:

- `charge.refunded` is active.
- The handler probes Stripe payment intent/invoice context to separate subscription refunds from one-time order refunds.
- This probe uses Stripe API calls; a native read-only preview must not do this.
- `refund.updated` can repair a Customer App order to terminal refunded state if a successful refund update arrives after the main event path was missed.

### 4.2 One-time order refund path

Customer App one-time `charge.refunded` path currently:

- Finds Customer App `Order` by Stripe payment intent id.
- If no order is found, writes `OrderSyncLog` error context and returns received.
- Treats an existing `payment_status: refunded`, `status: refunded`, or `status: cancelled` as already terminal and skips.
- For full refund and partial refund, sets the Customer App order to `status: refunded`.
- Sets `payment_status: refunded`, `financial_status: refunded`, `payment_captured: false`, `refunded_at`, refund id/amount fields, `is_partial_refund`, `sync_status: refund_pending_hub_sync`, and appends `status_history`.
- Creates `OrderSyncLog`.
- Invokes `syncRefundToHub`, which delegates to `syncOrderToHub` and sends `order.refunded` to Hub.
- Restores loyalty points for full one-time refunds.
- Invokes `sendOrderReceivedNotification` with `refund_notification: true`; that function currently suppresses refund customer emails with a disabled response.

Migration issue: this is a live mutation path, not a preview-first native parity path. G35B should not rely on it as a safe native model without dedicated gating and preview coverage.

### 4.3 Partial refund mismatch

Hub behavior for partial refunds is review-only. Customer App one-time webhook behavior comments say partial refunds should be manual review, but still marks the Customer App order as refunded.

This is a parity blocker. Native policy should be:

- partial refund -> preview manual review impact
- no automatic Customer App Order terminal status change
- no task cancellation
- no batch mutation
- no notifications
- no provider calls

### 4.4 Customer App schema readiness

Customer App entity support is partial:

- `Order.payment_status` and `Order.financial_status` include `refunded`.
- `Order.do_not_recover` exists to prevent re-entry into production if refunded/cancelled.
- `Order.status_history` exists.
- `ShopifyOrder.production_status` includes `canceled` and `refunded`.
- `ShopifyOrder` has `payment_status`, `financial_status`, `fulfillment_status`, `refunded_at`, and `cancel_type` fields.
- `FulfillmentTask.status` includes `cancelled` and `Cancelled` variants; `delivery_status` is a string projection.
- `ProductionBatch` supports order sources and audit trail style history.
- `OrderReviewQueue` supports refund incident types as free-form text.
- `OrderSyncLog` supports refund event/action fields.
- `CommandLog` supports request id / command type / safe result metadata patterns used by recent native migration commands.

Major schema gap:

- `Order.status` enum currently lists customer lifecycle statuses through delivered/pickup states, but does **not** include `refunded` or `cancelled`.
- Current refund code writes `status: refunded` and checks for `status: cancelled`.

Native refund work must resolve this before live commands. Options include a schema migration for refund/cancel statuses, separate payment status-only refund handling, or a held review-only policy for customer-facing status.

### 4.5 Existing native preview pieces

`previewNativeSafeSyncOrderUpdate` already has useful refund-related preview behavior:

- It rejects partial refund auto-application and drafts an `OrderReviewQueue` impact for `partial_refund_received`.
- It protects terminal refunded/cancelled state from paid production-status resurrection.

This is helpful, but it does not replace a refund impact preview because it does not fully model Customer App Order, native ShopifyOrder, native FulfillmentTask, ProductionBatch, delivery, notification, loyalty, Hub fallback, and idempotency impacts together.

## 5. Parity gaps

| Area | Hub behavior | Customer App/native status | Gap |
| --- | --- | --- | --- |
| Full refund order status | Hub order moves to refunded/canceled/excluded | Customer App webhook writes Order refunded; native ShopifyOrder schema supports refund-ish fields | Native command and policy not proven |
| Partial refund | Hub queues review, no full cascade | Customer App one-time path marks Order refunded | Must align to review-only before native migration |
| Order.status schema | Hub uses production/payment fields | Customer App writes `refunded` but enum lacks it | Status mapping blocker |
| FulfillmentTask cancellation | Hub cancels non-completed tasks | Native task status supports cancelled variants | Need canonical lowercase/uppercase policy and delivery_status policy |
| ProductionBatch impact | Hub removes order source and can archive | Native ProductionBatch exists and verified lifecycle is proven | Need preview-only first; verified/delivered orders must not auto-mutate |
| BatchComplianceLog | Hub refund path does not model native compliance logs | Native locked logs exist for proven order | Never delete; refund preview must preserve audit history |
| Delivered orders | Hub has limited delivered-state policy in audited refund path | Native delivered reconciliation now exists | Refund after delivery requires explicit owner policy |
| Notifications | Hub refund path does not send customer notifications in audited function | Customer App invokes notification helper but refund emails are disabled | Native must force no notification by default |
| Provider calls | Hub refund path is downstream of Stripe event or internal repair | Customer App webhook and admin subscription refund can call Stripe | Native preview must not call Stripe/Shopify/providers |
| Idempotency | Hub uses OrderSyncLog/event id and terminal-state skips | Native commands use CommandLog request id patterns | Native preview/command design needs both event id and request id model |
| Loyalty/rewards | Customer App one-time path restores points on full refund | Hub behavior audited here does not cover native loyalty parity | Native refund preview should flag loyalty impact, not mutate |
| Subscription/multi-delivery | Hub routes subscription cancellation to refund cascade | Native one-time migration excludes subscriptions | Must remain out of scope for G35B one-time preview |

## 6. Native refund migration options

### Option A — Keep Hub refund processing as source of truth for now

Recommended short-term.

- Hub remains operational refund/cancellation source of truth.
- Customer App native path reads and previews impact only.
- Avoids unproven native writes across order/task/batch/compliance/delivery/notification surfaces.
- Fits current migration posture: exact preview first, gated live commands later.

### Option B — Native refund preview only

Recommended next step.

- Add a read-only `previewNativeRefundImpact` function.
- Compute proposed Customer App Order, native ShopifyOrder, FulfillmentTask, ProductionBatch, OrderReviewQueue, OrderSyncLog, notification, and Hub fallback impacts.
- No writes and no provider calls.
- Provides parity evidence before any command planning.

### Option C — Native full refund command

Not recommended yet.

- High risk because it would need to mutate Customer App Order, native ShopifyOrder, FulfillmentTask, ProductionBatch order sources, CommandLog, possibly OrderReviewQueue/OrderSyncLog, and maybe loyalty state.
- Requires canonical status mapping and production-stage safety rules first.

### Option D — Native partial refund review queue only

Possible after G35B preview.

- Safer than automatic order mutation.
- Still requires explicit approval because it creates `OrderReviewQueue`/audit records.
- Should not change customer-facing order status.

### Option E — Provider-origin native refund handling

Later phase only.

- Requires high confidence in Stripe webhook idempotency and canonical native refund policy.
- Must not run broad provider calls from admin previews.
- Must preserve Hub fallback while migration is incomplete.

## 7. Proposed native refund preview contract

Suggested function: `previewNativeRefundImpact`

Auth:

- admin auth or internal service secret
- no public unauthenticated access, except the existing real Stripe webhook path remains separate

Inputs:

- `stripe_event_id` optional
- `order_number` optional
- `customer_app_order_id` optional
- `native_shopify_order_id` optional
- `refund_type`: `full`, `partial`, or `unknown`
- `refund_amount` optional
- `request_id` optional

Reads only:

- Customer App `Order`
- native `ShopifyOrder`
- native `FulfillmentTask`
- native `ProductionBatch`
- `BatchComplianceLog`
- `OrderSyncLog`
- `OrderReviewQueue`
- `CommandLog`
- Hub fallback context if a safe read helper exists

Must not:

- call Stripe
- call Shopify
- call payment providers
- run sync/retry/repair/replay
- send notifications
- create logs or review entries
- mutate any order/task/batch/compliance/inventory/PO/Hub records

Response:

```text
success
dry_run:true
writes_performed:false
order_found
refund_type
idempotency_status
customer_app_order_impact
native_shopify_order_impact
native_fulfillment_task_impact
production_batch_impact
batch_compliance_log_impact
proposed_review_queue_entry
proposed_sync_log_entry
customer_notification_impact
loyalty_impact
provider_call_impact:false
hub_fallback_impact
blockers
warnings
next_action
```

Suggested impact separation:

- `proposed_order_changes`
- `proposed_task_changes`
- `proposed_batch_changes`
- `proposed_review_queue_entry`
- `proposed_sync_log_entry`
- `held_customer_status_changes`
- `held_notification_changes`
- `held_provider_calls`
- `held_inventory_po_changes`

## 8. Refund safety policy

Native refund preview and future command planning should follow these rules:

1. No provider calls from native preview.
2. No notifications by default.
3. Partial refunds go to review, not automatic mutation.
4. Full refunds can be previewed for cancellation, but no live native command yet.
5. If production lifecycle has started, preview escalates risk.
6. If production is completed or verified, preview must preserve ProductionBatch and BatchComplianceLog history.
7. If order is delivered, refund must not auto-change delivery proof/compliance/delivery lifecycle records.
8. Inventory deduction and PO automation remain held.
9. Compliance logs are never deleted.
10. Batch history is audit-preserved.
11. Existing Hub fallback remains active.
12. Native live command, when eventually planned, must be exact-order gated, default-off, idempotent, and no-notification by policy.
13. Customer-facing status update must use a schema-supported value or remain held.
14. Subscription and multi-delivery refunds remain excluded from one-time native refund command planning.

## 9. Future G35B test matrix

Build fixtures/harness coverage before any live command:

| Case | Expected preview posture |
| --- | --- |
| Full refund before production | Preview Customer App/native order refund/cancel impact; no writes |
| Full refund after task scheduled | Preview task cancellation impact; no writes |
| Full refund after ProductionBatch planned | Preview batch source removal impact; no writes |
| Full refund after production in progress | Block or high-risk escalation; no writes |
| Full refund after production completed | Block or high-risk escalation; no writes |
| Full refund after verified_logged | Preserve compliance/batch history; no writes |
| Full refund after delivered | Do not auto-change delivery/compliance; owner policy required |
| Partial refund | Preview review queue only; no status mutation |
| Duplicate refund event | Show idempotency status; no duplicate proposed writes |
| Unknown order refund | Preview review/log need; no writes |
| Subscription/multi-delivery refund | Exclude from one-time flow; route to subscription policy |
| Already refunded/cancelled order | Deduped/already terminal classification |
| Missing Stripe event id | Warn/block live readiness; preview may continue with reduced idempotency confidence |
| Invalid payload | Safe blocker; no writes |
| Notification impact | Always held / false by default |

## 10. Recommended next phase

Proceed with **G35B — native refund impact preview function**.

G35B should:

- Add read-only `previewNativeRefundImpact` or extend an existing preview bundle if function-count limits require it.
- Include exact order and event-id inputs.
- Return Customer App Order, native ShopifyOrder, native FulfillmentTask, ProductionBatch, BatchComplianceLog, OrderReviewQueue, OrderSyncLog, CommandLog, notification, loyalty, and Hub fallback impacts separately.
- Model partial refunds as review-only.
- Block or escalate refunds after production started/completed/verified/delivered.
- Flag the `Order.status` refunded/cancelled schema mismatch.
- Include fixture tests for the matrix above.
- Keep provider calls, sync, repair, notification, inventory, PO, Hub mutation, and all live writes disabled.

Do not proceed to a native full refund command until G35B proves the preview contract and owner approves exact write policy.

## 11. Hard stops

Stop before live implementation if any of the following remain unresolved:

- `Order.status` refund/cancel canonical mapping is not schema-supported.
- Partial refund policy is not aligned to review-only.
- ProductionBatch mutation policy after in-progress/completed/verified state is not approved.
- Delivered-order refund policy is undefined.
- Notification policy is not explicitly disabled or separately approved.
- Loyalty/rewards reversal policy is undefined.
- Idempotency model for provider event id plus native request id is incomplete.
- Hub fallback role is unclear.
- Any required action would call Stripe, Shopify, providers, sync/repair/replay, inventory deduction, PO automation, notification sending, or Hub mutation from the native preview path.

## 12. No-write confirmation

G35A changed documentation only. It did not:

- process refunds
- call Stripe, Shopify, payment providers, or Hub APIs
- mutate Customer App Order, native ShopifyOrder, native FulfillmentTask, ProductionBatch, BatchComplianceLog, inventory, PurchaseOrder, Hub records, OrderSyncLog, OrderReviewQueue, or CommandLog
- send notifications
- run sync/retry/repair/replay
- open gates
- disable Hub bridge
