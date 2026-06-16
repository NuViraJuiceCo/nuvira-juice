# G39G — Admin calendar events native-first patch plan

## 1. Executive summary

G39G selects `getAdminCalendarEventsSummary` as the next low-risk admin read surface for a future native-first runtime patch. This document is a docs-only implementation plan. It does not change runtime behavior, admin UI behavior, customer-facing behavior, Hub fallback, schemas, gates, or live data.

G39B live parity evidence made calendar events a good follow-up after the successful G39D and G39F native-first admin read patches:

- admin-only surface
- read-only calendar aggregation function
- G39B classified `calendar_events` as `ready_for_native_first_patch`
- G39B risk level was low
- sampled live parity found 1 native aggregate row and no mismatches
- strategically lower risk than `admin_orders`, `operations_dashboard`, `ops_alerts`, and `resources`
- Hub fallback can remain active and explicitly reported

The future G39H patch should make native calendar event aggregates primary while retaining Hub fallback for missing or incomplete native calendar context, subscription and multi-delivery contexts, historical Hub-only rows, and any date semantics that are not yet safely represented natively.

## 2. G39B evidence

G39B live preview:

- request id: `g39b_live_admin_native_hub_parity_20260616T051416Z`
- preview mode: `ADMIN_NATIVE_FIRST_HUB_READ_PARITY`
- `success:true`
- `dry_run:true`
- `writes_performed:false`
- `pii_returned:false`
- `provider_call_impact:false`
- `notifications_sent:false`
- `hub_mutation_performed:false`
- blockers: `[]`

G39B calendar events surface result:

| Field | Value |
| --- | --- |
| Surface | `calendar_events` |
| Readiness | `ready_for_native_first_patch` |
| Risk | low |
| Native row count | 1 aggregate row |
| Mismatch count | 0 |
| Recommended order | after `delivery_route_summary` and `production_planning` |

G39B does not prove that Hub can be removed. It proves that a native-first admin calendar read patch is reasonable if Hub fallback remains available and reported.

## 3. Why `getAdminCalendarEventsSummary` is selected

`getAdminCalendarEventsSummary` is the next appropriate native-first admin read candidate because it is:

1. Admin-only.
2. Read-only.
3. Already native-aware through the native calendar fallback helper.
4. Lower risk than customer-facing or order-list surfaces.
5. Focused on aggregate schedule visibility rather than mutation workflows.
6. Already sanitizes returned event, production, delivery, and compliance fields.
7. Already has admin UI language that describes the calendar as read-only schedule visibility.
8. A natural follow-up after `getAdminDeliveryRouteSummary` and `getAdminProductionPlanningSummary` were made native-first.

Do not target these first:

- `getAdminOrdersWithHub`: broader row shape and medium-risk customer/order list parity.
- `getAdminOperationsDashboardSummary`: aggregate parity still needs more fields.
- `getAdminOpsAlertsSummary`: alert semantics need more native parity.
- `getAdminResourcesSummary`: resource/team/equipment parity is incomplete.

## 4. Current behavior audit

### Function audited

- `base44/functions/getAdminCalendarEventsSummary/entry.ts`

### Admin UI consumer audited

- `src/pages/admin/Calendar.jsx`

### Current auth and request behavior

The function:

- uses `createClientFromRequest(req)`
- requires authenticated admin access through `base44.auth.me()`
- returns `401` for unauthenticated requests
- returns `403` for non-admin users
- accepts JSON body input
- supports presets `current_month`, `next_30_days`, and `today`
- supports custom `date_from` / `date_to` ranges
- limits custom ranges to 31 days
- supports `type`, `status`, `search`, and `limit` filters
- caps returned rows through `MAX_LIMIT`
- performs no record writes
- creates no logs or queues
- does not call Stripe, Shopify, delivery providers, or notification services
- calls the Hub calendar summary endpoint when Hub config exists

### Current Hub reads

If `HUB_API_URL` and `CUSTOMER_APP_SYNC_SECRET` are configured, the function calls:

