# G36C Subscription Occurrence Identity Discovery Packet

## 1. Executive summary

G36B proved that the Customer App can run a read-only subscription occurrence parity preview, but the live recent scan only found subscription parent candidates. It did not identify a specific delivery/fulfillment occurrence. That means no exact subscription occurrence pilot can be planned yet.

G36C defines the operator input packet Amar/admin must fill before the next exact read-only preview. The packet separates subscription parent identity from occurrence identity and blocks any migration step that cannot name one exact occurrence.

Current policy remains unchanged:

- Hub remains the operational source of truth for subscription / multi-delivery fulfillment.
- Customer App subscription records are parent/account-facing context, not operational occurrence ownership.
- Native subscription writes remain blocked.
- No provider calls, notifications, Hub mutations, sync/repair/replay, inventory, PurchaseOrder, or record mutations are approved.

## 2. G36B live scan recap

G36B live scan input:

```text
preview_mode=SUBSCRIPTION_OCCURRENCE_PARITY
mode=RECENT_SUBSCRIPTION_OCCURRENCE_SCAN
```

G36B live scan result:

```text
success:true
dry_run:true
writes_performed:false
hub_source_of_truth:true
candidate_count:5
```

All five candidates had the same operational shape:

| Field | G36B scan result | Interpretation |
| --- | --- | --- |
| Customer App subscription parent | present | Customer App has parent subscription/account context. |
| Subscription id | present | Parent identity exists, but parent id is not an occurrence id. |
| Stripe subscription id | present only as a boolean | Provider id presence was detected without exposing the raw provider id. |
| Order number | missing | No occurrence order was selected. |
| Delivery date | missing | No delivery occurrence date was selected. |
| Fulfillment number | missing | No occurrence sequence was selected. |
| Hub occurrence | unknown / not scanned | Recent scan intentionally avoids broad Hub reads. |
| Native ShopifyOrder | not present | No native occurrence mirror was selected. |
| Native FulfillmentTask | not present | No native task was selected. |
| Classification | `subscription_occurrence_identity_ambiguous` | Parent-only context is insufficient. |

The scan correctly returned `provide_exact_subscription_occurrence_ids` as the next action.

## 3. Why the five candidates are ambiguous

A subscription parent can produce multiple operational deliveries. Native migration risk comes from confusing these layers:

1. subscription parent
2. billing/renewal cycle
3. order occurrence
4. delivery occurrence
5. fulfillment task
6. production demand / batch impact

The five G36B candidates were ambiguous because they identified layer 1 only. They did not prove which occurrence is being evaluated.

Missing or unresolved fields:

| Needed field | Status from G36B scan | Why it matters |
| --- | --- | --- |
| `subscription_id` | present | Useful parent key, but not enough by itself. |
| `hub_subscription_id` | not confirmed | Needed when Hub uses a different canonical subscription id. |
| `customer_app_subscription_id` | present as parent id | Useful parent key, but not enough by itself. |
| `occurrence_id` | missing | Best direct occurrence key when available. |
| `order_number` | missing | Needed to link a specific occurrence order. |
| `hub_order_id` | missing | Needed when Hub order id is the occurrence anchor. |
| `hub_fulfillment_task_id` | missing | Needed when Hub task is the occurrence anchor. |
| `native_shopify_order_id` | not present | Optional; only required if a native mirror already exists. |
| `native_fulfillment_task_id` | not present | Optional; only required if a native task already exists. |
| `delivery_date` | missing | Required fallback when no occurrence id is available. |
| fulfillment occurrence date | missing | Needed to distinguish one delivery from another. |
| line item snapshot/count | missing | Needed to prevent production demand mismatch. |
| occurrence payment/charge status | missing | Needed to avoid failed-payment or refund ambiguity. |
| cancellation/refund state | missing | Needed to avoid cancellation/refund split-brain. |
| repair/replay state | missing | Needed to avoid evaluating records mid-repair. |

Do not fill these gaps with customer name, customer email, phone number, address, or fuzzy matching.

## 4. Exact occurrence target requirements for G36D

