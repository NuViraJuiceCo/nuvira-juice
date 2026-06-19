# G47A — Customer checkout and order-creation native boundary audit

## 1. Executive summary

G47A is a docs-only/static/read-only audit of the customer checkout, payment, order submission, order confirmation, and downstream order-sync path.

Current classification:

```text
checkout_customer_app_order_creation_partially_native_but_payment_shopify_hub_authority_active
```

Key findings:

- Customer checkout already creates a Customer App `Order` record before embedded payment completion, but that record is intentionally `pending_payment` and must not enter operational, Hub, production, or delivery flows until Stripe confirms payment.
- Stripe remains the payment authority. Customer App fields such as `payment_status`, `financial_status`, and `payment_captured` mirror Stripe/webhook evidence; they are not independent payment authority.
- Successful embedded checkout is finalized by `stripeWebhook` on `payment_intent.succeeded`. The webhook promotes the Customer App `Order`, then triggers Shopify push, Hub sync, loyalty/credit updates, and customer/admin notifications.
- Native `ShopifyOrder` and native `FulfillmentTask` are not yet proven as the automatic authoritative checkout-created operational chain for all new customer orders. Existing native mirror/ops paths are gated, diagnostic, or default-off.
- Hub order writes remain active. Suppressing Hub writes is not ready because Hub still participates in downstream operational fulfillment, admin parity, repair/retry, and legacy dependency paths.
- Order confirmation primarily displays Customer App `Order` data, but confirmation reliability still depends on Stripe webhook timing and Customer App order finalization. The page contains customer-safe polling and delayed-finalization messaging.
- Apple Pay/Google Pay integration code exists through Stripe `ExpressCheckoutElement`; Apple Pay readiness still requires Stripe/domain/browser/device validation and should remain a separate G47F scope.

G47A does not recommend broad Hub write suppression or a checkout source-of-truth switch. The safest next step is a read-only G47B parity preview over exact recent successful orders.

## 2. Scope and method

This audit inspected checkout and order-creation source only. No runtime code, schema, customer UI, Base44 publish, Stripe action, Shopify action, Hub action, provider call, test order, notification, repair/replay, inventory mutation, or PurchaseOrder creation was performed.

Primary files inspected:

| Area | File |
| --- | --- |
| Customer checkout page | `src/pages/Checkout.jsx` |
| Embedded Stripe payment form | `src/components/checkout/EmbeddedPayment.jsx` |
| Order confirmation page | `src/pages/OrderConfirmation.jsx` |
| Customer order tracker page | `src/pages/OrderTracker.jsx` |
| PaymentIntent creation | `base44/functions/createPaymentIntent/entry.ts` |
| Stripe webhook finalization | `base44/functions/stripeWebhook/entry.ts` |
| Hub order sync | `base44/functions/syncOrderToHub/entry.ts` |
| Shopify order push | `base44/functions/pushOrderToShopify/entry.ts` |
| Confirmation/session lookup | `base44/functions/getOrderBySession/entry.ts` |
| Tracker/detail lookup | `base44/functions/getCustomerOrderDetail/entry.ts` |
| Customer App Order schema | `base44/entities/Order.jsonc` |
| Native ShopifyOrder schema | `base44/entities/ShopifyOrder.jsonc` |
| Native FulfillmentTask schema | `base44/entities/FulfillmentTask.jsonc` |
| Retry/review/parity entities | `base44/entities/OrderSyncLog.jsonc`, `base44/entities/OrderReviewQueue.jsonc`, `base44/entities/SafeSyncParityLog.jsonc` |

## 3. Checkout transaction map

