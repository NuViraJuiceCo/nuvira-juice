# G33B: Next natural paid one-time order monitoring

## Scope

G33B is a read-only current-state scan and operator runbook for identifying the next natural paid one-time order after the proven `NV-MPZNKGNT` native lifecycle. This phase does not add runtime code, does not publish Builder UI, does not open gates, does not run live commands, and does not mutate any Customer App, native, Hub, production, inventory, PurchaseOrder, notification, provider, Stripe, Shopify, sync, repair, or replay records.

G33A PR `#404` was confirmed docs-only, marked ready for review, and merged before this G33B branch was created.

## Scan timestamp

- UTC: `2026-06-09T18:54:02Z`
- Local: `2026-06-09 13:54:02 CDT`
- Scan method: authenticated admin UI read-only inspection of `/admin/orders` plus local source/schema review.
- Direct Base44 CLI SDK entity reads were attempted as a validation path, but the CLI token was management-scoped rather than app-admin-scoped for entity data. Those reads returned empty user-scoped entity lists and were not used as the source of truth.
- No cookies, local/session storage, tokens, auth headers, raw payloads, provider payloads, payment IDs, addresses, or secrets were inspected or printed.

## Current scan result

No fully qualified eligible next natural paid one-time order was confirmed during G33B.

The admin UI did surface recent operational context and active order rows, but the scan did not expose the exact Customer App Order ids, native ShopifyOrder ids, native FulfillmentTask ids, or complete sync/review log counts needed to safely select a second native pilot candidate. Because G33B is docs-only and read-only, no new helper function was added and no write command was run.

### Admin order source diagnostics observed

Two read-only admin UI passes were observed after asynchronous loading. The difference appears consistent with Hub fallback aggregation timing/budget or a view refresh state, so this report treats the more restrictive conclusion as authoritative: no exact candidate is approved from G33B alone.

| Observation pass | Total orders | Local Customer App orders | Hub bridge expanded rows | Native ShopifyOrder rows | Delivery fallback rows | Notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Pass A, fully loaded before reload | 27 | 17 | 15 | 9 | 14 | Surfaced three live-context order cards and active/completed/pending tabs. |
| Pass B, reload after wait | 24 | 17 | 0 | 9 | 14 | Surfaced local/native rows but no Hub bridge expanded rows. |

The UI itself states this admin page is read-only and does not call repair, retry, provider, payment, notification, inventory, or fulfillment write paths.

## Candidate table

Customer names/emails were visible in the admin UI but are intentionally redacted from this docs report. The table uses order numbers and safe operational context only.

| Order | Customer App Order id | Created / date shown | Status / badges shown | Fulfillment | Line items shown | Native ShopifyOrder present | Native FulfillmentTask present | Hub context | Classification | Next safe action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `NV-MON367R7` | Not exposed by read-only UI card | Not exposed by summary card | Online; amount shown; payment/native/task status not exposed in card | Delivery | `1x The NuVira Trio` | Not confirmed | Not confirmed | Not confirmed | `insufficient_data` | Do not run gates. Re-check with exact admin detail/read helper or G33C preview bundle. |
| `NV-MODIHVQQ` | Not exposed by read-only UI card | Not exposed by summary card | Online; amount shown; payment/native/task status not exposed in card | Delivery | `1x The NuVira Trio` | Not confirmed | Not confirmed | Not confirmed | `insufficient_data` | Do not run gates. Re-check with exact admin detail/read helper or G33C preview bundle. |
| `NV-MP5SOQLJ` | Not exposed by read-only UI row | `2026-05-16` shown | Customer App Order; Paid; Delivery; Bottled & Packed | Delivery | 3 line items shown | Not confirmed in stable pass | Not confirmed in stable pass | Hub synced appeared in one pass | `no_action_needed_or_existing_pre_g33_order` | Do not use as next pilot without exact ids and fresh previews; likely older/in-progress historical context. |
| `NV-MPZNKGNT` | Known from prior pilot, not reselected | `2026-06-06` shown in UI row | Delivered app status; native mirror/task; production bottled; fulfillment fulfilled | Delivery | 4 line items shown | Present from prior controlled pilot | Present from prior controlled pilot | Hub synced/fallback context | `duplicate_or_deduped` | Already proven lifecycle; not a new pilot candidate. |
| `NV-TEST-G22I-PAYMENT-20260604044012` | Not needed | `2026-06-06` shown | Native Ops Mirror; Needs Review; Paid; Production New | Delivery | Test item shown | Present | Not confirmed | Test/sync context | `needs_review` | Exclude from natural pilot. Synthetic/test order. |
| `NV-TEST-G22I-LOCK-20260604044012` | Not needed | `2026-06-06` shown | Native Ops Mirror; Needs Review; Paid; Awaiting Production; production lock | Delivery | Test item shown | Present | Not confirmed | Test/sync context | `needs_review` | Exclude from natural pilot. Synthetic/test order. |
| `NV-TEST-G22I-UPDATE-20260604044012` | Not needed | `2026-06-06` shown | Native Ops Mirror; Needs Review; Paid; Production New | Delivery | Test item shown | Present | Not confirmed | Test/sync context | `needs_review` | Exclude from natural pilot. Synthetic/test order. |
| `NV-G22WTEST-20260604004452` | Not needed | `2026-06-05` shown | Native Ops Mirror; Paid; Review Test Only | Delivery | Test item shown | Present | Not confirmed | Test-only context | `needs_review` | Exclude from natural pilot. Test-only native safeSync row. |
| `1009` | Not needed | `2026-05-28` shown | Native Ops Mirror; Paid; owner test pilot | Delivery | 3 line items shown | Present | Not confirmed | Owner test context | `no_action_needed` | Older owner/test pilot context, not next natural order. |
| `1033`, `1021`, `1024` | Not needed | `2026-06-01` shown | Hub Synced; POS/Event | Pickup / POS | POS items shown | Not relevant | Not relevant | Hub synced | `unsupported_subscription_or_multi_delivery` equivalent for this phase: unsupported POS/pickup event path | Exclude from one-time delivery native pilot. |

