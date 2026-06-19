# G47C-FOLLOWUP2 — Rate-Safe Exact Checkout Anomaly Continuation

## 1. FOLLOWUP1 merge result

G47C-FOLLOWUP1 was closed before this continuation.

- PR: `#529`
- merge commit: `a5a78e3c486905d93d5b7aaaaac3197dfafe69a4`
- changed file: `docs/migration/g47c-followup1-rate-safe-exact-anomaly-results.md`
- scope: docs-only/read-only
- Base44 publish: not required

Carry-forward classification from FOLLOWUP1:

```text
checkout_native_chain_anomalies_followup_incomplete_rate_limited
```

G47C-FOLLOWUP2 used the already-deployed read-only exact preview. It did not patch runtime code and did not publish Base44.

## 2. Exact candidates carried forward

FOLLOWUP2 processed the five candidates that were not run in FOLLOWUP1 first, then retried the previously incomplete candidate last only if the run reached it.

Execution order:

1. `NV-MON367R7`
2. `NV-MOILVI17`
3. `NV-MOILSACV`
4. `NV-MOF1S04J`
5. `NV-MODIHVQQ`
6. `NV-MON7CNYB`

`NV-MON7CNYB` was intentionally ordered last because it previously produced a source-incomplete/rate-limit response.

## 3. Exact id resolution results

Each candidate was resolved with an exact Customer App `Order.filter({ order_number })` lookup. No customer name, email, phone, address, provider id, payment id, raw Hub payload, raw native payload, or auth/session data was printed.

| Order | Exact Customer App Order matches | Customer App Order id | Payment status | Captured | Pre-preview hold |
| --- | ---: | --- | --- | --- | --- |
| `NV-MON367R7` | 1 | `69f4cb1ed203be21083f170c` | paid | true | none |
| `NV-MOILVI17` | 1 | `69f0a8f6856c2b8036061bbe` | paid | true | none |
| `NV-MOILSACV` | 1 | `69f0a893be7895847448c585` | paid | true | none |
| `NV-MOF1S04J` | 1 | `69ed6097d94c998b53117465` | paid | true | none |
| `NV-MODIHVQQ` | 1 | `69ebf5b76b2d3897d869762f` | paid | true | none |
| `NV-MON7CNYB` | 1 | `69f4e68387e809a70ec769df` | paid | true | none |

No candidate was excluded before preview by exact identity, payment, refund/cancel, subscription, multi-delivery, or historical-late-mirror metadata.

## 4. Exact preview execution

FOLLOWUP2 invoked the existing deployed function:

```text
previewNativeOrderCutoverReadiness
```

With request contract:

```text
preview_mode=CUSTOMER_CHECKOUT_ORDER_CHAIN_PARITY
mode=EXACT_CHECKOUT_ORDER_CHAIN_PARITY
```

Rate controls:

- one request at a time;
- 12-second cooldown between exact previews;
- no concurrency;
- no immediate retry;
- stop on first rate-limit/source-incomplete response;
- no broad scan rerun.

Executed request ids:

| Order | Request id |
| --- | --- |
| `NV-MON367R7` | `g47c_followup2_exact_checkout_chain_nvmon367r7_20260619T175418` |
| `NV-MOILVI17` | `g47c_followup2_exact_checkout_chain_nvmoilvi17_20260619T175418` |
| `NV-MOILSACV` | `g47c_followup2_exact_checkout_chain_nvmoilsacv_20260619T175418` |
| `NV-MOF1S04J` | `g47c_followup2_exact_checkout_chain_nvmof1s04j_20260619T175418` |

The run stopped at `NV-MOF1S04J` after a rate-limit/source-incomplete response. `NV-MODIHVQQ` and `NV-MON7CNYB` were not run.

## 5. Authoritative exact results

The first three exact previews completed successfully and are decision-grade for their individual records.

| Order | Success | Scan complete | Source context complete | Native chain complete | Hub sync status | Preview primary classification | Blocking evidence | Operational classification |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `NV-MON367R7` | true | true | true | false | failed | `checkout_chain_native_order_missing` | `repair_replay_hold` blocker present | `checkout_chain_repair_replay_hold` |
| `NV-MOILVI17` | true | true | true | false | failed | `checkout_chain_native_order_missing` | `repair_replay_hold` blocker present | `checkout_chain_repair_replay_hold` |
| `NV-MOILSACV` | true | true | true | false | failed | `checkout_chain_native_order_missing` | `repair_replay_hold` blocker present | `checkout_chain_repair_replay_hold` |

These rows are not clean native ShopifyOrder packet candidates because exact repair/replay ambiguity remains present. A future native-order materialization packet requires no repair/replay hold.

## 6. Incomplete / rate-limited result

`NV-MOF1S04J` returned incomplete source context with explicit rate-limit evidence.

