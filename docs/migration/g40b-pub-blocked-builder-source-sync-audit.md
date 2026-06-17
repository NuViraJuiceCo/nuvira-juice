# G40B-PUBBLOCK — Builder source sync blocker audit

## 1. Executive summary

G40B fixed customer-facing event time semantics in GitHub source, but the Base44 Builder preview and live customer app are still serving an older customer-app bundle. G40B must remain **merged, not live** until Builder preview/source contains the G40B markers and a clean manual publish scope is confirmed.

This audit is docs-only/read-only. It does not publish Builder, does not use Builder Fix All, does not change runtime code, does not mutate records, does not call providers, and does not send notifications.

## 2. GitHub/main source state

GitHub PR:
- PR: <https://github.com/NuViraJuiceCo/nuvira-juice/pull/499>
- Merge commit: `985e61e18cadff1dcb55831d70d81bd33a424d8b`
- Merged at: `2026-06-17T21:59:38Z`

`origin/main` contains the expected G40B files:
- `src/lib/eventTimeSemantics.js`
- `src/pages/Events.jsx`
- `scripts/migration/run-g40b-event-time-semantics-tests.mjs`
- `docs/migration/g40b-customer-event-time-semantics-patch.md`

`origin/main` source contains the expected G40B markers:
- `Time TBD`
- `All day`
- `ambiguous_raw_time`

Local validation from a clean branch created at `origin/main` passed:
- `node --check src/lib/eventTimeSemantics.js`
- `node --check scripts/migration/run-g40b-event-time-semantics-tests.mjs`
- `node scripts/migration/run-g40b-event-time-semantics-tests.mjs`
- `npm run build`

The local built bundle contains the expected G40B markers:
- `Time TBD`: present
- `All day`: present
- `ambiguous_raw_time`: present

Conclusion: no repo-side source gap was found.

## 3. Builder current version evidence

Read-only Base44 Builder inspection for the customer app showed Version History current visible version as:

- `G38C: verify production command boundaries`
- Current
- 2 days ago

The visible Builder version history did not show G40B as the current Builder source/version during this audit.

The Builder Publish dialog only exposed generic web publish controls. It did not show file-level scope for:
- `src/lib/eventTimeSemantics.js`
- `src/pages/Events.jsx`

No final publish action was clicked.

## 4. Builder preview marker check

Builder preview URL checked:
- `https://preview--nuvira-fresh-flow.base44.app/events?hide_badge=true&base44_data_env=prod&server_url=https%3A%2F%2Fpreview--nuvira-fresh-flow.base44.app`

Builder preview JS asset observed:
- `/assets/index-CPNvGmLs.js`

Builder preview marker result:
- `Time TBD`: absent
- `All day`: absent
- `ambiguous_raw_time`: absent

Conclusion: Builder preview is not serving the merged G40B customer-event time formatter bundle.

## 5. Live bundle marker check

Live page checked:
- `https://nuvirajuice.com/events`

Live JS asset observed:
- `/assets/index-CAV8vOI2.js`

Live marker result:
- `Time TBD`: absent
- `All day`: absent
- `ambiguous_raw_time`: absent

Conclusion: live `/events` is not serving the merged G40B customer-event time formatter bundle.

## 6. Source sync path audit

Repository audit found:
- no `.github/workflows` CI deploy workflow
- no repo-local Base44 publish CLI
- no package script for deploy or publish
- no safe scoped UI publish command
- README publish path is manual Base44 Builder Publish

Builder UI audit found:
- Base44 Builder is accessible for the customer app
- Version History current visible Builder source is older than G40B
- Publish dialog is available but does not expose file-level scope
- no clearly safe non-publish `sync from GitHub`, `pull latest`, `reload source`, or equivalent action was confirmed during read-only inspection

Because Builder preview lacks G40B markers, clicking Publish would not safely deploy the intended event-time fix. It could publish an older or unrelated Builder state.

## 7. Classification

Sync state classification:

```text
builder_connected_but_pinned_to_old_version
```

Publish safety classification:

```text
customer_event_time_semantics_patch_blocked_by_builder_source_desync
```

G40B status remains:

```text
merged, not live
```

## 8. Safe unblock requirements

Before any G40B publish attempt:

1. Builder preview/source must visibly include the merged G40B source from GitHub/main.
2. Builder preview JS must contain:
   - `Time TBD`
   - `All day`
   - `ambiguous_raw_time`
3. Pending publish scope must be clean and limited to customer app/UI changes for:
   - `src/lib/eventTimeSemantics.js`
   - `src/pages/Events.jsx`
4. There must be no pending schema/entity/function changes.
5. There must be no unrelated Builder changes.
6. Builder Fix All must not be used.

Only after those requirements are met should G40B-PUB3 manual publish and live `/events` smoke proceed.

## 9. Hard stops

Stop and do not publish if any of the following are true:

- Builder preview lacks `Time TBD`
- Builder preview lacks `All day`
- Builder preview lacks `ambiguous_raw_time`
- Builder current source/version is still older than G40B
- Builder pending scope is dirty or not inspectable
- Publish dialog does not allow enough confidence about scope
- Any schema/entity/function publish appears pending
- Any unrelated UI changes appear pending
- Any Fix All prompt appears
- Any provider/notification/order/delivery/production behavior appears in scope

## 10. Recommendation

Do not run Builder Publish yet.

Recommended owner/admin action:
1. Resolve the Builder/source desync so the customer app Builder preview pulls or reflects GitHub/main at `985e61e18cadff1dcb55831d70d81bd33a424d8b` or newer.
2. Recheck Builder preview markers.
3. If preview markers are present and pending scope is clean, proceed with G40B-PUB3 manual publish and live `/events` smoke.
4. If no safe Builder source refresh path is available, escalate to Base44 support/project source refresh.

Until then, continue only unrelated docs/read-only migration work.