- Hub function: `getCalendarEventsSummaryForCustomerApp`
- Method: GET
- Parameters: `preset` or `date_from` / `date_to`, plus optional `type`, `status`, `search`, and `limit`
- Auth: bearer secret from environment

When Hub returns a valid response, the current function returns sanitized Hub summary and dates directly. Native data is not primary in the successful Hub path today.

### Current native reads

The current native calendar fallback is built by `loadNativeCalendarSummary`. It reads these native/customer-app backend entities through service-role list reads:

- `Event`
- `ProductionBatch`
- `FulfillmentTask`
- `SanitationLog`
- `TemperatureLog`
- `DailyChecklist`
- `CorrectiveActionLog`
- `BatchComplianceLog`
- `CCPLog`
- `pHLog`

The current function does not directly read:

- Customer App `Order`
- native `ShopifyOrder`
- subscription occurrence records
- route proof/drop payloads
- provider/payment payloads

Future G39H should keep the first runtime patch narrow. It should not add direct Customer App `Order` or native `ShopifyOrder` reads unless implementation audit shows they are necessary for backward-compatible calendar semantics and fixture coverage is added.

### Current native selection logic

The native fallback groups schedule items by date:

- `Event` rows use `start_datetime`, `date`, `event_date`, or `created_date`.
- `ProductionBatch` rows use `production_date` or `created_date`.
- `FulfillmentTask` rows use `delivery_date`, `scheduled_date`, or `assigned_delivery_date`.
- Compliance rows use compliance/check/log/production/date/created date fields.

The native fallback excludes POS/event POS fulfillment tasks from delivery summary counts. It aggregates by day and returns only sanitized summary counts and aggregate items.

### Current merge order

The current runtime behavior is Hub-primary, not native-first:

1. Resolve calendar range and filters.
2. If Hub config is missing, load native calendar summary and return `source: customer_app_native_calendar_fallback`.
3. If Hub fetch fails, is non-OK, or returns malformed data, load native calendar summary and return fallback warnings.
4. If Hub succeeds, return sanitized Hub `summary` and `dates` directly.

There is no current successful-path native/Hub merge. This keeps Hub as the visible source of truth whenever Hub is available.

### Current response shape

Current top-level response fields in the successful Hub path:

- `success`
- `date_from`
- `date_to`
- `generated_at`
- `summary`
- `dates`
- `truncated`

Current top-level response fields in the native fallback path also include:

- `source`
- `warnings`
- `data_sources`

Current `summary` fields:

- `total_items`
- `events`
- `production_days`
- `delivery_days`
- `compliance_items`

Current date group fields:

- `date`
- `counts.events`
- `counts.production`
- `counts.delivery`
- `counts.compliance`
- `items`

Current item types and fields:

| Type | Current fields |
| --- | --- |
| `event` | `id`, `type`, `title`, `event_type`, `status`, `start_datetime`, `end_datetime`, `location`, `summary` |
| `production` | `type`, `production_date`, `batch_count`, `product_count`, `planned_units`, `status_counts` |
| `delivery` | `type`, `delivery_date`, `stop_count`, `completed_count`, `pending_count`, `source_type_counts` |
| `compliance` | `type`, `compliance_date`, `log_count`, `open_corrective_action_count`, `status_counts` |

### Current admin UI assumptions

`Calendar.jsx` invokes `getAdminCalendarEventsSummary` and currently uses:

- `data.summary`
- `data.dates`
- `data.warnings`
- `data.source`
- `data.data_sources`
- `data.truncated`
- `data.date_from`
- `data.date_to`
- `data.generated_at`

The page renders:

- range controls and generated timestamp
- total item count
- event count
- production day count
- delivery day count
- compliance item count
- calendar month grid
- agenda/date groups
- event cards
- production summary cards
- delivery summary cards
- compliance summary cards
- warnings when Hub calendar aggregation is unavailable and native fallback is shown

The UI already labels this surface as read-only schedule visibility and states that event, production, delivery, compliance, and order actions are not available from the page.

### Current privacy behavior