| Order | Success | Scan complete | Source context complete | Rate limit detected | Returned primary classification | Operational classification |
| --- | --- | --- | --- | --- | --- | --- |
| `NV-MOF1S04J` | false | false | false | true | `confirmation_fallback_required` | `checkout_chain_exact_preview_incomplete_rate_limited` |

Rate-limit blockers included:

- `ShopifyOrder:rate_limit_detected`
- `FulfillmentTask:rate_limit_detected`
- `OrderReviewQueue:rate_limit_detected`
- `OrderSyncLog:rate_limit_detected`
- `SafeSyncParityLog:rate_limit_detected`

The incomplete response was not used to approve remediation.

## 7. Not-run candidates

The following candidates were preserved for a later cooldown window:

- `NV-MODIHVQQ`
- `NV-MON7CNYB`

`NV-MON7CNYB` remains the previously incomplete FOLLOWUP1 candidate and should continue to run last in any future continuation.

## 8. Chain-origin classifications

| Order | Chain origin classification | Rationale |
| --- | --- | --- |
| `NV-MON367R7` | `unknown_chain_origin` | native-born status was not proven; native chain incomplete |
| `NV-MOILVI17` | `unknown_chain_origin` | native-born status was not proven; native chain incomplete |
| `NV-MOILSACV` | `unknown_chain_origin` | native-born status was not proven; native chain incomplete |
| `NV-MOF1S04J` | `unknown_chain_origin` | source context incomplete due rate limit |
| `NV-MODIHVQQ` | not classified | not run after rate-limit stop |
| `NV-MON7CNYB` | not classified | not run after rate-limit stop |

FOLLOWUP2 found no new natural `native_born_checkout_chain` evidence.

## 9. Remediation map

| Candidate group | Orders | Future action |
| --- | --- | --- |
| Exact repair/replay/manual-review holds | `NV-MON367R7`, `NV-MOILVI17`, `NV-MOILSACV` | manual review; no automated mutation |
| Rate-limited incomplete | `NV-MOF1S04J` | retry exact preview after cooldown only |
| Not run after rate-limit stop | `NV-MODIHVQQ`, `NV-MON7CNYB` | preserve for later exact follow-up |

No clean native ShopifyOrder packet candidate was proven.

No clean FulfillmentTask packet candidate was proven.

No G47D Hub shadow diagnostic prerequisite was met because multiple natural complete native-born checkout chains were not proven.

## 10. No-write verification

A low-rate request-id verification pass checked the executed FOLLOWUP2 request ids across:

- `Order`
- `ShopifyOrder`
- `FulfillmentTask`
- `OrderSyncLog`
- `CommandLog`
- `OrderReviewQueue`
- `Notification`
- `CustomerMessageDeliveryLog`
- `SafeSyncParityLog`
- `PurchaseOrder`
- `OperationalAlert`
- `ComplianceAlert`
- `UserPoints`
- `NuViraCredit`
- `LoyaltyMember`

Result:

```text
request_id_match_count: 0
rate_limit_detected:false
no_write_request_id_evidence:true
```

The executed exact preview responses also reported:

```text
writes_performed:false
stripe_calls:false
shopify_calls:false
hub_calls:false
notifications_sent:false
hub_mutation_performed:false
payment_mutation_performed:false
order_mutation_performed:false
native_order_mutation_performed:false
fulfillment_task_mutation_performed:false
reward_points_mutated:false
command_log_created:false
pii_returned:false
raw_payloads_returned:false
```

FOLLOWUP2 did not mutate Customer App Orders, native ShopifyOrders, FulfillmentTasks, payments, loyalty/credits, Hub records, logs, queues, notifications, inventory, or PurchaseOrders.

## 11. Final classification

```text
checkout_native_chain_anomalies_followup_incomplete_rate_limited
```

FOLLOWUP2 completed three additional authoritative exact previews, but stopped again on a rate-limit/source-incomplete response before all candidates were classified.

## 12. Recommendation

Do not proceed to native ShopifyOrder materialization, FulfillmentTask materialization, Hub write suppression, or G47D shadow planning from FOLLOWUP2.

Recommended next step:

```text
G47C-FOLLOWUP3 — cooldown exact anomaly continuation
```

Run only the remaining held candidates after a cooldown window:

1. `NV-MODIHVQQ`
2. `NV-MON7CNYB`

Keep `NV-MON7CNYB` last.

Proceed to a native ShopifyOrder packet preview only if a later exact response returns a clean candidate with no duplicate identity, payment mismatch, review queue hold, repair/replay hold, historical/subscription/refund/cancel hold, or source-incomplete evidence.

Proceed to a FulfillmentTask packet preview only if a later exact response returns a clean task-missing candidate with exactly one native ShopifyOrder and no mismatch/review/repair/source-incomplete blocker.

Keep Hub writes active.
