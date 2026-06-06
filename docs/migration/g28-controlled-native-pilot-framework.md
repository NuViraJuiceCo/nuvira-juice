# G28 Controlled Native Pilot Framework

G28 adds a read-only exact-order native pilot approval packet for the Hub retirement migration.

## Purpose

After G27B, the cutover readiness gate can classify a specific paid Customer App order as pilot-ready. G28 turns that readiness result into a formal approval packet that can be reviewed before any live writer pilot is separately approved.

## Scope

G28 is framework-only:

- exact-order only
- admin or internal preview-secret access only
- dry-run only
- no live native writer execution
- no Customer App Order writes
- no native ShopifyOrder writes
- no FulfillmentTask writes
- no OrderSyncLog, OrderReviewQueue, CommandLog, or SafeSyncParityLog writes
- no Stripe, Shopify, provider, Hub API, or notification calls
- no sync, retry, repair, replay, production, inventory, PO, route, proof/drop, or delivery mutations

Hub bridge remains fallback.

## New function

`previewNativeExactOrderPilotApproval`

The function requires an exact `order_id`, `order_number`, or `native_order_id`. It invokes the existing read-only G27 cutover readiness gate with the internal preview secret and returns a sanitized approval packet.

The returned packet includes:

- exact order identifiers
- readiness classification
- native safeSync writer gate snapshot
- planner dry-run equivalent summary
- approval blockers/warnings
- generated exact-order approval phrase
- live execution contract for a future separately approved pilot

It does not return raw provider payloads, secrets, auth headers, raw order objects, payment provider IDs, or stack traces.

## Admin UI

`/admin/sync-health` now exposes an "Exact-Order Pilot Approval Packet" section under the Native Cutover Readiness Gate. The packet button is disabled until an exact order number has a clean pilot-ready readiness preview.

No live execution button is added.

## Approval boundary

A future live pilot still requires separate explicit approval for a named order number. G28 does not grant approval and does not execute the writer.
