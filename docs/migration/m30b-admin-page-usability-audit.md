# M30B Admin Page Usability Audit

Date: 2026-05-26

## Scope

May 30 MVP requires admin pages to be operationally usable for one-time app/website orders and Shopify POS/event orders. This audit focuses on the Customer App admin surface, keeping Hub bridge/fallback paths live.

## Page Status

| Area | Status | Evidence | M30B Action |
| --- | --- | --- | --- |
| Orders / Admin Orders | Needs small UI wiring | Page showed local `Order` plus Hub-backed records, but not native `ShopifyOrder` records created by `processMay30NativeOrderOps`. | Added native `ShopifyOrder` merge into `getAdminOrdersWithHub` and native ops status panel in `AdminOrders`. |
| POS / Event Orders | Needs small UI wiring | Page was Hub-backed and would not show Customer App native POS mirrors if Hub response was missing or delayed. | Added native POS `ShopifyOrder` inclusion and Hub/native counts in `getAdminPOSOrdersSummary` / page header. |
| Production Planning | Usable with Hub fallback | Page calls Hub-backed production planning summary and shows products, batches, ingredient demand, shortage counts. | Clarified make-to-order shortage semantics as procurement needs and no inventory deduction. |
| Ingredient / Procurement Needs | Usable with Hub fallback | Production Planning and Inventory Status expose Hub-backed ingredient demand and stock visibility. | Reworded shortage labels to procurement needs. |
| Delivery Queue / Fulfillment | Usable now | Page exposes approved driver assignment, unassign/reassign, Mark Out For Delivery, and operations-only Mark Delivered. Proof/drop/route/bag-credit actions are omitted. | Operations hub card now accurately labels controlled actions instead of read-only. |
| Review / Issues | Usable now | Ops Alerts and Sync Health show sanitized alert/sync visibility with limited alert status actions. OrderReviewQueue remains Hub-backed/admin-visible. | No runtime write expansion in M30B. |
| Compliance / Production Ops | Hub fallback required | Existing Hub-backed compliance and production pages remain available; native compliance migration is deferred. | No change; Hub remains required for event-day compliance operations. |

## P0 UI/Action Blockers Found

1. Native Customer App operational `ShopifyOrder` records were not visible in Admin Orders.
2. Native POS mirrors were not visible in the POS/Event Orders page.
3. Production Planning used shortage language that could imply a fatal inventory blocker instead of make-to-order procurement need.
4. Operations dashboard described Delivery Queue as read-only even though approved driver/status actions are available.

## Implemented

- `getAdminOrdersWithHub` now includes native non-subscription `ShopifyOrder` records when Hub has not already supplied the same order number.
- `AdminOrders` now shows a `Native Ops` badge and native payment, production, fulfillment, sync, review, source, order type, and lock context.
- `getAdminPOSOrdersSummary` now merges Hub POS rows with native Customer App POS mirror rows and reports Hub/native counts.
- `POSOrders` displays Hub/native row counts.
- `ProductionPlanning` labels stock shortfall as procurement need and states that no inventory deduction is performed.
- `Operations` labels Delivery Queue as controlled-action Hub-backed operations instead of read-only.

## Deferred Until After May 30

- Native production batch generation.
- Native Recipe/Bundle/IngredientYield calculation ownership.
- Native inventory deduction and purchase order automation.
- Refund migration.
- Subscription automation restart.
- Proof/drop, route optimization, bag credits, and customer-facing delivery notification expansion.

## Safety Confirmation

This phase adds admin visibility and copy changes only, plus read-side function aggregation. It does not add new live write actions, provider calls, customer notifications, inventory deduction, purchase order creation, refunds, broad sync/repair/replay, proof/drop actions, route optimization, or native safeSync cutover.
