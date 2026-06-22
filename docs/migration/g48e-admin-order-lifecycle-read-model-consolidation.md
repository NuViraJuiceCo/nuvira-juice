# G48E — Admin order lifecycle read-model consolidation

## 1. G48A architecture decision

G48A changed the migration direction from mirroring every Hub data path one-by-one to building clearer native operational backbones with explicit source-of-truth boundaries. G48E applies that rule to Admin Orders: keep Hub visible and active, but move lifecycle reconciliation into one backend-owned, versioned read model instead of letting page-level UI logic become the long-term authority.

This package is read-only/default-off. It does not change order, payment, refund, fulfillment, delivery, subscription, notification, repair/replay, Hub, Shopify, Stripe, or provider writes.

## 2. Current admin order data paths

The actual Admin Orders runtime path is:

```text
src/pages/AdminOrders.jsx
→ getAdminOrdersWithHub
→ merged orders returned as orders[]
```

`AdminOrders.jsx` also reads `getAdminDeliveryRouteSummary` for delivery fallback rows when the primary admin-order response does not include a row. That fallback remains unchanged.

`getAdminOrdersWithHub` currently owns the broad admin order read surface:

- Customer App `Order` rows;
- native `ShopifyOrder` rows;
- native `FulfillmentTask` rows;
- `OrderReviewQueue` context;
- `OrderSyncLog` context;
- Hub order expansion by customer contact mapping;
- existing same-order Hub/native/customer-app merge;
- existing diagnostics and limited-native-primary metadata.

Operations dashboard order aggregates are owned by `getAdminOperationsDashboardSummary`; G48E does not move that surface because it has separate aggregate semantics and should not consume row-level order lifecycle details in this package.

## 3. Backend owner

`getAdminOrdersWithHub` is the backend owner for the admin order lifecycle read model because it is already the only function that assembles the Admin Orders list with Customer App, Hub, native ShopifyOrder, FulfillmentTask, review, and sync context.

`previewNativeOrderCutoverReadiness` remains a preview/audit tool and is not the permanent owner.

## 4. Function-local helper packaging

The helper is function-local because current Base44 function packaging does not support sibling shared modules reliably.

```text
base44/functions/getAdminOrdersWithHub/entry.ts
base44/functions/getAdminOrdersWithHub/adminOrderLifecycleReadModel.js
```

The helper is pure. It receives preloaded rows and returns a versioned model. It does not query entities, write entities, call Hub, call Stripe, call Shopify, call providers, send notifications, create logs, create queues, or run repair/replay.

## 5. Exact identity rules

Customer App Order remains canonical.

Customer App Order to native ShopifyOrder matching may use only:

- `base44_order_id`;
- `customer_app_order_id`;
- exact normalized `order_number`;
- exact normalized `shopify_order_number`.

Customer App Order or native ShopifyOrder to FulfillmentTask matching may use only:

- `order_id`;
- `base44_order_id`;
- `customer_app_order_id`;
- `native_shopify_order_id`;
- `shopify_order_id`;
- exact normalized `order_number`;
- exact normalized `shopify_order_number`.

The read model does not match by customer name, customer email, phone, address, approximate amount, approximate date, product combination, newest row, or fuzzy order number.

Duplicate exact native ShopifyOrder or FulfillmentTask candidates fail closed to review/fallback classification.

## 6. Canonical response contract

The backend adds safe capability metadata:

```text
admin_order_lifecycle_read_model_available
admin_order_lifecycle_read_model_enabled
admin_order_lifecycle_read_model_version
```

Explicit request mode:

```text
read_model_mode=ADMIN_ORDER_LIFECYCLE
```

When enabled and requested, the additive payload is:

```text
admin_order_lifecycle_read_model:
  read_model_version
  read_model_available
  read_model_enabled
  source_mode
  summary
  classification_counts
  rows
```

Rows contain only admin-safe lifecycle summaries:

- canonical order ref and order number;
- created date;
- order type and fulfillment type;
- delivery date;
- payment status/captured readiness;
- customer order status;
- native ShopifyOrder/FulfillmentTask presence counts;
- exact identity readiness;
- native payment, fulfillment, delivery, and production status summaries;
- Hub context presence/sync status;
- fallback/review/mismatch/blocker/warning classifications.

The payload does not return raw Hub, Stripe, Shopify, provider, payment-method, authentication, or session payloads.

## 7. Hub-only and fallback rules

Hub-only valid rows remain visible. Missing native context does not hide a valid order.

Fallback remains required for:

- Hub-only valid rows;
- missing native ShopifyOrder;
- missing FulfillmentTask where operational task context is required;
- duplicate identity risk;
- payment mismatch;
- fulfillment mismatch;
- delivery schedule mismatch;
- refund/cancel/payment holds;
- subscription/multi-delivery holds;
- review queue holds;
- repair/replay holds;
- historical late mirrors;
- unknown/manual-review rows.