A clean G36D exact subscription occurrence preview target must include enough identifiers to select exactly one occurrence.

Minimum required fields:

```text
subscription_id or hub_subscription_id
occurrence_id OR exact delivery_date + occurrence order number
order_number or hub_order_id
delivery_date
fulfillment occurrence status
payment/charge status
line item count
```

Additional fields when available:

```text
customer_app_subscription_id
customer_app_order_id
native_shopify_order_id
native_fulfillment_task_id
hub_fulfillment_task_id
fulfillment_number
production_date
refund/cancellation state
repair/replay state
```

Optional context that can help but must not be used alone:

```text
subscription cadence
subscription bundle/plan label
fulfillment method
admin-safe line item summary
```

Forbidden matching keys:

```text
customer name
customer email
phone number
address
raw Stripe payload
raw Shopify payload
webhook signature
auth headers
payment method/card data
provider dashboard screenshots containing customer PII
```

## 5. Operator input packet template

Use this template when asking Amar/admin to identify a candidate occurrence. Leave unknown fields blank rather than guessing.

```text
G36C SUBSCRIPTION OCCURRENCE TARGET PACKET

operator_name=
request_date=
source_system_used=Customer App admin / Hub admin / other approved read-only source

subscription_parent:
  subscription_id=
  customer_app_subscription_id=
  hub_subscription_id=
  stripe_subscription_id_present=true/false/unknown
  subscription_status=
  cancel_at_period_end=true/false/unknown
  cancellation_state=none / pending / cancelled / unknown

occurrence_identity:
  occurrence_id=
  fulfillment_number=
  delivery_date=YYYY-MM-DD
  fulfillment_occurrence_date=YYYY-MM-DD
  production_date=YYYY-MM-DD / unknown
  order_number=
  hub_order_id=
  hub_fulfillment_task_id=
  fulfillment_occurrence_status=pending / scheduled / packed / delivered / cancelled / unknown

customer_app_context:
  customer_app_order_id=
  customer_app_order_status=
  customer_app_payment_status=

native_context_if_present:
  native_shopify_order_id=
  native_shopify_order_number=
  native_shopify_order_payment_status=
  native_shopify_order_fulfillment_status=
  native_fulfillment_task_id=
  native_fulfillment_task_status=
  native_fulfillment_task_delivery_status=

occurrence_contents:
  line_item_count=
  item_summary_safe=product names + quantities only, no customer PII
  total_bottle_count=

payment_and_exception_state:
  occurrence_payment_status=paid / unpaid / failed / refunded / partially_refunded / unknown
  charge_or_invoice_state=paid / open / failed / void / unknown
  refund_state=none / partial / full / unknown
  cancellation_state=none / pending / cancelled / unknown
  active_repair_or_replay=true/false/unknown
  notes_safe=

operator_assertions:
  one_exact_occurrence_selected=true/false
  no_duplicate_task_known=true/false/unknown
  no_refund_or_cancellation_ambiguity=true/false/unknown
  no_active_repair_or_replay=true/false/unknown
  no_notification_expected=true
  provider_calls_expected=false
  hub_source_of_truth=true
```

Do not paste raw provider payloads, raw webhook payloads, signatures, auth headers, customer addresses, phone numbers, payment method details, or screenshots containing customer PII into this packet.

## 6. Required evidence quality

A packet is G36D-ready only when the operator can assert all of the following:

| Requirement | Required answer |
| --- | --- |
| Exactly one subscription parent identified | yes |
| Exactly one delivery/fulfillment occurrence identified | yes |
| Occurrence has either `occurrence_id` or `delivery_date + order_number` | yes |
| Hub occurrence/task identity available or explicitly absent | yes |
| Customer App parent context understood | yes |
| Native order/task context available or explicitly absent | yes |
| Line item count known | yes |
| Payment/charge state known | yes |
| Refund/cancellation state known | yes |
| Repair/replay state known | yes |
| No customer PII used as matching key | yes |
| No provider call needed to interpret packet | yes |