| Step | Function/component | Source file | Reads | Writes | Stripe call | Shopify call | Hub call | Notification | Gate/kill switch | Idempotency/duplicate control | Failure/retry/rollback behavior | Customer-visible outcome |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1. Cart state creation | `useCart`, cart pages/components | `src/pages/Cart.jsx`, `src/pages/Checkout.jsx`, cart context/components | Local cart state and product data | Local cart state | no | no | no | no | none found in checkout path | UI/cart state only | User can return to cart; checkout redirects if empty | Cart items become checkout payload |
| 2. Checkout/customer validation | `Checkout.handlePlaceOrder` | `src/pages/Checkout.jsx` | `UserProfile`, `NuViraCredit`, `UserPoints`, `Subscription`, `SubscriptionPlan`, last `Order`, schedule options, delivery eligibility | `UserProfile` phone/address/SMS consent; optional `BagReturn` request | no direct Stripe call | no | optional non-blocking `syncCustomerToHub` for bag return | no checkout migration gate | Existing pending bag return check by customer/order marker | Validation blocks before payment initialization; bag return sync is non-blocking | Checkout form either blocks with customer copy or starts payment setup |
| 3. Payment initialization | `createPaymentIntent` | `base44/functions/createPaymentIntent/entry.ts` | authenticated user; subscription perks; server-side delivery eligibility; schedule options | Stripe PaymentIntent; pending Customer App `Order`; `CheckoutSession` compatibility row | yes, `stripe.paymentIntents.create` | no | no | no migration gate; customer auth boundary required | Generated order number and Stripe PI metadata; pending Order tied to PI | Schedule/eligibility failures fail closed before PI/Order; Order pre-create failure is non-fatal because webhook can safety-net create from metadata | Embedded payment form receives client secret and pending order number |
| 4. Payment authorization/capture | `EmbeddedPayment` | `src/components/checkout/EmbeddedPayment.jsx` | Stripe Elements state | Stripe payment confirmation | yes, browser Stripe SDK confirms card or Express Checkout | no | no | Stripe domain/browser eligibility for wallets | Stripe PaymentIntent controls payment state | Payment errors stay in checkout and allow retry; success navigates to confirmation | Customer sees card/wallet result and order confirmation route |
| 5. Customer App Order creation | `createPaymentIntent`, `stripeWebhook` | `base44/functions/createPaymentIntent/entry.ts`, `base44/functions/stripeWebhook/entry.ts` | Checkout payload, Stripe PI metadata, `CheckoutSession` | Pre-payment `Order`; payment-success `Order.update`; safety-net `Order.create` when pre-created row is missing | Stripe webhook is authority for paid state | no direct native provider at this step | no | pending order guard blocks operational flow | Existing order by `stripe_payment_intent_id`; terminal-state guard; `payment_captured` finalization guard | Missing pre-created order can be created from PI metadata on webhook; failed payment marks pending order cancelled/abandoned | Pending order becomes scheduled/paid only after Stripe success |
| 6. Native ShopifyOrder creation or mirror | `pushOrderToShopify`; native mirror/ops functions | `base44/functions/pushOrderToShopify/entry.ts`, native mirror/ops functions | Customer App `Order` | External Shopify order; native mirrors only when gated paths run | no | yes, Shopify Admin API draft-order flow | no | May30/native ops and mirror paths are gated/default-off, not broad checkout authority | Shopify push is fire-and-forget from webhook; native duplicate controls exist in separate preview/command work | Shopify push failure is logged/returned in invoked function but does not roll back Stripe success | Customer confirmation does not require Shopify push success |
| 7. FulfillmentTask creation or deferred creation | native ops/mirror paths | native fulfillment functions and `syncOrderToHub` dark-launch support | Customer App `Order`, native `ShopifyOrder`, Hub/parity context | Native `FulfillmentTask` only through gated/default-off/native mirror paths, not proven broad checkout chain | no | no | indirectly through Hub/ops bridge | native ops gates/default-off controls | Existing G43 tracker logic requires exact compatible task for native tracker enrichment | Missing task keeps tracker/history fallback; no checkout rollback | Production/delivery readiness remains deferred/fallback unless task chain is proven |
| 8. Hub order write | `syncOrderToHub` invoked by webhook | `base44/functions/syncOrderToHub/entry.ts`, `base44/functions/stripeWebhook/entry.ts` | paid Customer App `Order`, Stripe payment status, schedule data | Hub external record; `OrderSyncLog` on failures/outcomes | no | no | yes, external Hub endpoint | no suppression approved | pending/abandoned/not-paid block; Hub dedupe/review/reject handling; `OrderSyncLog` retry evidence | Hub HTTP failure creates retry-eligible `OrderSyncLog`; Hub response can be success, dedupe, review, reject, or retry-eligible ambiguous | Checkout payment success is not rolled back solely by Hub failure, but downstream ops may depend on sync/retry |
| 9. Order confirmation response | `OrderConfirmation` | `src/pages/OrderConfirmation.jsx`, `base44/functions/getOrderBySession/entry.ts` | Customer App `Order`; `CheckoutSession`; Stripe session for hosted fallback | no intended writes | `getOrderBySession` may retrieve Stripe checkout session for hosted session lookup | no | no | auth enforced in `getOrderBySession`; direct entity reads rely on app/RLS context | polling avoids immediate false failure; delayed copy says not to place another order | Missing order after paid state shows finalizing/received fallback and account-orders link | Customer sees canonical order details when Customer App `Order` is available |
| 10. Customer history/tracker availability | `OrderHistory.jsx`, `OrderTracker.jsx`, `getCustomerAccountDashboardData`, `getCustomerOrderDetail` | customer pages/functions | Customer App `Order`; limited native `ShopifyOrder`/`FulfillmentTask`; Hub-style fallback | no writes for read surfaces | no | no | no external Hub call in current customer read functions reviewed | G43B/G43C allowlists remain exact and limited | Ownership filtering before native enrichment in G43B/G43C harness/source | Unsupported rows preserve current fallback and remain visible | History/tracker can show Customer App order; limited native enrichment only for exact proven rows |
| 11. Notification behavior | webhook-invoked notification functions | `base44/functions/stripeWebhook/entry.ts` and notification functions | paid Order/payment data | notification/log entities as implemented by notification functions | no direct checkout payment call | no | no | notification policies separate from checkout native migration | notification idempotency keys exist for some in-app notifications | Notification failures are caught/logged and do not roll back payment/order | Customer may receive email/SMS/in-app confirmation after webhook |
| 12. Webhook/retry/reconciliation | `stripeWebhook`, `syncOrderToHub`, monitors/repair functions | `base44/functions/stripeWebhook/entry.ts`, `base44/functions/syncOrderToHub/entry.ts`, monitor/retry functions | Stripe events, Customer App Orders, `OrderSyncLog`, review/parity entities | Order finalization, abandoned checkout marking, refund status, retry logs/review logs | yes through webhook event authority and some lookup paths | yes via pushed Shopify flow | yes through sync/retry paths | yes after success/refund as configured | terminal-state guard, existing PI/session checks, `payment_captured` guard, Hub dedupe/review handling | Repair/replay exists but remains governed; not part of G47A | Delayed recovery can happen without asking customer to reorder |