## Eligibility conclusion

G33B did not confirm an `eligible_next_one_time_order_candidate` because no surfaced order met all of these conditions with exact ids and clean evidence:

- one-time order,
- paid/captured,
- not cancelled/refunded,
- not subscription/multi-delivery,
- line items present,
- delivery/pickup classification clear,
- Customer App Order id known,
- native ShopifyOrder presence known or previewable,
- native FulfillmentTask presence known or previewable,
- no OrderReviewQueue blocker,
- no duplicate/conflict,
- safe Hub fallback context,
- read-only preview stack can be run for the exact order.

The two most plausible natural-looking summary cards, `NV-MON367R7` and `NV-MODIHVQQ`, are not approved as candidates from G33B because the summary cards did not expose exact ids, payment/capture confirmation, native mirror/task state, review queue state, or production readiness context.

## Read-only preview results

No native readiness preview stack was run for a new candidate because no candidate was fully qualified with exact ids. This avoids accidental overreach and preserves the G33A boundary: exact-order gates remain required and no broad writer or broad read helper is introduced in G33B.

If `NV-MON367R7` or `NV-MODIHVQQ` is intended to become the next pilot candidate, the next safe step is to obtain exact order/native/task ids through an admin-safe read helper or a G33C preview bundle, then run read-only previews only.

## Comparison against `NV-MPZNKGNT`

| Area | `NV-MPZNKGNT` proven path | Current surfaced candidates | Risk / difference |
| --- | --- | --- | --- |
| Exact Customer App Order id | Known and used throughout controlled pilot | Not available from summary cards for `NV-MON367R7` / `NV-MODIHVQQ` | Cannot safely approve exact gates. |
| Native ShopifyOrder id | Known and live-proven | Not confirmed for new natural-looking cards | Need mirror parity/presence preview. |
| Native FulfillmentTask id | Known and live-proven | Not confirmed for new natural-looking cards | Need task materialization/presence preview. |
| Payment/capture | Known paid/captured | Amount shown, but capture status not confirmed from summary card | Needs app/order read preview. |
| Review queue | Known clean before live steps | Not confirmed for summary cards; synthetic rows show Needs Review | Must block if review queue is open. |
| Master data / production demand | Proven for exact product mix | `The NuVira Trio` appears in both natural-looking cards | Could be good second sample, but only after exact read previews. |
| Hub fallback | Known/deduped and later reconciled | UI aggregation varied between passes | Need deterministic Hub/native context in G33C. |
| Candidate quality | Fully qualified, exact controlled pilot | Not fully qualified | G33B should wait or add read-only candidate bundle. |

## Operator checklist for the next paid one-time order

When a new paid one-time order arrives, Amar/admin should use this checklist before requesting any live gates:

1. Confirm payment is paid and captured.
2. Confirm the Customer App Order exists and record its exact id.
3. Confirm the order is one-time, not subscription, not multi-delivery, not POS/event unless that path is explicitly in scope.
4. Confirm the order is not cancelled, refunded, partially refunded, disputed, deleted, or marked do-not-recover.
5. Confirm line items are present and the delivery/pickup classification is clear.
6. Confirm native ShopifyOrder mirror exists, or run only the native mirror/parity preview to determine whether it can be created.
7. Confirm native FulfillmentTask exists, or run only the task materialization preview to determine whether it can be created.
8. Confirm Hub bridge fallback is present/deduped or explicitly not blocking.
9. Confirm no OrderReviewQueue issue is open.
10. Confirm no SafeSyncParityLog blocker or duplicate/conflict exists.
11. Run the native readiness preview stack: safeSync/mirror parity, task presence/materialization, master-data parity, inventory readiness, demand materialization, production lifecycle readiness as applicable, post-verify cascade preview as applicable, delivery readiness as applicable, and customer status/notification impact only when downstream state supports it.
12. Do not open gates, broaden allowlists, run live commands, send notifications, call providers, call Stripe, call Shopify, run sync/repair/replay, deduct inventory, or create PurchaseOrders until explicit approval is given for exact order/task/batch ids.

## Recommended next phase

Recommended next phase: **G33C eligible one-time order preview bundle**.

G33C should add or use an admin-safe read-only candidate bundle that returns exact ids and blockers for a single proposed order number. That bundle should be read-only and should not create mirrors/tasks, open gates, run commands, send notifications, call providers, run sync/repair/replay, deduct inventory, create PurchaseOrders, or mutate Hub.

If the business wants to proceed faster and can provide exact ids for `NV-MON367R7` or `NV-MODIHVQQ`, G33C can target that order number directly. Otherwise wait for the next natural paid one-time order and run G33C once exact candidate identity is available.

## No-write verification

G33B performed only documentation, local source/schema review, authenticated admin UI reads, and failed/empty app-user-scoped entity reads that were not used as source of truth. No live records were mutated. No gates were opened. No commands were run. No notifications, provider calls, Stripe calls, Shopify calls, sync/repair/replay, inventory deduction, PurchaseOrder creation, Hub mutation, production mutation, delivery mutation, proof/drop/route write, Customer App Order update, native ShopifyOrder update, native FulfillmentTask update, ProductionBatch update, or BatchComplianceLog update occurred.
