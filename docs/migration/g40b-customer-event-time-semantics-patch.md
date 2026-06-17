# G40B — Customer Event Time Semantics Patch

## 1. Purpose

G40B fixes customer-facing event time display semantics for `/events`. The immediate issue is that Hub-added events can appear in the Customer App with misleading broad windows such as `7am-7pm`. That window may represent a broad operational/business-hours default, not the real customer-facing event time.

This phase is focused only on customer event time display and structured event dates. It does not change order history, order tracker, delivery queue, production lifecycle, notifications, inventory, PurchaseOrders, Hub fallback, Hub write behavior, or provider integrations.

## 2. Current bug / incorrect broad-window behavior

Before this patch, `src/pages/Events.jsx` displayed raw event data directly:

- date source: `event.date`
- time source: `event.time`
- display: `event.date · event.time`
- structured data: `startDate`/`endDate` were built from `event.date`, `event.time`, `event.end_time`, or a synthetic midnight fallback.

If Hub or legacy sync populated `Event.time` with a default like `7am-7pm`, the Customer App rendered that as a real event time. That is not safe because the app cannot know whether that broad range is true customer-facing event hours, business hours, or a placeholder.

## 3. Audited event fields

Audited files/surfaces:

- `src/pages/Events.jsx`
- `base44/entities/Event.jsonc`
- `base44/functions/syncEventsFromHub/entry.ts`
- `base44/functions/receiveSyncedEvent/entry.ts`
- `base44/functions/syncEventToHub/entry.ts`
- `base44/functions/hubSyncProxy/entry.ts`
- `base44/functions/getAdminCalendarEventsSummary/entry.ts`
- `docs/migration/g39r-full-hub-migration-scoreboard-current-state.md`

Current `Event` schema has these event time/date fields:

- `date`
- `time`

It does not explicitly define:

- `start_time`
- `end_time`
- `start_datetime`
- `end_datetime`
- `timezone`
- `all_day`
- canonical `time_label`

The admin calendar summary already tolerates optional `start_datetime`, `end_datetime`, `date`, `event_date`, and `time` fields at runtime, but the public customer Events page did not use a safe normalization layer.

## 4. Chosen time semantics

G40B adopts these display rules:

1. Explicit start and end time: display an exact local range.
2. Explicit start only: display the start time only.
3. All-day/date-only: display `All day` only.
4. Missing or unreliable time: display `Time TBD`.
5. Broad operational windows such as `7am-7pm`, `7:00 AM - 7:00 PM`, or `07:00-19:00` are treated as ambiguous and displayed as `Time TBD`.
6. America/Chicago is the default display timezone unless a safe event timezone is present.
7. The UI does not infer event time from business hours, delivery windows, or broad operational windows.
8. Existing titles, dates, descriptions, locations, images, links, and tags remain unchanged.

## 5. Schema sufficiency decision

Schema mutation is not included in G40B.

Reason:

- The immediate customer-facing bug can be fixed safely at the display/formatting layer.
- Current live records may already carry only `date` and raw `time`; changing schema would not automatically repair them.
- Adding fields such as `start_time`, `end_time`, `timezone`, and `all_day` should be handled in a separate schema/data audit if broader event management is migrated.

G40B therefore adds a backward-compatible helper that:

- uses optional explicit fields when present
- preserves safe existing labels when present
- refuses to present known broad operational windows as exact event time
- does not write or repair records

## 6. Runtime/UI patch summary

Changed runtime/UI files:

- `src/lib/eventTimeSemantics.js`
- `src/pages/Events.jsx`

New helper behavior:

- `resolveEventTimeSemantics(event)` returns safe display metadata:
  - `displayTime`
  - `timeZone`
  - `allDay`
  - `hasReliableTime`
  - `ambiguousTime`
  - `source`
- `eventStructuredDateTimes(event)` returns structured `startDate`/`endDate` without inventing an end time for ambiguous/date-only events.
- Broad 7am-7pm style windows are normalized to `Time TBD`.
- Date-only/all-day events do not show a fake 7am-7pm range.

`Events.jsx` now displays:

- `event.date · resolveEventTimeSemantics(event).displayTime`

and uses `eventStructuredDateTimes(event)` for schema.org event dates.

## 7. Test coverage

Added:

- `scripts/migration/run-g40b-event-time-semantics-tests.mjs`

Coverage includes:

1. Explicit start/end event displays exact time range.
2. Explicit start-only event displays start only.
3. Date-only/all-day event does not display 7am-7pm.
4. Missing time event displays `Time TBD`.
5. Existing broad operational window is not treated as event time.
6. America/Chicago display is stable for explicit UTC datetimes.
7. Shared formatter remains compatible with admin/customer labels.
8. Hub fallback event with missing/broad time does not invent time.
9. Structured data does not invent end dates for ambiguous records.
10. Formatter contract does not return PII/raw payload/write/provider/notification fields.

## 8. No-write / no-provider policy

G40B does not:

- mutate `Event` records
- mutate Customer App records
- mutate native records
- mutate Hub records
- call Stripe
- call Shopify
- call route providers
- call notification providers
- send notifications
- run sync/retry/repair/replay
- open gates
- deduct inventory
- create PurchaseOrders
- suppress Hub writes
- disable Hub fallback

## 9. Rollback plan

If the customer events page displays unexpected time labels after publish:

1. Revert `src/pages/Events.jsx` to raw `event.time` display.
2. Remove `src/lib/eventTimeSemantics.js` usage from the Events page.
3. Republish only the customer app/UI scope required by the reverted change.
4. Do not mutate Event records as part of rollback.
5. Re-run the G40B formatter harness and customer event page smoke.

## 10. Recommendation

Close G40B if:

- broad operational windows no longer render as customer event time
- explicit event times still render correctly
- date-only/all-day events render safe copy
- build and formatter harness pass
- no writes/provider calls/notifications occur

After G40B, continue the wider Hub migration with:

1. Compliance native boundary/readiness audit.
2. Delivery Queue action migration audit.
3. Customer order history/tracker native parity preview.
4. Hub write suppression scoreboard.