Hub reads remain active. Hub writes remain active where they already exist; G48E does not suppress them.

## 8. Payment/refund/subscription holds

Refunds, cancellations, payment-risk rows, and subscriptions/multi-delivery rows remain on current Hub/payment/subscription source-of-truth behavior. A read-model row cannot make those rows native-primary for writes.

## 9. Backend-authoritative activation

Controls:

```text
ENABLE_ADMIN_ORDER_LIFECYCLE_READ_MODEL
ADMIN_ORDER_LIFECYCLE_READ_MODEL_KILL_SWITCH
```

Default behavior is off/fail-closed. The frontend has no Vite, query-parameter, localStorage, sessionStorage, or browser-global activation path.

## 10. Admin-page adoption

`AdminOrders.jsx` requests `read_model_mode=ADMIN_ORDER_LIFECYCLE`, but consumes the canonical payload only when all of these are true:

- backend response succeeds;
- backend reports enabled;
- backend version matches `g48e_admin_order_lifecycle_v1`;
- payload shape validates.

If disabled, failed, malformed, or unsupported-version, the page preserves the current `orders[]` path, delivery fallback, filters, search, rows, and actions.

## 11. Preserved write paths

G48E does not modify:

- refunds/cancellations;
- payment reconciliation;
- fulfillment updates;
- delivery actions;
- subscription actions;
- Hub sync/retry;
- Shopify pushes;
- notifications;
- repair/replay;
- customer order history/tracker;
- schemas/entities.

Read readiness never implies write readiness. Explicit flags remain false:

```text
order_write_ready=false
payment_write_ready=false
refund_write_ready=false
fulfillment_write_ready=false
delivery_write_ready=false
notification_expansion_ready=false
hub_write_suppression_ready=false
repair_replay_ready=false
```

## 12. Tests

G48E adds:

```text
scripts/migration/run-g48e-admin-order-lifecycle-read-model-consolidation-tests.mjs
```

The harness covers helper packaging, purity, disabled behavior, exact identity matching, fuzzy matching rejection, duplicate native/task holds, missing native/task fallback, payment/fulfillment/schedule mismatches, refund/cancel holds, subscription/multi-delivery holds, review/repair/replay holds, historical late mirror holds, Hub-only valid visibility, empty results, known controls `NV-MQHJR3V2`, `NV-MPZNKGNT`, `NV-MP5SOQLJ`, no hidden valid rows, UI gating, no frontend override, and no writes/providers/notifications/raw payload/PII expansion.

Regression commands for closeout:

- G39J/G39L admin-order regressions;
- G43B/G43C customer order regressions;
- G47B checkout parity;
- G42B delivery readiness;
- G33C mirror/task;
- G35 refunds;
- G36 subscriptions;
- G39N operations;
- G27 cutover readiness;
- scoped ESLint;
- `npm run build`;
- diff/scope/mutation/privacy scans.

## 13. Publish-disabled plan

After merge:

1. Publish only `getAdminOrdersWithHub`.
2. Publish Web/admin UI only because `AdminOrders.jsx` changed and scope is clean.
3. Keep `ENABLE_ADMIN_ORDER_LIFECYCLE_READ_MODEL` disabled or absent.
4. Verify current Admin Orders list, filters, search, Hub rows, delivery fallback, and actions remain unchanged.
5. Verify unauthenticated/non-admin boundaries.
6. Run no-write verification.

## 14. Activation requirements

A later G48E-LIVE1 must be separately approved and read-only. It requires exact candidates with:

- one Customer App Order;
- exactly one native ShopifyOrder where required;
- exactly one compatible FulfillmentTask where task context is displayed;
- paid/captured;
- no refund/cancel/subscription/multi-delivery hold;
- no duplicate identity;
- no payment/fulfillment/delivery mismatch;
- no review/repair/replay hold;
- current fallback result recorded.

G48E-LIVE1 must not change refunds, payments, subscriptions, fulfillment actions, delivery actions, notifications, repair/replay, or Hub writes.

## 15. Hub-read retirement criteria

Admin Orders can reduce Hub reads only after:

- native Customer App Order, ShopifyOrder, and FulfillmentTask coverage is complete enough for current operational rows;
- Hub-only valid rows are mirrored or explicitly retained through fallback;
- refunds/payments and subscriptions have separate source-of-truth decisions;
- repair/replay and review holds have deterministic native governance;
- current admin actions no longer depend on Hub-only identifiers.

## 16. No-write policy

G48E is PR prep only. It does not publish Base44 or Builder. It does not mutate `Order`, `ShopifyOrder`, `FulfillmentTask`, Hub, provider records, notifications, logs, queues, inventory, PurchaseOrders, or customer-facing status fields.

## 17. Next package recommendation

Close and deploy G48E disabled if clean. Then evaluate exact read-only G48E-LIVE1 candidates. Keep broad admin-order write migration held until the read model is proven and payment/refund/subscription boundaries remain intact.
