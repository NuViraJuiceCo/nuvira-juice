# G47C-FOLLOWUP1 — Rate-Safe Exact Checkout Anomaly Results

## 1. G47C closeout

G47C was merged as docs/harness-only and required no Base44 publish.

- PR: `#528`
- merge commit: `88ae238d7b640568e5f8b6a9d4e93cc9fa0366f6`
- merged scope:
  - `docs/migration/g47c-checkout-native-chain-anomaly-diagnostics.md`
  - `scripts/migration/run-g47c-checkout-native-chain-anomaly-diagnostics-tests.mjs`

Carry-forward classification:

```text
checkout_native_chain_anomaly_diagnostics_partial_exact_followup_required
```

Checkout remains unchanged. Hub writes remain active.

## 2. Candidate recovery method

FOLLOWUP1 recovered the incomplete candidate set from the G47C diagnostics document and local exact-run artifacts. It did not rerun the G47B bounded scan and did not inspect all 52 orders.

For each candidate, FOLLOWUP1 performed one exact Customer App `Order.filter({ order_number })` lookup to resolve the Customer App Order id and confirm one exact Customer App Order match.

The recovery output retained only:

- order number;
- Customer App Order id;
- selection reason;
- prior preview status;
- safe payment/status booleans used for eligibility filtering.

It did not print customer name, customer email, phone, address, Stripe IDs, Shopify IDs, payment method details, raw Hub payloads, raw native payloads, or auth/session data.

## 3. Candidate set and pre-preview filtering

### Excluded before exact preview

| Order | Customer App Order id | Selection reason | Hold reason |
| --- | --- | --- | --- |
| `NV-MP5SOQLJ` | `6a060df457fc07751f3c7ded` | historical late mirror / repair context | `historical_late_mirror_hold` |
| `SUB-SK-4X-20260425` | `69f90ce347d065ce76411da8` | payment/order mismatch subscription context | `payment_not_ready_or_not_captured` and subscription-context hold |

These rows are not native-chain remediation candidates.

### Eligible for exact follow-up preview

| Execution order | Order | Customer App Order id | Selection reason | Prior preview status |
| ---: | --- | --- | --- | --- |
| 1 | `NV-MOPV2CIK` | `69f75a7e8b7a8b52005e3ab8` | native order missing from bounded scan | source incomplete |
| 2 | `NV-MOOV82PT` | `69f66f606f87ded4176f604b` | native order missing from bounded scan | source incomplete |
| 3 | `NV-MOOPFCUS` | `69f6495089fd52dfcb359ba3` | native order missing from bounded scan | source incomplete |
| 4 | `NV-MON7CNYB` | `69f4e68387e809a70ec769df` | native order missing from bounded scan | source incomplete |
| held | `NV-MON367R7` | `69f4cb1ed203be21083f170c` | native order missing from bounded scan | source incomplete |
| held | `NV-MOILVI17` | `69f0a8f6856c2b8036061bbe` | native order missing from bounded scan | source incomplete |
| held | `NV-MOILSACV` | `69f0a893be7895847448c585` | native order missing from bounded scan | source incomplete |
| held | `NV-MOF1S04J` | `69ed6097d94c998b53117465` | native order missing from bounded scan | source incomplete |
| held | `NV-MODIHVQQ` | `69ebf5b76b2d3897d869762f` | native order missing from bounded scan | source incomplete |

## 4. Exact preview execution order

FOLLOWUP1 used the existing deployed G47B read-only preview:

```text
preview_mode=CUSTOMER_CHECKOUT_ORDER_CHAIN_PARITY
mode=EXACT_CHECKOUT_ORDER_CHAIN_PARITY
```

Requests were run sequentially with a 12-second cooldown. No previews were run concurrently. The run stopped on the first rate-limit/source-incomplete result.

Executed request ids:

| Order | Request id |
| --- | --- |
| `NV-MOPV2CIK` | `g47c_followup1_exact_checkout_chain_nvmopv2cik_20260619174314` |
| `NV-MOOV82PT` | `g47c_followup1_exact_checkout_chain_nvmoov82pt_20260619174314` |
| `NV-MOOPFCUS` | `g47c_followup1_exact_checkout_chain_nvmoopfcus_20260619174314` |
| `NV-MON7CNYB` | `g47c_followup1_exact_checkout_chain_nvmon7cnyb_20260619174314` |

## 5. Authoritative candidate results

The first three exact previews completed successfully and are decision-grade for their individual records.

| Order | Customer App matches | Native ShopifyOrder matches | FulfillmentTask matches | Hub status | Repair/replay hold | Primary classification | Future action |
| --- | ---: | ---: | ---: | --- | --- | --- | --- |
| `NV-MOPV2CIK` | 1 | 0 | 0 | failed | yes | `checkout_chain_repair_replay_hold` | manual review |
| `NV-MOOV82PT` | 1 | 0 | 0 | failed | yes | `checkout_chain_repair_replay_hold` | manual review |
| `NV-MOOPFCUS` | 1 | 0 | 0 | failed | yes | `checkout_chain_repair_replay_hold` | manual review |