The function sanitizes text fields and redacts email, phone, address-like text, bearer/auth/token/secret patterns, and long strings. The current admin calendar page displays aggregate schedule fields, event titles/summaries, production counts, delivery counts, and compliance counts. It does not need customer email, phone, full address, raw Hub payloads, raw provider/payment payloads, route proof/drop payloads, or secrets.

## 5. Proposed native-first read order

Future G39H should use this read order:

1. Build native calendar context first from existing native sources:
   - `Event`
   - `ProductionBatch`
   - `FulfillmentTask`
   - compliance log entities currently used by the native fallback helper
2. Preserve existing Hub calendar/event reads as fallback/context.
3. Prefer native rows and aggregates where native data is complete enough for the current admin calendar response contract.
4. Use Hub fallback when:
   - native calendar event/aggregate is missing
   - native calendar event/aggregate is incomplete for the current UI contract
   - subscription or multi-delivery context remains Hub source-of-truth
   - historical rows are Hub-only
   - Hub has safe calendar context that native entities do not yet model
5. Deduplicate native/Hub events by safe operational keys where comparable.
6. Suppress stale Hub events when a corrected native date exists.
7. Add explicit fallback reporting.
8. Never write records.
9. Never call providers.
10. Never send notifications.

Safe matching keys:

- `order_number` when present
- `customer_app_order_id` when present and safe
- `native_shopify_order_id` when present and safe
- `native_fulfillment_task_id` when present and safe
- `calendar_date`
- `production_date`
- `delivery_date`
- `scheduled_date`
- `assigned_delivery_date`
- `event_type`
- subscription/occurrence id only when exact and safe

Do not use:

- customer email
- customer phone
- fuzzy customer name matching
- raw Hub payloads
- route proof/drop payloads
- provider/payment payloads

## 6. Calendar event row/summary contract

Future G39H must preserve the current response shape consumed by `Calendar.jsx`.

### Top-level fields to preserve

- `success`
- `date_from`
- `date_to`
- `generated_at`
- `summary`
- `dates`
- `truncated`
- `warnings` where applicable
- `source` where applicable
- `data_sources` where applicable

### Summary fields to preserve

- `total_items`
- `events`
- `production_days`
- `delivery_days`
- `compliance_items`

### Date group fields to preserve

- `date`
- `counts.events`
- `counts.production`
- `counts.delivery`
- `counts.compliance`
- `items`

### Item fields to preserve

Future G39H must not remove or rename the current item fields for `event`, `production`, `delivery`, or `compliance` items listed in the current behavior audit.

### Safe additive metadata plan

Future G39H should add only safe additive top-level metadata:

- `native_first_enabled:true`
- `native_event_count`
- `hub_fallback_event_count`
- `suppressed_hub_event_count`
- `fallback_required`
- `fallback_reasons`
- `hub_fallback_used`
- `native_missing_count`
- `hub_only_count`
- `native_only_count`
- `mismatch_count` if comparable
- `calendar_events_source`
- `writes_performed:false`
- `provider_call_impact:false`
- `notifications_sent:false`
- `hub_mutation_performed:false`

Future G39H may add safe per-event metadata where rows exist and the UI can ignore it safely:

- `data_source`: `customer_app_native`, `hub_fallback`, or `native_with_hub_fallback_context`
- `fallback_source`
- `fallback_reason`
- `native_primary:true/false`
- `hub_fallback_used:true/false`
- `stale_hub_event_suppressed:true/false`
- `warnings`

Do not add:

- customer email
- customer phone
- full address
- raw Hub payload
- raw provider payload
- raw payment payload
- route proof/drop payload
- secrets/auth values

If native data lacks a field needed by the current admin calendar UI, retain Hub fallback context, mark `fallback_reason:native_data_incomplete_for_calendar_event`, and do not drop the event.

## 7. Fallback behavior

Fallback behavior must be explicit and reported.