## 4. Source-of-truth map

| Domain | Current authority | Native/Customer App coverage | Hub dependency | Readiness classification | Notes |
| --- | --- | --- | --- | --- | --- |
| Payment authorization/capture | Stripe | Customer App mirrors `payment_status`, `financial_status`, `payment_captured`, and Stripe ids | Hub is not payment authority | `blocked_by_payment_authority`, `payment_webhook_reconciliation_ready` only after webhook proof | Native fields must not override Stripe without webhook/reconciliation evidence. |
| Customer App Order identity | Customer App `Order` once created/finalized | Pre-created before payment as `pending_payment`; finalized by webhook | Hub not required to create Customer App row | `customer_app_order_creation_ready` with caveat | The pending row is intentionally non-operational until Stripe success. |
| Canonical order number | `createPaymentIntent` generated `NV-*` order number and Customer App `Order.order_number` | Used in confirmation, history, tracker, metadata | Hub may store/read same value downstream | `checkout_idempotency_ready` only for exact Stripe PI path, not broad suppression | Generation is timestamp-based; duplicate-risk preview should verify no collision/duplicate PI scenarios. |
| Native ShopifyOrder | Not proven automatic checkout authority | Native schema/mirror/ops paths exist, but checkout still calls external Shopify push and Hub sync | Hub/Shopify still active | `blocked_by_missing_native_chain`, `native_shopify_order_creation_ready` not proven | A future G47B/G47C must prove native row creation or mirror timing for recent paid orders. |
| FulfillmentTask | Operational/native task chain, not direct checkout authority | Native `FulfillmentTask` exists but exact task linkage is required for customer tracker enrichment | Hub/ops fallback still active | `blocked_by_missing_native_chain`, `native_fulfillment_task_creation_ready` not proven | Customer tracker can only use native task when exact compatible task exists. |
| Hub order write | Hub bridge remains live writer for operations/fallback | Native dark-launch/preview paths exist but do not replace Hub | Active | `hub_checkout_write_required`, `hub_write_suppression_held` | Suppression requires native chain plus customer/admin read proofs. |
| Order confirmation | Customer App `Order` display with Stripe/session polling fallback | Confirmation shows Customer App order number/items/total/date | Hub is not directly displayed in confirmation | `order_confirmation_native_ready` partially; `customer_confirmation_fallback_required` | Needs G47B smoke/proof for delayed Hub sync and delayed webhook cases. |
| Customer order history | Customer App `Order` canonical; G43B native enrichment exact allowlist | Limited native operational enrichment live for exact rows only | Hub/fallback still active | `customer_history_native_ready_limited` | No broad eligibility from G47A. |
| Customer order tracker | Customer App `Order` canonical; G43C exact tracker enrichment | Limited native tracker enrichment live only for `NV-MQHJR3V2` | Hub/fallback still active | `customer_tracker_native_ready_limited` | `NV-MPZNKGNT` still requires owning-customer smoke before tracker allowlist expansion. |
| Refund/cancellation | Stripe refund/payment authority and existing refund cascade | Customer App/native mirror statuses can update from refund handlers | Hub refund cascade remains active | `blocked_by_payment_authority` | G47A must not alter refund source-of-truth. |
| Notifications | Existing notification functions invoked after webhook success | Customer message logs/idempotency where implemented | Not Hub authority | notification policy held outside checkout migration | No notification change in G47A. |