If any answer is unknown, the next action remains `provide_exact_subscription_occurrence_ids` or `hold_hub_source_of_truth`.

## 7. G36D exact preview request shape

When a clean packet exists, Codex should run only a read-only exact preview using the fields provided.

Suggested request:

```json
{
  "preview_mode": "SUBSCRIPTION_OCCURRENCE_PARITY",
  "mode": "EXACT_OCCURRENCE_PREVIEW",
  "subscription_id": "<customer_app_subscription_id_or_parent_id>",
  "hub_subscription_id": "<hub_subscription_id_if_available>",
  "occurrence_id": "<occurrence_id_if_available>",
  "fulfillment_number": "<fulfillment_number_if_available>",
  "delivery_date": "YYYY-MM-DD",
  "order_number": "<occurrence_order_number>",
  "hub_order_id": "<hub_order_id_if_available>",
  "fulfillment_task_id": "<hub_or_native_fulfillment_task_id_if_unambiguous>",
  "customer_app_order_id": "<customer_app_order_id_if_available>",
  "native_shopify_order_id": "<native_shopify_order_id_if_available>",
  "request_id": "g36d_exact_subscription_occurrence_preview_<timestamp>"
}
```

Expected G36D output before any pilot planning:

```text
success:true
dry_run:true
writes_performed:false
hub_source_of_truth:true
occurrence_identity_status:exact or equivalent
parity_classification returned
provider_call_impact:false
notification_impact.notification_held:true
blockers empty or clearly understood
warnings include Hub source-of-truth / writes held
```

Any blocker means no native subscription pilot planning.

## 8. Blockers that keep subscription migration held

Do not proceed to a native subscription occurrence pilot if any of these are present:

- no exact subscription/occurrence identity
- parent-only subscription context
- missing delivery date
- missing order number or Hub order id
- missing line item count
- unknown payment/charge state
- refund or cancellation ambiguity
- active repair/replay/sync retry context
- duplicate Hub task or native task risk
- production demand duplication risk
- notification side effect required
- provider call required
- Hub mutation required
- customer PII is needed as a matching key
- operator cannot assert that one exact occurrence was selected

## 9. Safe discovery workflow for operators

Recommended manual discovery sequence:

1. Start from a Customer App subscription parent id from G36B scan or admin subscription view.
2. Open the corresponding Hub subscription/fulfillment context in an approved read-only admin surface.
3. Select one future or current occurrence, not the whole parent subscription.
4. Record the occurrence id if Hub exposes one.
5. If no occurrence id exists, record exact delivery date plus occurrence order number or Hub order id.
6. Record Hub fulfillment task id if one exists.
7. Record Customer App/native order/task ids only if already present.
8. Record line item count and safe product/quantity summary.
9. Confirm payment, refund/cancellation, and repair/replay states.
10. Fill the G36C packet and provide it for G36D exact read-only preview.

This workflow must not call Stripe, Shopify, or providers. If the only way to determine payment state is a provider lookup, hold and do not proceed.

## 10. No-write and no-provider policy

G36C is documentation only. It does not:

- create or update subscriptions
- create or update Customer App Orders
- create or update native ShopifyOrder records
- create or update FulfillmentTask records
- create or update ProductionBatch or BatchComplianceLog records
- create OrderReviewQueue, OrderSyncLog, CommandLog, notification, or message rows
- call Stripe, Shopify, or providers
- send notifications
- run sync/retry/repair/replay
- mutate Hub records
- open gates
- disable Hub fallback
- publish Base44

## 11. Recommended next phase

Recommended next phase depends on operator input quality:

1. **G36D exact subscription occurrence preview** — proceed only if Amar/admin provides a complete G36C packet with exact occurrence identity.
2. **Hold subscription migration** — if only parent subscriptions are available or occurrence identity remains ambiguous.
3. **Continue one-time order generalization** — if no clean subscription occurrence target is available.

Do not design or approve native subscription occurrence write commands until an exact read-only preview proves one clean occurrence with no duplicate task, production demand, refund/cancellation, notification, provider, Hub mutation, or repair/replay risk.