| Case | Admin-visible behavior | Metadata / warning | G39H patchability |
| --- | --- | --- | --- |
| `native_calendar_event_present_no_hub_needed` | Return native event/aggregate as primary. | `native_primary:true`, `hub_fallback_used:false`. | Safe. |
| `native_calendar_event_missing_hub_fallback_used` | Return safe Hub fallback event. | `fallback_reason:native_calendar_event_missing`. | Safe if shape remains compatible. |
| `native_calendar_event_incomplete_hub_fallback_used` | Return native event with Hub context only for missing UI-safe fields. | `fallback_reason:native_data_incomplete_for_calendar_event`. | Safe with fixture coverage. |
| `subscription_calendar_event_hub_source_of_truth` | Retain Hub row; do not claim native authority. | warning `subscription_calendar_event_hub_source_of_truth`. | Safe as hold/fallback. |
| `historical_hub_event_retained` | Retain Hub-only historical context if still admin-visible today. | `fallback_reason:historical_hub_only_event`. | Safe if not used as command readiness. |
| `stale_hub_event_suppressed` | Suppress stale Hub duplicate when corrected native date exists. | `suppressed_hub_event_count`, `stale_hub_event_suppressed:true`. | Safe with date fixture coverage. |
| `duplicate_native_hub_event_deduped` | Return one event, prefer native. | `native_primary:true`, `fallback_source:hub_duplicate`. | Safe. |
| `hub_only_event_retained` | Keep active Hub-only event. | `fallback_reason:hub_only_event_no_native_counterpart`. | Safe; do not hide active Hub rows. |
| `no_calendar_events_found` | Return empty safe response. | counts zero; no warnings unless Hub unavailable. | Safe. |

Hard rule: do not remove Hub fallback. G39H should only make native first with Hub fallback still available and reported.

## 8. Calendar-specific safety rules

Future G39H must preserve these policies:

- Hub fallback remains active.
- Subscriptions and multi-delivery remain Hub source-of-truth unless exact native occurrence parity is proven.
- Late/historical mirror rows must not be treated as live production, delivery, or customer-status command candidates.
- Calendar event presence must not imply command readiness.
- Notifications remain held.
- Provider calls remain disabled.
- Inventory deduction remains held.
- PurchaseOrder automation remains held.
- Customer-facing calendar/status behavior must not change.
- No sync, repair, replay, or write path should be introduced.

## 9. Future G39H implementation scope

G39H should be a narrow runtime patch to:

- `base44/functions/getAdminCalendarEventsSummary/entry.ts` only
- optional helpers inside the same function file if needed
- no schema changes
- no customer-facing UI changes
- no admin UI changes unless additive fallback metadata display is required and proven backward-compatible
- no provider calls
- no Hub writes
- no record writes
- no notification changes
- no sync/repair/replay

Future G39H must:

- keep existing response shape backward-compatible
- add fallback metadata only in additive fields
- preserve current admin calendar behavior where native data is missing
- report Hub fallback usage
- retain Hub fallback
- include request id in diagnostics only if safe
- return `writes_performed:false`
- return `provider_call_impact:false`
- return `notifications_sent:false`
- return `hub_mutation_performed:false`

## 10. Future test plan

Future harness:

- `scripts/migration/run-g39h-admin-calendar-events-native-first-tests.mjs`

Planned test cases:

1. Native calendar event present -> native event is primary.
2. Hub event absent -> native event still returned.
3. Native event missing and Hub event present -> Hub fallback used.
4. Native event incomplete and Hub event present -> native event returned with Hub fallback context.
5. Duplicate native/Hub same order/date/event type -> deduped, native primary.
6. Subscription/multi-delivery event remains Hub source-of-truth.
7. Historical/late mirror event classified safely, not as command candidate.
8. Stale Hub event suppressed when corrected native date exists.
9. No events -> empty safe response.
10. Existing response shape remains backward-compatible.
11. No customer email/phone returned.
12. No full address returned unless already present in the existing admin-only contract.
13. No raw Hub/provider/payment/proof/drop payload returned.
14. `writes_performed:false`.
15. `provider_call_impact:false`.
16. `notifications_sent:false`.
17. `hub_mutation_performed:false`.
18. No logs/queues created.
19. G39B parity harness remains compatible.
20. G39D delivery route native-first harness remains compatible.
21. G39F production planning native-first harness remains compatible.

Regression harnesses to include:

- `scripts/migration/run-g39b-admin-native-hub-read-parity-tests.mjs`
- `scripts/migration/run-g39d-admin-delivery-route-native-first-tests.mjs`
- `scripts/migration/run-g39f-admin-production-planning-native-first-tests.mjs`
- relevant G33C mirror/task/master-data harnesses if calendar logic begins depending on order/task shape
- relevant G36 subscription harnesses if subscription calendar rows are touched
- `scripts/migration/run-g27-native-cutover-readiness-tests.mjs` if shared preview logic is touched
- scoped ESLint
- `npm run build`
- `git diff --check`
- changed-file scope check
- mutation/provider/action scan
- secret/privacy/raw-payload/provider-ID/PII scan

## 11. Risk assessment

### Low-risk factors

- Admin-only surface.
- Read-only function.
- G39B live parity showed no mismatch.
- Calendar surface is lower-risk than order/customer surfaces.
- Current UI already treats the calendar as read-only schedule visibility.
- Existing native fallback helper already models event, production, delivery, and compliance calendar aggregates.
- Hub fallback remains active.

### Medium-risk factors

- Calendar rows can combine production, delivery, compliance, event, subscription, and historical contexts.
- Subscription and multi-delivery semantics remain Hub-owned.
- Late/historical mirror rows can appear in native production or delivery data.
- Date semantics can differ across `production_date`, `delivery_date`, `scheduled_date`, `assigned_delivery_date`, `start_datetime`, and compliance dates.
- The successful Hub path currently does not merge native rows, so G39H must carefully preserve response shape while changing source priority.

### High-risk / hard stops

- Removing Hub fallback.
- Hiding active Hub-only subscription or calendar rows.
- Changing customer-facing status or notifications.
- Mutating route/proof/drop/delivery fields.
- Treating event rows as production, delivery, or customer-status command-ready.
- Exposing PII or raw payloads.
- Calling providers.
- Sending notifications.
- Running sync/repair/replay.
- Creating logs/queues.

## 12. Rollback plan

If G39H exposes a runtime issue, rollback should be code-only:

1. Revert the `getAdminCalendarEventsSummary` native-first patch.
2. Republish only `getAdminCalendarEventsSummary`.
3. Keep Hub fallback active throughout.
4. No data repair should be needed because G39H must be read-only.
5. Monitor `/admin/calendar` after deploy for page load, count rendering, warning rendering, and filter behavior.

## 13. Hard stops

Do not proceed from G39G to G39H if implementation audit finds that native-first calendar behavior requires any of the following:

- schema changes
- customer-facing behavior changes
- Hub fallback removal
- Hub write suppression
- provider calls
- notification sends
- record writes
- sync/repair/replay
- inventory deduction
- PurchaseOrder creation
- customer email/phone/full address exposure beyond the existing admin-only contract
- raw Hub/provider/payment/proof/drop payload exposure
- subscription recurrence cutover without exact occurrence parity
- use of historical/late mirror rows as command-readiness proof

## 14. Recommendation

Proceed to G39H only if the runtime audit confirms that `getAdminCalendarEventsSummary` can be made native-first by reordering existing read-only native calendar aggregation ahead of Hub fallback while preserving the current `Calendar.jsx` response contract.

Recommended G39H scope:

- patch `getAdminCalendarEventsSummary` only
- keep Hub fallback active
- prefer native calendar aggregates when complete enough for the current UI
- retain Hub-only rows where native calendar context is missing
- add fallback metadata additively
- preserve current calendar row/summary fields
- run fixture harness and regression harnesses before merge
- publish only `getAdminCalendarEventsSummary`
- boundary verify and live-smoke `/admin/calendar`

If G39H audit finds an event contract gap, hold and patch the missing native field or preview coverage first.

## No-write confirmation

G39G is docs-only. It does not change runtime code, schemas, admin UI behavior, customer-facing behavior, Hub fallback behavior, gates, or live data. It does not call Hub, Stripe, Shopify, delivery providers, or notification services. It does not create logs/queues, deduct inventory, create PurchaseOrders, or mutate Customer App, native, or Hub records.