## 5. Idempotency and duplicate-risk audit

| Risk | Current control observed | Remaining gap | Classification |
| --- | --- | --- | --- |
| Browser double-click / duplicate submit | `Checkout` uses `isSubmitting`, and payment form buttons disable while submitting | A read-only G47B should prove multiple `createPaymentIntent` calls cannot create confusing pending duplicates for the same cart/session | `duplicate_order_risk` |
| Page refresh during payment | Checkout clears stale local/session pending checkout markers and order confirmation polls by session/order number | Embedded PI path uses order number and PI query; refresh during in-page payment still needs live smoke evidence | `customer_confirmation_fallback_required` |
| Successful payment with failed pre-created Order | `stripeWebhook` safety-net creates Customer App `Order` from PI metadata | Safety-net created order can lack full item detail if metadata/session context is incomplete | `payment_captured_order_missing`, `repair_replay_required` |
| Order pre-created but payment pending | `pending_payment`, `payment_status: pending`, `payment_captured:false`; `syncOrderToHub` blocks pending/abandoned orders | Abandoned pending rows require cleanup/reconciliation | `order_created_payment_pending` |
| Order finalized but Hub sync failed | `syncOrderToHub` failures create retry-eligible `OrderSyncLog` | Customer confirmation may still succeed while operations require retry/manual review | `customer_order_created_hub_sync_failed`, `repair_replay_required` |
| Webhook arriving before frontend completion | Confirmation page polls until Order appears/finalizes | Need G47B live timing proof across card/wallet flows | `webhook_replay_governed` |
| Stripe webhook replay / duplicate event | Existing order lookup by PI/session, terminal guards, `payment_captured` guard | Need exact event replay proof for recent checkout fixtures before broader migration claims | `webhook_replay_governed` |
| Duplicate Shopify push | `pushOrderToShopify` is invoked fire-and-forget; this audit did not find a checkout-level native idempotency gate for external Shopify push | Needs G47C diagnostics and/or Shopify idempotency audit; do not call Shopify in G47A | `duplicate_native_order_risk` |
| Duplicate native ShopifyOrder | Native mirror/ops paths are gated/default-off; exact identity matching exists in customer-read work | Broad checkout-native creation chain not proven | `duplicate_native_order_risk`, `blocked_by_missing_native_chain` |
| Duplicate FulfillmentTask | G43C requires exactly one compatible task for tracker enrichment | Checkout path does not prove exactly one task is created for every paid order | `duplicate_task_risk`, `blocked_by_missing_native_chain` |
| Confirmation page loaded with missing order | Polling and timeout copy avoid telling customer to reorder | Needs G47B proof that paid-but-missing order is recovered or escalated | `customer_confirmation_fallback_required` |
| Abandoned PaymentIntent | `payment_intent.payment_failed` marks pending orders cancelled/abandoned; cleanup function exists separately | Needs recovery coverage for incomplete/expired PIs and user-visible states | `repair_replay_required` |
| Payment captured but customer sees failure | Confirmation timeout says payment/order received and directs to account orders | Need live smoke with webhook delays; no checkout change from G47A | `payment_authorized_order_missing`, `payment_captured_order_missing` |

