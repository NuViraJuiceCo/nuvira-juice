# G47C — Checkout Native-Chain Anomaly Diagnostics

## 1. Executive summary

G47C converts the G47B bounded checkout/order-chain counts into a concrete diagnostics map for paid/captured Customer App orders that do not yet prove broad native checkout independence.

This phase is read-only and diagnostics-only. It does not change checkout, payment, Hub writes, customer confirmation, order history, tracker behavior, native order materialization, fulfillment task materialization, notifications, loyalty, or repair/replay behavior.

Final G47B classification carried forward:

```text
checkout_order_chain_parity_candidates_found_hub_writes_held
```

G47C does not suppress Hub writes.

## 2. G47B findings

G47B is merged and live:

- PR: `#527`
- merge commit: `4542c5a5e12e36a5a9a08b835997f60270b190c6`
- live preview mode: `CUSTOMER_CHECKOUT_ORDER_CHAIN_PARITY`

Bounded scan evidence:

| Metric | Count |
| --- | ---: |
| Unique Customer App orders | 52 |
| Paid/captured orders | 13 |
| Pending payment | 19 |
| Refunded/cancelled | 38 |
| Native ShopifyOrder present | 4 |
| Native FulfillmentTask present | 3 |
| Complete native chains | 2 |
| Hub sync success | 2 |
| Hub sync failed | 23 |
| Confirmation ready | 13 |
| History ready | 14 |
| Tracker ready | 3 |
| Repair/replay hold | 22 |
| Fallback required | 52 |
| Review required | 52 |

Complete chains proven by G47B:

- `NV-MQHJR3V2`
- `NV-MPZNKGNT`

These chains prove exact native operational parity for those two records, not broad checkout independence.

## 3. Candidate selection

G47C selects exact candidates from these groups:

1. paid/captured one-time Customer App order with no native ShopifyOrder;
2. paid/captured one-time Customer App order with native ShopifyOrder but no compatible FulfillmentTask;
3. complete native chain with exact Hub sync failed or pending;
4. payment/order mismatch;
5. repair/replay hold;
6. review queue hold.

G47C excludes these from native-chain remediation:

- refunded orders;
- cancelled orders;
- payment-not-ready orders;
- subscriptions;
- multi-delivery orders;
- known historical late mirrors unless explicitly classified as historical context;
- duplicate identity rows;
- rows whose Customer App identity cannot be resolved exactly.

The selection does not use customer name, email, phone, address, approximate amount, approximate creation date, newest-row selection, or delivery date alone.

## 4. Exact-preview method

G47C uses the already-deployed G47B read-only exact preview:

```text
preview_mode=CUSTOMER_CHECKOUT_ORDER_CHAIN_PARITY
mode=EXACT_CHECKOUT_ORDER_CHAIN_PARITY
```

No runtime patch is required for G47C because the existing exact preview already returns the safe fields needed for diagnostics:

- Customer App Order match count;
- native ShopifyOrder match count;
- compatible FulfillmentTask count;
- payment captured/status consistency;
- Hub sync status category;
- repair/replay/review blockers;
- confirmation/history/tracker readiness booleans;
- duplicate identity risk booleans;
- mutation/provider/PII/raw-payload safety flags.

Exact preview request ids use:

```text
g47c_exact_checkout_chain_anomaly_<order>_<timestamp>
```

## 5. Live exact diagnostic evidence

G47C attempted exact previews for the bounded-scan candidate set with safe output only.

The run resolved exact Customer App Order identity for all selected candidates before invoking exact previews. It did not retry any source-incomplete response and treated later exact responses that returned rate-limit/source-incomplete flags as non-authoritative evidence only.

### Authoritative exact results before rate limiting

| Order | Customer App matches | Native matches | Task matches | Hub status | Primary G47C classification | Remediation bucket | Origin |
| --- | ---: | ---: | ---: | --- | --- | --- | --- |
| `NV-MQHJR3V2` | 1 | 1 | 1 | success | `checkout_chain_complete_hub_write_required` | no action / retain current behavior | controlled native mirror chain |
| `NV-MPZNKGNT` | 1 | 1 | 1 | success | `checkout_chain_complete_hub_write_required` | no action / retain current behavior | controlled native mirror chain |
| `NV-TEST-G15E-DELIVERED` | 1 | 0 | 0 | failed | `checkout_chain_repair_replay_hold` | repair/replay/manual review | unknown |

