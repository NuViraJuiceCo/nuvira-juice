# G40C: Event backend-to-customer parity audit

## 1. Executive summary

G40C is a docs-only/static/read-only audit of the backend/admin Event data path into the customer-facing `/events` page.

Findings:

- Customer-facing `/events` is backend-driven by the Base44 `Event` entity. It is not currently driven by hardcoded event fixtures because `HARDCODED_EVENTS` is an empty array.
- `/events` queries active backend Event records at runtime with `base44.entities.Event.filter({ is_active: true }, 'date', 50)`.
- Backend/admin Event changes should update customer-facing event content without a Builder publish, assuming the live customer app bundle can already run the current `/events` route and the Event row matches the active filter.
- Frontend code changes, such as G40B time semantics, still require a customer app/UI bundle publish.
- The previous G40B source-desync blocker appears to have changed at the live asset level during this audit: live `/events` now serves a JS asset containing `Time TBD`, `All day`, and `ambiguous_raw_time`. This is asset-marker evidence only; G40B still needs a dedicated live `/events` smoke/no-write closeout before reclassification.
- Event schema is sufficient for current customer display fields but insufficient for fully explicit event time semantics because it only defines `date` and `time`; optional fields used by G40B are runtime-tolerated but not schema-defined.

Primary classification:

```text
customer_events_backend_driven_publish_smoke_pending
```

Carry-forward G40B classification should not be upgraded by this docs phase alone. Recommended next step is a focused G40B-PUB3 live `/events` smoke now that live asset markers appear present.

## 2. Current G40B publish blocker

Prior state from G40B-PUBBLOCK:

- GitHub/main source contained G40B.
- Local build contained G40B markers.
- Builder preview and live bundles lacked G40B markers.
- Classification was:

```text
customer_event_time_semantics_patch_blocked_by_builder_source_desync
```

G40C rechecked the live customer app asset read-only. Current observed live asset:

```text
/assets/index-iaYG2CAK.js
```

Current live marker check:

| Marker | Live asset result |
| --- | --- |
| `Time TBD` | present |
| `All day` | present |
| `ambiguous_raw_time` | present |

Interpretation:

- The live customer app bundle now appears to include the G40B event time helper markers.
- This suggests either Builder source/publish was refreshed after the earlier blocker or the live bundle changed by another deployment path.
- This audit did not inspect Builder UI, did not publish, and did not perform a full visual `/events` smoke.
- Do not call G40B closed/live solely from G40C. Run G40B-PUB3-style `/events` smoke and no-write verification first.

## 3. Backend Event source audit

### Entity

`base44/entities/Event.jsonc` defines the customer-facing event record shape:

- `hub_event_id`
- `title`
- `description`
- `date`
- `time`
- `location`
- `image_url`
- `price`
- `capacity`
- `is_active`
- `tags`
- `website_link`
- `tickets_link`

RLS:

- create/update/delete: admin only
- read: public/default read

Backend source classification:

```text
backend_event_source_confirmed
```

### Creation/editing sources

Audited write-capable Event paths:

| Source | File/function | Behavior | Current state |
| --- | --- | --- | --- |
| Admin/Base44 entity management | `Event` entity RLS | Admin can create/update/delete Event rows through backend/admin tooling | Native/backend source available |
| Hub inbound bridge | `syncEventsFromHub` | Creates/updates/deletes `Event` by `hub_event_id`, fallback dedup by title/date | Disabled unless `ENABLE_LEGACY_LOYALTY_EVENT_BRIDGE_SYNC=true` |
| Hub inbound bridge | `receiveSyncedEvent` | Creates/updates/deletes `Event` by `hub_event_id` | Disabled unless `ENABLE_LEGACY_LOYALTY_EVENT_BRIDGE_SYNC=true` |
| Hub outbound bridge | `syncEventToHub` | Pushes Event changes with `hub_event_id` back to Hub | Disabled unless `ENABLE_LEGACY_LOYALTY_EVENT_BRIDGE_SYNC=true` |
| Hub export proxy | `hubSyncProxy` `resource_type=events` | Reads Event rows and returns sanitized event fields to Hub | Read-only export, auth-token protected |
| Customer event booking inquiry | `src/pages/BookEvent.jsx` | Sends email inquiry through Base44 integration | Does not create `Event` rows |