## 6. Hub necessity audit

| Hub touchpoint | Source | Checkout blocking? | Retry/queue behavior | Current purpose | Classification | Suppression readiness |
| --- | --- | --- | --- | --- | --- | --- |
| Bag return customer event | `Checkout.handlePlaceOrder` calls `syncCustomerToHub` non-blocking when bag return requested | no | caught/ignored in checkout | Customer/bag return continuity | `hub_write_best_effort` | Not part of checkout order suppression. |
| Paid one-time order sync | `stripeWebhook` invokes `syncOrderToHub` after `payment_intent.succeeded` | not a Stripe payment blocker; downstream ops dependency remains | failure creates `OrderSyncLog` | Hub operational order creation/update/review | `hub_write_retry_queued`, `hub_fallback_required` | Not ready. Native chain and read surfaces are not broadly proven. |
| Hub dedupe/review/reject handling | `syncOrderToHub` response handling | not payment blocking | logs success, dedupe, review, reject, retry-eligible ambiguous outcomes | Operational reconciliation and manual review | `hub_write_retry_queued` | Not ready. |
| Native safe-sync dark launch | `syncOrderToHub` optional preview/compare path | no | preview/parity only unless separately gated | Migration evidence while Hub remains writer | `hub_write_shadow_candidate` | Candidate for future G47D docs/plan only. |
| Manual Hub push/recovery | `manualPushOrderToHub`/recovery paths referenced in sync architecture | not customer checkout blocking | governed repair/replay | Operational recovery | `repair_replay_required` | Held. |

Conclusion: Hub order writes remain necessary for operational continuity. A future Hub write suppression plan must be default-off, exact, shadowed first, and preceded by proof that Customer App `Order`, native `ShopifyOrder`, native `FulfillmentTask`, customer history, customer tracker, admin order, delivery, production, and retry/review paths all remain safe.

## 7. Order-confirmation audit