`NV-MQHJR3V2` and `NV-MPZNKGNT` remain complete native chains, but both still require Hub writes to remain active.

`NV-TEST-G15E-DELIVERED` is not a clean native-order packet candidate because exact log evidence includes repair/replay hold.

### Rate-limited / incomplete exact follow-up

The following selected candidates resolved exact Customer App identity but their exact preview responses were not decision-grade because the live preview returned rate-limit/source-incomplete results:

- `NV-MP5SOQLJ`
- `NV-MOPV2CIK`
- `NV-MOOV82PT`
- `NV-MOOPFCUS`
- `NV-MON7CNYB`
- `NV-MON367R7`
- `NV-MOILVI17`
- `NV-MOILSACV`
- `NV-MOF1S04J`
- `NV-MODIHVQQ`
- `SUB-SK-4X-20260425`

These rows require a later rate-safe exact follow-up before any remediation packet is planned. G47C does not claim them as clean native-order packet candidates from incomplete exact previews.

## 6. Per-order classification rules

G47C uses one primary classification per candidate:

| Classification | Meaning |
| --- | --- |
| `checkout_chain_complete_hub_write_required` | Native chain is complete and customer surfaces are ready, but Hub writes remain operationally required. |
| `checkout_chain_native_order_missing` | Paid/captured canonical Customer App Order exists, but no native ShopifyOrder exists. |
| `checkout_chain_task_missing` | Customer App Order and native ShopifyOrder exist, but no compatible FulfillmentTask exists. |
| `checkout_chain_hub_sync_failed_native_complete` | Native chain is complete; exact Hub sync failed. |
| `checkout_chain_hub_sync_failed_native_incomplete` | Hub sync failed and native chain is also incomplete. |
| `checkout_chain_payment_order_mismatch` | Stripe-linked payment state and Customer App/native order state disagree. |
| `checkout_chain_repair_replay_hold` | Exact log evidence shows repair/replay ambiguity. |
| `checkout_chain_review_queue_hold` | Exact review queue evidence blocks automatic action. |
| `checkout_chain_historical_late_mirror_hold` | Order is historical/late context and not evidence of native-born checkout. |
| `checkout_chain_duplicate_identity_risk` | Multiple exact Customer App/native/task candidates exist. |
| `checkout_chain_manual_review_required` | Evidence is incomplete or contradictory. |

## 7. Remediation buckets

G47C maps anomalies into future action buckets only. It does not execute remediation.

| Bucket | Criteria | G47C action |
| --- | --- | --- |
| No action / retain current behavior | refunded/cancelled/payment-risk, historical late mirror, subscription/multi-delivery, complete chain where Hub remains required | Hold current behavior. |
| Exact native ShopifyOrder packet candidate | paid/captured one-time Customer App Order, exact identity, native ShopifyOrder missing, no review/repair/mismatch hold | Plan only after exact follow-up proves clean. |
| Exact FulfillmentTask packet candidate | exact Customer App Order, exactly one native ShopifyOrder, task missing, no review/repair/mismatch hold | Plan only after exact follow-up proves clean. |
| Hub retry diagnostics candidate | native chain complete, exact Hub sync failed/pending, no payment/identity mismatch | Diagnostics only; do not retry in G47C. |
| Payment reconciliation hold | payment/order mismatch | Stripe remains authoritative. |
| Repair/replay/manual review | exact log or queue hold | No automated mutation. |

## 8. Native-born versus mirror findings

Current complete chains are not sufficient proof of broad native-born checkout automation:

| Order | Origin classification | Implication |
| --- | --- | --- |
| `NV-MQHJR3V2` | controlled native mirror chain | Exact pilot proof only. |
| `NV-MPZNKGNT` | controlled native mirror chain | Exact delivered/reconciled proof only. |
| `NV-MP5SOQLJ` | historical late mirror hold | Not native-born checkout proof. |

