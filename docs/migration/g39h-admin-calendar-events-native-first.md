# G39H — Admin calendar events native-first runtime patch

## Purpose

G39H makes `getAdminCalendarEventsSummary` native-first for the admin-only calendar read surface. Hub fallback remains active and reported. The patch is read-only: it does not mutate Customer App records, native records, Event records, Hub records, logs, queues, notifications, inventory, or PurchaseOrders.

## G39B / G39G evidence

G39B classified `calendar_events` as:

- readiness: `ready_for_native_first_patch`
- risk: low
- live parity: 1 native aggregate row and no mismatches
- safer than `admin_orders`, `operations_dashboard`, `ops_alerts`, and `resources`

G39G audited the current surface and confirmed:

- `getAdminCalendarEventsSummary` is admin-only and read-only.
- Current successful behavior is Hub-primary.
- Native fallback already reads `Event`, `ProductionBatch`, `FulfillmentTask`, and compliance log entities.
- `/admin/calendar` consumes `summary`, `dates`, `warnings`, `source`, `data_sources`, `truncated`, date range fields, and `generated_at`.
- No writes, provider calls, notifications, logs/queues, inventory deduction, or PO automation were found.

## Current behavior before G39H

Before this patch, the function:

1. Resolved a date range and filters.
2. Returned native fallback only when Hub config was missing, Hub fetch failed, Hub returned non-OK, or Hub returned malformed data.
3. Returned sanitized Hub `summary` and `dates` directly when Hub succeeded.

That kept Hub visibly primary whenever Hub was available.

## Native-first algorithm

G39H changes the read order:

1. Build native calendar context first from the existing native fallback sources:
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
2. Fetch Hub calendar data as fallback/context when Hub config exists.
3. Prefer native calendar rows/aggregates when present.
4. Use Hub fallback rows when native calendar context is missing.
5. Mark native rows with Hub fallback context when native data is incomplete but a matching Hub row exists.
6. Deduplicate duplicate native/Hub rows and prefer native.
7. Suppress stale Hub rows when a corrected native row with the same stable id exists on another date.
8. Return explicit fallback and safety metadata.

No direct `Order` or `ShopifyOrder` reads were added. The patch stays inside the existing calendar summary contract.

## Fallback metadata

G39H adds safe additive top-level metadata:

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
- `mismatch_count`
- `calendar_events_source`
- `writes_performed:false`
- `provider_call_impact:false`
- `notifications_sent:false`
- `hub_mutation_performed:false`
- `live_command_candidate:false`

Safe per-item metadata is additive where applicable:

- `data_source`
- `fallback_source`
- `fallback_reason`
- `native_primary`
- `hub_fallback_used`
- `stale_hub_event_suppressed`
- `warnings`

## Fallback classifications

Implemented classifications include:

- `native_calendar_event_present_no_hub_needed` via native primary rows
- `native_calendar_event_missing_hub_fallback_used`
- `native_calendar_event_incomplete_hub_fallback_used`
- `subscription_calendar_event_hub_source_of_truth`
- `historical_hub_event_retained`
- `stale_hub_event_suppressed`
- `duplicate_native_hub_event_deduped`
- `hub_only_event_retained`
- `no_calendar_events_found`

Hub fallback remains active. Active Hub-only rows are retained.

## Response compatibility

The patch preserves the fields currently consumed by `Calendar.jsx`:

- `summary`
- `dates`
- `warnings`
- `source`
- `data_sources`
- `truncated`
- `date_from`
- `date_to`
- `generated_at`
- event item fields
- production item fields
- delivery item fields
- compliance item fields

No `Calendar.jsx` change is required. Additive metadata can be ignored by the current UI.

## Calendar-specific safety rules

G39H preserves these policies:

- Hub fallback remains active.
- Subscriptions and multi-delivery remain Hub source-of-truth unless exact native occurrence parity is separately proven.
- Late/historical mirror rows are not live production or delivery command candidates.
- Calendar event presence does not imply command readiness.
- Notifications remain held.
- Provider calls remain disabled.
- Inventory deduction and PO automation remain held.
- Customer-facing calendar/status behavior is unchanged.
- No write buttons/actions are added.

## Test coverage

Added harness:

- `scripts/migration/run-g39h-admin-calendar-events-native-first-tests.mjs`

Fixture coverage proves:

1. Native calendar event present -> native event is primary.
2. Hub event absent -> native event still returned.
3. Native event missing and Hub event present -> Hub fallback used.
4. Native event incomplete and Hub event present -> native event returned with Hub fallback context.
5. Duplicate native/Hub same order/date/event type -> deduped, native primary.
6. Subscription/multi-delivery event remains Hub source-of-truth.
7. Historical/late mirror event is classified safely and not as a command candidate.
8. Stale Hub event is suppressed when corrected native date exists.
9. Hub-only active event is retained.
10. No events returns an empty safe response.
11. Existing response shape remains backward-compatible.
12. No customer email/phone is returned.
13. No raw Hub/provider/payment payload is returned.
14. `writes_performed:false`.
15. `provider_call_impact:false`.
16. `notifications_sent:false`.
17. `hub_mutation_performed:false`.
18. No logs/queues are created.
19. Native-first fallback metadata is returned.
20. `live_command_candidate:false` is returned.

Regression harnesses run with G39H:

- G39B admin native-vs-Hub read parity
- G39D admin delivery route native-first
- G39F admin production planning native-first

## No-write policy

G39H is a read-only admin surface patch. It does not create, update, upsert, or delete live records. It does not create `OrderSyncLog`, `CommandLog`, `OrderReviewQueue`, `Notification`, `CustomerMessageDeliveryLog`, `PurchaseOrder`, or any other row. It does not call Stripe, Shopify, delivery providers, or notification providers. It does not mutate Hub records.

## Rollback plan

Rollback is code-only:

1. Revert the `getAdminCalendarEventsSummary` native-first patch.
2. Republish only `getAdminCalendarEventsSummary`.
3. Keep Hub fallback active throughout.
4. No data repair should be needed because the patch is read-only.
5. Smoke `/admin/calendar` after rollback.

## Next phase recommendation

After G39H is merged, published, boundary-verified, and live-smoked, choose the next Hub dependency burn-down target. The likely next options are:

1. `admin_orders` parity/mismatch plan if order-list mismatch details are ready to analyze.
2. `operations_dashboard` aggregate mismatch analysis if a safer aggregate-first path is preferred.
3. Hold if the calendar smoke exposes any response-contract gap.
