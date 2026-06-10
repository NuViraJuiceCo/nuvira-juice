# G35I-PREV1: Refund Preview Dependency Hardening

## Executive summary

G35I-PREV1 hardens the read-only refund preview dependency required before any future G35J partial refund review queue write approval. The G35I command is already default-off and requires a stable G35H preview. This phase addresses the observed live timeout by adding an exact-id, bounded read path to `previewNativeOrderCutoverReadiness` for refund previews.

No valid G35I command is run in this phase. No review queue is created. No refund is processed. Hub remains the refund source of truth.

## Observed issue

After G35I publish, the command boundary checks passed, but live read-only preview calls for `NV-MPZNKGNT` timed out through `base44 exec`:

- `NATIVE_PARTIAL_REFUND_REVIEW_IMPACT` exact-id preview timed out.
- `NATIVE_REFUND_IMPACT` full refund regression preview also timed out.

Direct entity timing showed exact reads and bounded lists were fast, which pointed to the composed preview path rather than Base44 entity access in general.

## Root cause classification

The preview path used the read-consistency resolver for all refund previews. That resolver performed multiple passes and the historical G35D linkage helper included broad `ProductionBatch` / `BatchComplianceLog` list fallbacks. The G35H path could also recurse into the G35B preview as a fallback when direct batch linkage was empty. Under live conditions this made exact-id preview calls too expensive and vulnerable to timeouts.

## Read-only hardening

When exact identifiers are supplied:

```text
order_number
customer_app_order_id
native_shopify_order_id
native_fulfillment_task_id
```

refund previews now use a bounded exact-id fast path:

```text
g35i_prev1_exact_refund_preview_fast_path
```

The fast path:

- reads exact Customer App Order, native ShopifyOrder, and FulfillmentTask ids first
- uses bounded ProductionBatch and BatchComplianceLog list limits of 250
- preserves deterministic native batch id and order_sources matching
- does not match by customer name, email, phone, or fuzzy PII
- does not use date-only matching as sole proof
- keeps the existing read-consistency contract
- fails closed if exact reads are inconsistent
- skips recursive G35B fallback when exact-fast data is used or reads are unstable

## Required stable output before G35J

G35J remains blocked unless a fresh exact-id G35H preview returns:

```text
success:true
dry_run:true
writes_performed:false
preview_data_stable:true
read_consistency.stable:true
production_batch_count:6
batch_compliance_log_count:6
provider_call_impact:false
notification_impact.notification_held:true
```

## Safety guarantees

G35I-PREV1 does not:

- open G35I gates
- run a valid G35I command
- create OrderReviewQueue
- create CommandLog
- process refunds
- call Stripe, Shopify, or providers
- mutate orders, tasks, batches, compliance logs, inventory, PurchaseOrders, notifications, messages, sync logs, or Hub records

## Recommendation

After publish, rerun the exact-id G35H preview for `NV-MPZNKGNT`. If it returns stable 6/6 linkage, G35H can again serve as the pre-write dependency for a future owner-approved G35J planning phase. If it still times out, hold G35J and investigate Base44 function invocation/runtime limits separately.