A future Hub-write shadow plan requires multiple natural native-born paid/captured checkout chains.

## 9. Hub necessity finding

Hub writes remain required.

Reasons:

- only 2 of 13 paid/captured orders have complete native chains;
- complete chains are controlled/proven records, not broad native-born checkout evidence;
- 10 bounded-scan rows were classified as native-order missing before exact follow-up;
- exact follow-up was incomplete due rate limiting/source-incomplete responses;
- repair/replay evidence exists on at least one exact anomaly;
- OrderSyncLog coverage was truncated in G47B, so broad Hub-sync parity is not authoritative.

G47C does not approve Hub suppression or shadow writes.

## 10. Payment authority holds

Stripe remains authoritative for:

- payment authorization;
- capture;
- refund state;
- cancellation/payment-risk interpretation.

Native production or delivery state must not override payment state.

## 11. Apple Pay carry-forward

G47C carries forward G47B Apple Pay diagnostics only:

```text
express_checkout_code_present:true
apple_pay_button_integration_present:true
apple_pay_domain_registration_required:true
apple_pay_domain_registration_status_known:false
safari_ios_validation_required:true
apple_pay_live_device_test_completed:false
apple_pay_patch_ready:false
```

G47C does not register domains, change Stripe configuration, modify checkout UI, create a Payment Request, or run a live transaction.

## 12. Hard stops

Do not:

- change checkout;
- create or update Customer App Orders;
- create or update native ShopifyOrders;
- create or update FulfillmentTasks;
- run Hub sync/retry;
- run repair/replay;
- suppress Hub writes;
- call Stripe;
- call Shopify;
- call Hub;
- call providers;
- send notifications;
- mutate loyalty/credits;
- change OrderConfirmation;
- change customer order history or tracker behavior;
- publish customer UI;
- create logs or queues.

## 13. Test coverage

Fixture harness:

```text
scripts/migration/run-g47c-checkout-native-chain-anomaly-diagnostics-tests.mjs
```

Coverage includes:

- missing native order;
- missing task;
- complete native chain with Hub success;
- complete native chain with Hub failure;
- incomplete native chain with Hub failure;
- payment/order mismatch;
- repair/replay hold;
- review queue hold;
- historical late mirror;
- duplicate Customer App identity;
- duplicate native identity;
- duplicate task identity;
- refund/cancel exclusion;
- subscription/multi-delivery exclusion;
- native-order packet candidate;
- task packet candidate;
- Hub retry diagnostics candidate;
- payment reconciliation hold;
- native-born versus mirror classification;
- no fuzzy identity matching;
- no PII/raw payload output;
- no writes/provider calls/notifications/Hub mutation/repair-replay/log creation.

## 14. No-write confirmation

G47C is docs/static plus fixture-only harness. The only live activity was read-only exact preview diagnostics through the already-deployed G47B preview.

No checkout was submitted. No payment was captured or refunded. No Order, ShopifyOrder, FulfillmentTask, Hub record, provider record, notification, loyalty/credit, log, queue, inventory, or PurchaseOrder mutation was performed.

## 15. Recommendation

Do not proceed to Hub write suppression.

Recommended next phase:

```text
G47C-FOLLOWUP1 — rate-safe exact anomaly follow-up
```

Run exact previews in smaller batches after a cooldown for only the incomplete candidate rows. Proceed to materialization planning only if exact follow-up proves clean candidates with:

- one paid/captured one-time Customer App Order;
- no review/repair/replay hold;
- no payment mismatch;
- exact missing native ShopifyOrder or exact missing FulfillmentTask;
- no duplicate identity risk.

If multiple clean missing-native-order candidates exist, plan a default-off exact native-order materialization command.

If multiple clean task-only gaps exist, plan exact FulfillmentTask materialization.

If complete native-born chains exist with Hub failures while customer/admin reads remain correct, proceed to a G47D shadow plan, not suppression.

Apple Pay remains separate G47F.