These rows are not clean native ShopifyOrder packet candidates because exact repair/replay ambiguity exists.

## 6. Incomplete / rate-limited candidates

`NV-MON7CNYB` was the fourth executed exact preview and returned source-incomplete/rate-limit evidence:

| Order | Customer App matches | Native matches | Task matches | Primary classification | Future action |
| --- | ---: | ---: | ---: | --- | --- |
| `NV-MON7CNYB` | 1 | 0 | 0 | `checkout_chain_exact_preview_incomplete_rate_limited` | manual review / retry after cooldown |

The run stopped immediately after this result.

The following candidates were not run and remain held for a later cooldown window:

- `NV-MON367R7`
- `NV-MOILVI17`
- `NV-MOILSACV`
- `NV-MOF1S04J`
- `NV-MODIHVQQ`

## 7. Chain-origin classifications

| Order | Chain origin |
| --- | --- |
| `NV-MP5SOQLJ` | `historical_late_mirror` |
| `NV-MOPV2CIK` | `unknown_chain_origin` |
| `NV-MOOV82PT` | `unknown_chain_origin` |
| `NV-MOOPFCUS` | `unknown_chain_origin` |
| `NV-MON7CNYB` | `unknown_chain_origin` |
| unrun held candidates | `unknown_chain_origin` pending exact follow-up |

FOLLOWUP1 found no new `native_born_checkout_chain` evidence.

## 8. Remediation map

| Candidate group | Orders | Future action |
| --- | --- | --- |
| Historical/payment/subscription holds | `NV-MP5SOQLJ`, `SUB-SK-4X-20260425` | retain current behavior |
| Repair/replay/manual review | `NV-MOPV2CIK`, `NV-MOOV82PT`, `NV-MOOPFCUS` | manual review; no automated mutation |
| Rate-limited incomplete | `NV-MON7CNYB` | retry exact preview after cooldown only |
| Not run after rate limit | `NV-MON367R7`, `NV-MOILVI17`, `NV-MOILSACV`, `NV-MOF1S04J`, `NV-MODIHVQQ` | preserve for later exact follow-up |

No clean packet candidates were found in the completed authoritative subset.

## 9. Hub necessity finding

Hub writes remain operationally required.

Reasons:

- G47B found only two complete native chains out of 13 paid/captured orders;
- G47C/FOLLOWUP1 found repair/replay holds on the first three exact missing-native-order anomalies;
- FOLLOWUP1 stopped on rate-limit/source-incomplete evidence before the remaining candidates could be classified;
- no new native-born checkout chain was proven;
- no clean native ShopifyOrder packet candidate was proven;
- no clean FulfillmentTask packet candidate was proven.

G47C-FOLLOWUP1 does not approve Hub retry, repair, replay, write suppression, or shadow suppression.

## 10. Hard stops preserved

FOLLOWUP1 did not and must not:

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
- create logs or queues;
- mutate loyalty or credits;
- change customer confirmation, order history, tracker, or Apple Pay behavior.

## 11. No-write verification

A low-rate request-id verification pass checked the executed request ids across:

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

The deployed preview responses also reported:

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

## 12. Final classification

```text
checkout_native_chain_anomalies_followup_incomplete_rate_limited
```

Completed authoritative previews found only manual-review/repair-replay holds. The follow-up remains incomplete because the run stopped on a rate-limit/source-incomplete exact preview.

## 13. Recommendation

Do not proceed to native-order materialization, FulfillmentTask materialization, or Hub write shadow/suppression from FOLLOWUP1.

Recommended next step:

```text
G47C-FOLLOWUP2 — cooldown exact anomaly continuation
```

Run only the unrun/held candidates after a cooldown window:

- `NV-MON7CNYB`
- `NV-MON367R7`
- `NV-MOILVI17`
- `NV-MOILSACV`
- `NV-MOF1S04J`
- `NV-MODIHVQQ`

Use the same exact preview mode, one candidate at a time, stop on first rate-limit/source-incomplete result, and do not run a broad scan.

Proceed to a native ShopifyOrder packet preview only if at least one candidate returns:

```text
checkout_chain_native_order_missing_clean_packet_candidate
```

Proceed to a FulfillmentTask packet preview only if at least one candidate returns:

```text
checkout_chain_task_missing_clean_packet_candidate
```

Proceed to G47D shadow planning only after multiple natural `native_born_checkout_chain` examples are proven complete and customer/admin reads remain safe during exact Hub failures.

Apple Pay remains separate G47F work.
