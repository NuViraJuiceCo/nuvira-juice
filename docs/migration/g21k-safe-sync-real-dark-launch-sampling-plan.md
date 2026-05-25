# Phase G21K: Real safeSync Dark-Launch Bridge Sampling Plan

## Purpose

Plan the first real-data safeSync dark-launch sampling step without running it.

This phase is documentation-only. It does not enable native `safeSyncOrderUpdate` writes, does not sample live bridge traffic, does not create logs, and does not mutate Customer App or Hub records.

## Current Synthetic Status

- Native safeSync schemas are live in Customer App.
- `previewNativeSafeSyncOrderUpdate` is live and dry-run only.
- `previewNativeSafeSyncDarkLaunchComparison` is live and dry-run only.
- Synthetic fixture runner passes 24/24.
- Synthetic dark-launch comparison runner passes:
  - 24/24 synthetic fixture comparisons matched
  - 1/1 synthetic negative comparison produced `blocker`
- Source labels:
  - `Hub code confirmed=21`
  - `Contract inferred=2`
  - `Dark launch required=1`
- No native writer is enabled.

## Real Bridge Source Map

| Source | Repo / File | Payload Shape | Live PII / Provider Data | Current Writes | Read-only Mirror Feasibility | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Customer App paid order push | Customer App `base44/functions/syncOrderToHub/entry.ts` | `{ event:"order.created", source:"customer_app", order:{...} }` sent to Hub `receiveCustomerAppEvent` | Includes customer email/name/phone/address, line items, Stripe checkout/payment IDs | Hub write via `receiveCustomerAppEvent`; Customer App `OrderSyncLog` on result/error | Good for offline exported sample. Inline mirror is possible later but touches active path. | Primary real one-time order bridge. Refunds use same path with `order.refunded`; exclude refunds from first sample. |
| Customer App refund push | Customer App `base44/functions/syncRefundToHub/entry.ts` -> `syncOrderToHub` | Refund event delegates to `syncOrderToHub` with refunded payment status | Includes refund amount/id plus Stripe IDs | Hub refund/order cascade path and Customer App sync log | Exclude first. Offline plan only after refund-specific audit. | High risk because refund/money-adjacent. |
| Customer App ShopifyOrder push | Customer App `base44/functions/syncShopifyOrderToHub/entry.ts` | `{ event:"shopify_order.created", source:"customer_app", order: shopifyOrder }` | May include full operational order and provider IDs | Hub write via event endpoint | Possible offline sample, but less central than `syncOrderToHub`. | Likely legacy/transitional. |
| Customer App manual/recovery push | Customer App `recoverStuckOrder`, `retryFailedHubSyncs`, `retryRepairedSubscriptionHubSync` and related functions | Reconstructed order/subscription payloads | Can include customer PII, Stripe subscription/payment IDs, error logs | Retry/recovery can call Hub and write Customer App `OrderSyncLog` | Exclude first. Use only after normal samples pass. | Repair/retry is hard-stop class for broad execution; only sampled offline from existing logs. |
| Customer App pull endpoint | Customer App `base44/functions/getAllOrdersForSync/entry.ts` | Hub reads paginated Customer App orders | Includes email, phone, address, line items, Stripe IDs, proof/drop fields | Read endpoint only, called by Hub pull | Good only for offline extraction if limited and redacted. | Raw export can be broad; do not run live pull during G21K. |
| Customer App subscription pull endpoint | Customer App `base44/functions/getSubscriptionOrdersForSync/entry.ts` | Hub reads subscription-derived order rows by `customer_email` | Includes email, phone, address, subscription-derived line items | Read endpoint only, called by Hub pull | Possible but needs narrow customer/date constraints before use. | Subscription/multi-delivery has known edge cases; include one only after redaction contract. |
| Hub customer app pull | Hub `base44/functions/pullOrdersFromCustomerApp/entry.ts` | Fetches Customer App order endpoints, hydrates with Stripe if needed | Customer PII plus Stripe API retrieval/hydration | Hub `ShopifyOrder` via `safeSyncOrderUpdate`; Hub `OrderSyncLog` | Exclude live execution. Use existing logs or exported sample first. | Calls Stripe in hydration fallback, so not acceptable for first sampling run. |
| Hub full customer app sync | Hub `base44/functions/fullSyncFromCustomerApp/entry.ts` | Fetches Customer App orders/products/loyalty/events | Broad Customer App data | Multiple Hub entity writes | Exclude. | Broad sync; not a sampling candidate. |
| Hub direct Customer App order ingest | Hub `base44/functions/receiveCustomerAppEvent/entry.ts`, `receiveOrderFromCustomerApp`, `ingestCustomerAppOrder` | Customer App event/order payload normalized into `safeSyncOrderUpdate` | Customer PII, Stripe IDs, line items, address | Hub `ShopifyOrder`, possible `FulfillmentTask`, `OrderSyncLog`, `OrderReviewQueue` | Good for offline sample from existing logs; inline mirror later. | Main Hub-side bridge target. Some endpoints create tasks after safeSync; first sampling must avoid invoking them. |
| Stripe checkout webhook | Hub `base44/functions/stripeCheckoutWebhookHardened/entry.ts` and Customer App `base44/functions/stripeWebhook/entry.ts` | Stripe event -> normalized order payload | Stripe event/session/payment IDs, possible address/customer data | Hub/Customer App order/log writes and side effects | Exclude live. Use redacted historical summary only. | Webhook path is live payment/provider-adjacent. |
| Shopify order webhook | Hub `base44/functions/shopifyOrderWebhook/entry.ts` | Shopify webhook -> normalized online order payload | Shopify order data, customer/address info | Hub `safeSyncOrderUpdate`, sync logs | Exclude first; offline summary only if available. | Provider webhook path; avoid live calls. |
| Stripe reconciliation | Hub `base44/functions/stripeSessionReconciliation/entry.ts` | Stripe session scan -> safeSync payload | Stripe API data, payment IDs, customer/address info | Hub `ShopifyOrder` via safeSync | Exclude first. | Provider/reconciliation flow is high-risk and can call Stripe. |
| Driver status sync | Hub `receiveDriverStatusUpdate`, `updateDriverDeliveryTask` | Driver delivery status -> safeSync operational fields | Delivery/proof/drop fields possible | Hub tasks/orders and customer-facing status | Exclude. | Delivery/customer-facing path needs separate audit. |