Current bridge classification:

```text
hub_fallback_active_event_bridge_disabled_by_default
```

## 4. Customer `/events` data path audit

Customer route:

- `src/App.jsx` maps `/events` to `src/pages/Events.jsx`.

Customer query:

```js
base44.entities.Event.filter({ is_active: true }, 'date', 50)
```

Customer page behavior:

- reads backend `Event` records at runtime;
- filters to `is_active: true`;
- sorts by `date` ascending through the Base44 query sort argument;
- limits to 50 rows;
- merges in `HARDCODED_EVENTS`, but that array is currently empty;
- displays event title, date/time, location, description, image, ticket link, website link, and optional highlights;
- uses G40B `resolveEventTimeSemantics(event).displayTime` for display in current GitHub/main source;
- uses G40B `eventStructuredDateTimes(event)` for schema.org structured event data in current GitHub/main source.

Customer data-path classification:

```text
customer_events_backend_driven
```

### Customer app updates from backend-added events

Backend/admin-added events should appear on `/events` when all are true:

1. the record is in the Base44 `Event` entity;
2. `is_active` is exactly `true`;
3. the record is within the first 50 results sorted by `date`;
4. the live customer app bundle can load `/events` successfully;
5. the record has enough display fields for the current card layout.

Builder publish is not required for ordinary Event data changes. Builder publish is required for frontend behavior changes such as formatter logic, display fields, filters, or card layout changes.

## 5. Backend-to-customer parity checklist

Use this checklist for any live event parity smoke. It is intentionally read-only.

| Backend/admin field | Customer `/events` display | Required parity behavior |
| --- | --- | --- |
| `id` | React key/internal only | Should not be shown to customers. |
| `hub_event_id` | Not displayed | Should not be shown to customers. |
| `title` | Card title | Must match backend title. |
| `date` | Date prefix | Must match backend date or safe formatted date if later patched. |
| `time` | Time display through semantics helper | Broad operational windows should show `Time TBD`; explicit times should show exact time. |
| `location` | Location row | Must match safe backend location. |
| `description` | Description copy | Must not expose raw/admin-only payloads. |
| `image_url` | Card image | Should render if safe/public. |
| `is_active` | Visibility filter | `true` visible; inactive/draft/internal rows should not be visible. |
| `website_link` | Website button | Visible only when present. |
| `tickets_link` | Get Tickets button | Visible only when present. |
| `tags` | Not currently displayed by `/events` | Safe to remain backend-only. |
| `price` / `capacity` | Not currently displayed by `/events` | Safe to remain backend-only. |

Current parity gaps:

- `Event` schema does not define `type`, but `/events` references `event.type` for badge styling. Backend-added events without `type` render an undefined/empty badge state unless runtime data includes an undeclared `type` field.
- `Event` schema does not define `highlights`, but `/events` optionally renders `event.highlights` if present.
- `Event` schema does not define `start_time`, `end_time`, `timezone`, or `all_day`, while G40B helper supports them if records contain those fields dynamically.
- `/events` does not filter out past dates; it labels the section `Upcoming` but reads all active events sorted by date. Past active records can still appear unless deactivated or a future-date filter is added.
- Draft/internal visibility is only represented by `is_active:false`; there is no separate `published`, `draft`, or `internal_only` schema field.

Classification:

```text
customer_events_parity_gap_minor_schema_display_fields
```

## 6. Time semantics carry-forward

G40B intended behavior remains correct:

| Event time input | Customer display |
| --- | --- |
| explicit start and end | exact range |
| explicit start only | start time only |
| all-day/date-only | `All day` |
| missing/ambiguous time | `Time TBD` |
| `7am-7pm` | `Time TBD` |
| `7:00 AM - 7:00 PM` | `Time TBD` |
| `07:00-19:00` | `Time TBD` |