| Question | Finding | Gap |
| --- | --- | --- |
| Displayed order number source | The confirmed state displays `order.order_number` from Customer App `Order`. | Need G47B smoke with recent successful order and delayed webhook timing. |
| Totals and line items | Confirmation renders `order.items` and `order.total` from Customer App `Order`. | Safety-net orders created from PI metadata may have limited item detail if pre-created order/session context is missing. |
| Payment state | Confirmation polls `getOrderBySession` for hosted session and direct Customer App `Order` for `order_number`/path id. Pending embedded order keeps polling until paid/finalized. | Direct entity lookups rely on app/RLS context; G47B should verify authenticated ownership and no cross-customer exposure for confirmation links. |
| Delivery date/type | Confirmation displays `estimated_delivery_date` and fulfillment type from Customer App `Order`. | Webhook may recalculate schedule from event time; G47B should compare checkout selected schedule vs finalized schedule. |
| Tracker handoff | Link is `/order-tracker/${order.order_number || order.id}`. | Tracker remains limited-native and fallback-backed. No broad tracker cutover. |
| Order-history handoff | Link is `/account/orders`. | History is Customer App row canonical with G43B exact native enrichment only. |
| Delayed Hub sync behavior | Confirmation does not directly require Hub response to display the Customer App `Order`. | Operations can still require Hub retry if sync failed. |
| Raw provider payloads | Customer confirmation renders safe fields, not raw Stripe/Hub/Shopify payloads. | Debug/console logs should remain non-customer-facing and must not be expanded. |
| Duplicate-order prevention messaging | Loading/timeout states explicitly tell the customer not to place another order. | Need G47B evidence for payment captured/order missing edge cases. |

Order-confirmation classification:

```text
order_confirmation_native_ready_partial_customer_app_order_canonical_webhook_timing_proof_required
```

## 8. Apple Pay finding

Apple Pay/Google Pay integration is present through Stripe `ExpressCheckoutElement` in `src/components/checkout/EmbeddedPayment.jsx`.

Observed implementation:

- `ExpressCheckoutElement` is rendered under a wallet checkout section.
- `onReady` records `availablePaymentMethods` and can report Apple Pay / Google Pay availability.
- `onConfirm` calls `stripe.confirmPayment` against the existing PaymentIntent `clientSecret`.
- `createPaymentIntent` uses `payment_method_types: ['card']`, which supports card-backed wallet flows through Stripe Express Checkout without enabling redirect bank methods.
- A debug bar exists behind `?debug=1` and is hidden by default.

Classification:

```text
apple_pay_integration_present_config_blocked
apple_pay_live_device_validation_required
```

Remaining Apple Pay proof belongs in G47F:

- Stripe Apple Pay domain registration/configuration confirmation.
- Published-domain Safari/iOS device smoke.
- Eligibility behavior when the app is in an iframe/preview, installed PWA, Safari, Chrome iOS, and desktop browsers.
- Confirmation that unavailable wallets fail hidden/disabled safely without blocking card checkout.
- No change to Apple Pay in G47A.

## 9. Page/domain readiness table