## Sampling Mode Comparison

| Option | Description | Safety | Pros | Risks | Recommendation |
| --- | --- | --- | --- | --- | --- |
| A. Offline sample from existing logs | Read existing Customer App `OrderSyncLog`, Hub `OrderSyncLog`, and safe order snapshots manually/exported; transform into redacted fixture-like input. | Highest | No runtime change, no live event capture, no persistent new logs. | Existing logs may not contain full incoming field set; may require careful manual redaction. | Use first. |
| B. Inline non-persistent comparison | Current bridge computes native dry-run during normal processing, returns or discards comparison. | Medium | Exercises real live inputs. | Touches active order path; performance/error risk; no persistent audit unless returned. | Later, after offline sample proves shape. |
| C. Persistent dark-launch comparison log | Store safe comparison metadata for each sampled event. | Medium/High | Enables larger parity analysis. | Requires log schema and privacy review; creates records. | Do not start here. Needs explicit approval. |
| D. Temporary local script against exported sample | Owner/admin exports 5-20 redacted samples; local script runs planner/comparator. | High | No app runtime change; reproducible. | Manual export quality matters; sample may be stale. | Pair with Option A as first implementation. |

## Recommended First Real-Data Approach

Start with **Option A + Option D**:

1. Do not instrument runtime.
2. Do not write persistent logs.
3. Create a local-only sample format under `docs/migration/fixtures/` or `/private/tmp` after approval.
4. Use a small manually reviewed, redacted sample extracted from existing logs and order snapshots.
5. Run native planner/comparator locally.
6. Record aggregate results and mismatch categories only.

This validates real field shapes while avoiding live bridge sampling and persistent logging.

## Privacy And Redaction Policy

Real sampling may include:

- stable sample id
- source label
- event type
- order id or hashed/internal order id
- order number when operationally needed
- payment/production/fulfillment status fields
- order type and fulfillment mode
- line item titles and quantities if needed for guardrail parity
- field names accepted/rejected
- error codes
- queue incident type
- sync log action/status

Redact or omit by default:

- full street address
- phone number
- raw Stripe/Shopify payloads
- Stripe/Shopify secrets
- auth headers
- full raw payload dumps
- full customer notes/internal notes
- delivery proof/drop media or locations
- payment method details
- unnecessary customer PII

Allowed in an admin-only local sample only when required:

- customer email, preferably masked or replaced with stable synthetic value
- order number
- minimal city/state/zip completeness flags instead of full address