Current GitHub/main source implements these semantics in:

- `src/lib/eventTimeSemantics.js`
- `src/pages/Events.jsx`

Current live asset marker evidence indicates these semantics may now be deployed, but visual/customer data smoke remains required before final G40B live classification.

Classification:

```text
customer_events_time_semantics_asset_markers_present_smoke_pending
```

## 7. Publish/deploy dependency

| Change type | Requires Builder/UI publish? | Notes |
| --- | --- | --- |
| Add/update backend `Event` record | No | Customer `/events` queries Event records at runtime. |
| Toggle `is_active` | No | Runtime query should reflect active rows. |
| Change title/date/time/location/description/link/image | No | Runtime query should reflect current backend data. |
| Change `/events` UI/formatter/filter/card behavior | Yes | Requires customer app bundle publish. |
| Add schema fields | Yes, separate schema publish plan | Do not add casually; requires schema audit. |
| Change Hub event bridge behavior | Yes, function publish/gate plan | Bridge is disabled by default. |

Current deployment finding:

- GitHub/main source is correct for G40B.
- Current live customer app asset contains G40B markers.
- Builder source/version was previously pinned to old G38C during G40B-SYNC1; G40C did not re-open Builder UI.
- If Builder still shows stale source, owner/admin should resolve Builder source parity before the next manual publish even though live asset markers are now present.

Classification:

```text
customer_events_publish_dependency_ui_code_only_data_runtime_driven
```

## 8. Classifications

| Domain | Classification |
| --- | --- |
| Backend Event storage | `backend_event_source_confirmed` |
| Customer `/events` data path | `customer_events_backend_driven` |
| Static/customer fixture dependency | `customer_events_not_static_fixture_driven` |
| Hub event bridge | `customer_events_hub_bridge_disabled_by_default` |
| Data publish dependency | `customer_events_data_updates_do_not_require_builder_publish` |
| UI publish dependency | `customer_events_ui_code_changes_require_builder_publish` |
| G40B live asset state | `customer_events_time_semantics_asset_markers_present_smoke_pending` |
| Event schema | `customer_events_schema_sufficient_for_basic_cards_but_time_semantics_fields_incomplete` |
| Live parity | `customer_events_safe_for_live_smoke` |

## 9. Hard stops

- Do not publish if Builder source is still pinned to an old version and pending scope is dirty or not confirmable.
- Do not use Builder Fix All.
- Do not expose `hub_event_id`, raw Hub payloads, raw provider payloads, payment payloads, auth values, or admin-only metadata to customers.
- Do not mutate Event records during parity audit.
- Do not treat G40B as finally closed until `/events` live smoke confirms display behavior and no-write side effects.
- Do not enable legacy Hub event bridge without separate approval.
- Do not add schema fields for event time semantics without separate schema/admin input audit.
- Do not change order/delivery/production migration behavior as part of event parity work.

## 10. Recommendation

Recommended next outcomes:

1. **Run G40B-PUB3 smoke/closeout now that live asset markers appear present.**
   - Confirm `/events` loads.
   - Confirm backend-added active events render.
   - Confirm broad windows show `Time TBD`.
   - Confirm all-day/date-only events show `All day` where data supports it.
   - Confirm explicit time records still show exact time.
   - Confirm no records mutated.

2. **If live event data does not match backend/admin Event rows, plan a focused runtime/customer page patch.**
   - The likely source would be filtering, `is_active` values, stale client cache, missing fields, or live bundle mismatch.

3. **If backend event data lacks needed fields, plan a schema/admin event input audit.**
   - Candidate fields: `start_time`, `end_time`, `timezone`, `all_day`, `published_status`, `event_type`, `internal_only`.

4. **Keep Hub event bridge disabled/held unless explicitly needed.**
   - Current customer path does not require Hub for ordinary backend/admin Event display.

Do not run record mutations, Builder publish, provider calls, notifications, sync/repair/replay, or customer order/delivery/production changes from G40C.
