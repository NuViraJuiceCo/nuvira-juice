# G26C Native safeSync Base44 order linkage

## Scope

G26C fixes a native safeSync planner parity gap for Customer App order ownership.

The native `ShopifyOrder` schema already has `base44_order_id`, and the native writer executor already uses that field for lookup and order allowlisting. Before G26C, the dry-run planner rejected `base44_order_id` for non-admin sources through field ownership filtering, which meant Customer App paid-order writes could plan a native order without preserving the Customer App `Order` linkage.

## Change

- Allow safe sources to carry `base44_order_id` through `previewNativeSafeSyncOrderUpdate`:
  - `customer_app`
  - `stripe_webhook`
  - `manual_recovery`
  - `rebuild_subscriptions`
- Keep operational sources such as `operations` and `customer_app_driver` from owning this identity link.
- Add a non-admin relink guard: if an existing native order already has `base44_order_id`, a conflicting incoming value is rejected and the existing linkage is preserved.
- Extend the G26 parity harness defaults to assert:
  - Customer App create plans include `base44_order_id`.
  - Customer App relink attempts reject conflicting `base44_order_id` values.

## Safety boundary

This is a planner/parity patch only.

It does not:

- enable broad native safeSync writer access
- call Stripe, Shopify, providers, or notification services
- run sync, repair, replay, refund, production, fulfillment, inventory, route, proof, drop, or delivery commands
- mutate live orders, native `ShopifyOrder`, `FulfillmentTask`, Hub records, logs, review queues, command logs, or parity logs
- retire or disable the Hub bridge

## Migration impact

This closes a Customer App ownership blocker for Hub retirement: native operational orders can keep their source Customer App `Order` id as stable linkage while Hub bridge remains fallback.