Persistent dark-launch logs, if later approved, must be tighter than admin previews: field names, statuses, ids, counts, mismatch category, and no raw payloads.

## First Sample Set Recommendation

Use 5-20 recent sync events only after a redaction/extraction command is separately approved.

Target sample mix:

- 3-5 clean one-time paid delivery orders
- 1 pickup/POS order if already present in existing logs
- 1 subscription order/update if sample can be narrowed without broad subscription export
- 1 incomplete or queued order if already present in `OrderReviewQueue`
- 1 duplicate/idempotent event if existing logs clearly show duplicate/skipped behavior

Exclude from first sample:

- refunds and partial refunds
- subscription downgrade/repair/rebuild events
- provider webhooks requiring live Stripe/Shopify calls
- driver delivered/proof/drop updates
- broad sync/retry/repair outputs
- customer notification paths

## Comparison Output Contract

Each sample comparison should produce:

```json
{
  "sample_id": "g21k_sample_001",
  "source_event_type": "order.created",
  "source_label": "customer_app",
  "hub_outcome_summary": {
    "action": "created",
    "accepted_fields": ["payment_status"],
    "rejected_fields": [],
    "error_code": null,
    "review_queue_incident_type": null,
    "sync_log_action": "created"
  },
  "native_dry_run_summary": {
    "action": "created",
    "accepted_fields": ["payment_status"],
    "rejected_fields": [],
    "error_code": null,
    "review_queue_incident_type": null,
    "sync_log_action": "created"
  },
  "parity_status": "match",
  "mismatch_categories": [],
  "safe_notes": []
}
```

Allowed `parity_status`:

- `match`
- `mismatch`
- `blocked`
- `unsupported`
- `needs_manual_review`

Mismatch categories:

- `accepted_fields_diff`
- `rejected_fields_diff`
- `status_diff`
- `review_queue_diff`
- `sync_log_diff`
- `error_code_diff`
- `idempotency_diff`

## No-Mutation Rules

Real sampling must not:

- create/update `ShopifyOrder`
- create/update Customer App `Order`
- create `OrderSyncLog`
- create `OrderReviewQueue`
- create `CommandLog`
- call Stripe
- call Shopify
- call providers
- run sync/retry/repair
- send notifications
- change checkout/subscription/payment behavior
- create fulfillment tasks
- update production, inventory, compliance, delivery, proof/drop, or route state

## Implementation Options

### Option 1: Docs-only plus manual export checklist

Create a checklist for manually exporting a small redacted sample from existing logs/snapshots.

Recommendation: acceptable next if owner wants zero runtime changes.

### Option 2: Local script for redacted exported sample

Add a local script that reads a JSON sample file from `/private/tmp` and runs the native planner/comparator. The script must not read Base44 entities or call network APIs.

Recommendation: best next implementation.

### Option 3: Read-only function to transform supplied sample

Add an admin-only or dry-run-only helper that accepts a supplied sample body and returns comparison output. It must not read live records or persist logs.

Recommendation: acceptable after local script proves shape.

### Option 4: Runtime bridge instrumentation

Inline comparison in `syncOrderToHub` or equivalent bridge path.

Recommendation: hold until offline sample parity is reviewed.

### Option 5: Persistent parity log

Add a native `CommandLog` or dedicated parity log write.

Recommendation: hold until logging schema and privacy policy are explicitly approved.

## Recommended Next Phase

Proceed with **G21L: local exported-sample runner contract and PR prep**:

- Add a docs-only sample schema, or a local-only script that reads `/private/tmp/nuvira-safe-sync-real-samples.redacted.json`.
- Do not include real sample data in git.
- Do not read live Base44 entities.
- Do not call Hub, Stripe, Shopify, or providers.
- Reuse existing planner/comparator logic.
- Output aggregate parity results only.

Stop before extracting real samples until the sample source, redaction level, and maximum count are approved.

## Hard Stops

Stop if any next step requires:

- live bridge sampling without an approved sample list
- persistent parity logging
- raw provider payload capture
- full address/phone/customer note storage
- refund/money-adjacent samples
- subscription repair/rebuild samples
- broad sync/retry/repair
- native writer enablement
- any mutation of Customer App or Hub records
- Stripe/Shopify/provider calls
- customer notifications or customer-facing status changes

## Final Recommendation

Do not instrument runtime yet. The first real-data step should be a local/offline redacted sample runner, with no sample data committed and no live reads by the script. Runtime dark launch and persistent logging should remain held until offline redacted samples prove the input shape and comparison contract.