| Page/domain | Current source of truth | Hub dependency | Stripe/Shopify dependency | Native coverage | Migration readiness | Exact gap | Safest next phase |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Cart | Local/customer app state plus product data | none for cart itself | none at cart state level | Customer App UI | ready for read/UI scope | Not order authority | Keep unchanged |
| Checkout form | Customer App UI plus UserProfile/schedule/eligibility | optional bag-return customer sync | delivery eligibility uses Google Maps via backend; payment not started until PI | Customer App form and profile writes | partially ready | Form still mutates profile/bag-return before payment; no checkout migration change | G47B evidence only |
| Payment initialization | `createPaymentIntent` | none before order sync | Stripe PaymentIntent and delivery provider/API for eligibility | Pre-created Customer App `Order` | partially ready | PI creation and pending Order duplicate/idempotency proof needed | G47B |
| Payment completion | Stripe webhook | none for payment authority | Stripe is authority | Customer App mirrors paid state | ready only under Stripe webhook authority | No native payment authority switch allowed | G47B/G47C |
| Customer App Order creation | `createPaymentIntent` and `stripeWebhook` | not required for row creation | Stripe success required for operational paid row | Customer App `Order` canonical | `customer_app_order_creation_ready` with caveats | Safety-net item completeness and duplicate PI/order proof | G47B |
| Native ShopifyOrder creation | Shopify push and/or gated native mirror/ops | Hub/ops still active | External Shopify Admin API active | Native mirrors exist but not broad checkout chain | not ready | Automatic native row creation not proven | G47C |
| FulfillmentTask creation | operational/gated native paths and/or Hub downstream | Hub/ops fallback active | no direct Stripe dependency | Native task exists for proven rows only | not ready | Exactly one task per new checkout not proven | G47C |
| Hub order sync | `syncOrderToHub` | active | no payment authority but uses Stripe status | dark-launch/preview only | required | Suppression unsafe | G47D docs/plan after G47B/G47C |
| Order confirmation | Customer App `Order` | not directly displayed | may use Stripe session lookup in hosted fallback | Customer App canonical display | partially ready | Auth/ownership and delayed webhook proof | G47B, possible G47E |
| Order history | Customer App `Order`; G43B exact native enrichment | fallback active | none direct | limited exact native enrichment | limited ready | No broad automatic eligibility | Hold; no G47 change |
| Order tracker | Customer App `Order`; G43C exact native enrichment | fallback active | none direct | limited exact native enrichment | limited ready | `NV-MPZNKGNT` tracker needs owning-customer smoke; no broad tracker | Hold; separate G43C-LIVE1B only with owner session |
| Payment failure/retry | Stripe failure event and checkout UI | no Hub write for failed payment | Stripe failure authority | Customer App pending order can be cancelled/abandoned | partially ready | Abandoned PI cleanup/reconciliation proof | G47B/G47C |
| Refund/cancellation | Stripe refund webhook and existing refund logic | Hub refund cascade active | Stripe authority | Native mirror refund parity still governed | held | Refund source-of-truth must remain Stripe/Hub/payment | Do not modify in G47A |
| Apple Pay | Stripe Express Checkout | none direct | Stripe/domain/browser/device eligibility | UI integration present | config/live-smoke required | Domain/device validation | G47F |
| Notifications | webhook-triggered notification functions | no Hub authority, but customer messages/logs active | no direct provider except notification service | existing notification paths | held | Notification policy not part of checkout migration | No G47A change |

## 10. Native checkout readiness classifications

| Classification | G47A result | Reason |
| --- | --- | --- |
| `customer_app_order_creation_ready` | partial yes | Customer App `Order` is created pre-payment and finalized by webhook, but pending rows and safety-net path require duplicate/loss proof. |
| `native_shopify_order_creation_ready` | no | Checkout invokes external Shopify push and/or gated native mirror/ops; broad native authority is not proven. |
| `native_fulfillment_task_creation_ready` | no | FulfillmentTask creation is not proven immediate/exact for every new checkout order. |
| `payment_webhook_reconciliation_ready` | partial | Strong webhook guards exist, but G47B should preview exact recent orders and replay/duplicate evidence. |
| `checkout_idempotency_ready` | partial | Stripe PI/idempotency and Order finalization guards exist; frontend duplicate PI/order edge cases need proof. |
| `order_confirmation_native_ready` | partial | Confirmation displays Customer App `Order`, but delayed webhook/ownership/safety-net proof remains. |
| `customer_history_native_ready_limited` | yes, limited | G43B is exact allowlist only. |
| `customer_tracker_native_ready_limited` | yes, limited | G43C is live only for `NV-MQHJR3V2`. |
| `hub_checkout_write_required` | yes | Hub sync remains active for operational continuity. |
| `hub_checkout_write_shadow_candidate` | yes, future | Existing dark-launch/preview concepts can support G47D planning. |
| `hub_write_suppression_held` | yes | Native chain and customer/admin reads are not broad-proven. |
| `apple_pay_integration_present_config_blocked` | yes | Stripe Express Checkout exists; config/device proof remains. |
| `apple_pay_integration_missing` | no | Integration code is present. |
| `apple_pay_live_device_validation_required` | yes | Real Safari/iOS/published-domain validation is still required. |
| `blocked_by_payment_authority` | yes for payment/refund replacement | Stripe remains authority. |
| `blocked_by_duplicate_risk` | partial | Checkout duplicates need G47B/G47C evidence. |
| `blocked_by_repair_replay` | yes for broad migration | Recovery/retry must remain governed. |
| `blocked_by_missing_native_chain` | yes | Native ShopifyOrder/FulfillmentTask chain not proven for broad checkout. |
| `blocked_by_customer_read_dependency` | partial | History/tracker are limited native only with fallback. |

