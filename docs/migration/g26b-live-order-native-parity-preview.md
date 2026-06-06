# G26B: Live Order Native SafeSync Parity Preview

Status: implementation PR
Scope: admin/internal read-only live-order parity preview. No live writer is enabled.

## Goal

G26B extends G26A from synthetic fixtures to a bounded live-order read preview.

The Hub cannot retire until the Customer App can safely own canonical operational order writes for real order shapes. G26A proved the dry-run planner against synthetic contracts. G26B adds a safe function that reads one specific Customer App order/native mirror, builds a sanitized native safeSync fixture, runs the existing dry-run planner, and reports whether the order shape is ready for native write ownership.

## Added Function

`base44/functions/previewNativeSafeSyncLiveOrderParity/entry.ts`

The function:

- requires admin session or internal preview secret
- accepts only `mode: "dry_run"`
- requires a bounded lookup: `order_id`, `order_number`, `native_order_id`, or `shopify_order_id`
- reads Customer App `Order`, native `ShopifyOrder`, and native `FulfillmentTask` records
- invokes existing `previewNativeSafeSyncOrderUpdate`
- returns safe summaries and readiness classification

The function does not:

- create, update, or delete entities
- invoke `executeNativeSafeSyncOrderUpdate`
- invoke `processMay30NativeOrderOps`
- invoke `syncOrderToHub`
- call Hub APIs
- call Stripe, Shopify, providers, or notification services
- run sync, retry, repair, replay, refund, production, inventory, route, proof, drop, or delivery commands
- enable the broad native safeSync writer

## Example Requests

By order number:

```json
{
  "mode": "dry_run",
  "order_number": "NV-MPZNKGNT"
}
```

By Customer App order id:

```json
{
  "mode": "dry_run",
  "order_id": "6a219a3f4adcda5856c3d579"
}
```

Optional event/source override:

```json
{
  "mode": "dry_run",
  "order_number": "NV-MPZNKGNT",
  "source": "customer_app",
  "event_type": "order.created"
}
```

## Response Contract

The response includes:

- `success`
- `parity_status`
- `writes_performed: false`
- `native_writer_enabled: false`
- `hub_remains_live_writer: true`
- `target_summary`
- `planner_summary`
- `readiness`
- `safety`

`target_summary` is intentionally safe for admin/internal migration review:

- order number
- entity ids
- statuses
- payment status/captured boolean
- line item count
- address completeness boolean
- native task count and task ids/status/dates

It does not return raw payloads, full addresses, emails, phone numbers, provider/payment IDs, auth headers, secrets, stack traces, proof/drop data, or notification content.

## Readiness Classifications

| Classification | Meaning |
| --- | --- |
| `native_create_ready_dry_run` | No native mirror exists and the planner would create one. |
| `native_update_or_dedupe_ready_dry_run` | Native mirror exists and planner would update or skip without rejection. |
| `hold_payment_pending` | Order is not paid; do not fulfill or pilot writes. |
| `review_required` | The preview found a blocker or ambiguous state. |
| `not_ready` | Required source order context is missing. |

## Post-Publish Safe Smoke

After merge/publish, safe smoke only:

1. Unauthenticated POST returns `401`.
2. Authenticated/admin dry run for a known order returns `writes_performed=false` and `native_writer_enabled=false`.
3. Confirm no `Order`, `ShopifyOrder`, `FulfillmentTask`, `OrderSyncLog`, `OrderReviewQueue`, `CommandLog`, or `SafeSyncParityLog` records were created or updated by the preview.

Do not use this as a repair tool. Do not enable broad native writer access from this PR.