## 11. Recommended G47B–G47F sequence

1. **G47B — read-only checkout/order-creation parity preview**
   - Inspect exact recent successful orders.
   - Compare Stripe payment evidence, Customer App `Order`, native `ShopifyOrder`, native `FulfillmentTask`, Hub sync outcome, notification evidence, and confirmation/history/tracker visibility.
   - No writes, provider calls, or replay.

2. **G47C — checkout-native chain diagnostics**
   - Admin-only read diagnostic for payment/order/native-chain divergence.
   - Identify `payment_captured_order_missing`, `customer_order_created_native_order_missing`, duplicate native identity, task missing, Hub sync failed, and repair/replay required states.
   - No customer behavior change.

3. **G47D — Hub order-write shadow/suppression plan**
   - Docs first, then default-off preview if approved.
   - Keep Hub active while native chain and read surfaces are proven.
   - No suppression from G47A evidence alone.

4. **G47E — order-confirmation native-authority patch**
   - Only if G47B shows confirmation still depends on a non-native/Hub path.
   - Customer App `Order` remains canonical.
   - Preserve delayed-payment/finalizing customer copy.

5. **G47F — Apple Pay integration/config audit and patch**
   - Separate implementation and live Safari/iOS validation.
   - Confirm Stripe domain config, wallet availability, and fallback behavior.
   - No payment-flow broadening without explicit approval.

Do not proceed to broad checkout native cutover, Hub write suppression, refund source-of-truth changes, or notification policy changes from G47A alone.

## 12. Hard stops

- No checkout write changes.
- No payment flow changes.
- No live test transaction.
- No PaymentIntent or Checkout Session creation.
- No payment capture.
- No refund change.
- No Stripe call.
- No Shopify call.
- No Hub call.
- No provider call.
- No Hub write suppression.
- No Hub fallback disablement.
- No Customer App `Order` creation or mutation.
- No native `ShopifyOrder` creation or mutation.
- No native `FulfillmentTask` creation or mutation.
- No notification/message send.
- No repair/replay/backfill.
- No inventory deduction.
- No PurchaseOrder creation.
- No Apple Pay change.
- No customer confirmation cutover.
- No source-of-truth switch.

## 13. Recommendation

Do not treat checkout as fully native-backend authoritative yet.

Recommended classification carry-forward:

```text
checkout_customer_app_order_creation_partially_native_hub_write_required_native_chain_unproven
```

Proceed next with **G47B — read-only checkout/order-creation parity preview** over exact recent successful orders. G47B should prove payment/order/native-chain/idempotency evidence without writes. If G47B finds reliable recent paid orders with complete Customer App `Order`, native `ShopifyOrder`, native `FulfillmentTask`, Hub sync outcome, and customer confirmation/history/tracker visibility, then G47C can add admin diagnostics. Hub write suppression should remain held until after G47B/G47C evidence and a separate G47D suppression/shadow plan.

Apple Pay should remain separate as G47F because the integration code is present, but Stripe/domain/Safari/iOS eligibility must be verified independently.

No Base44 publish is required for G47A.
