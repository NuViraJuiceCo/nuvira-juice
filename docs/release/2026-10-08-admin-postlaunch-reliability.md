# Admin post-launch reliability

## Scope

Candidate based on `4f90acde15918ad783ede1e14d1d64896b89b81b` (PR #816).
Publication requires approval for both the website and the existing
`getAdminOperationsDashboardSummary` gateway. A website-only publication does
not deliver the inventory classification fix. No customer checkout changes,
native publication, entity changes, automation changes, provider operations,
notifications, or operational record corrections are included.

## Changes

- Events and Inventory require explicit save confirmation before closing an
  editor or reporting success. Failed or ambiguous responses preserve entries,
  focus the inline error, and warn against blindly retrying a possible save.
- Fresh editors clear prior mutation errors. Inventory import and Shopify
  actions also reject unconfirmed responses; no such live actions were tested.
- Active Inbox filters active alerts by default; All Statuses is explicit.
- Inventory and Operations share quantity/count classification. Missing and
  pending quantities are not stockouts or authoritative counts. Food remains
  demand-based, including honey. Numeric legacy counts retain existing rules.
- Operations shows pending counts and Shopify bag sync errors separately from
  verified stock warnings. A pending bag can require both checks. Neither
  regular nor compact watchlists call an outstanding inventory issue Clear.
- Inventory navigation no longer claims the editable page is read-only.
- Notification delivery result copy uses the correct singular/plural.
- Two stale admin regression harness paths were restored. The critical runner
  includes them, the new isolated reliability suite, and the browser consumption
  guide suite (188 suites total).

## Browser Consumption Guide Follow-up

The October 8 product-page report adds a browser-only consumption-guide refresh
for Radiance, Hydration, and Reset. The existing native guide is unchanged.
The new guide shows day tabs, consistent bottle cards with approved product
photos, and optional shots only on their assigned day. Changing program length
resets the selected day. The existing formula, bottle counts, suggested times,
prices, checkout behavior, and label/storage guidance remain unchanged.
How-it-works steps use compact, aligned icon/text rows instead of reserved blank
heading space. Hydration keeps its red program accents.

Local built-page verification covered all three programs at 390, 768, and 1440
pixels, image loading, keyboard day navigation, partial/mixed/full shot plans,
shot removal, and two-/three-day option changes. All nine width/program checks
had no horizontal overflow and equal schedule-card heights within rendering
roundoff. The direct page reported no console warnings/errors; the temporary
iframe test wrapper reported three MutationObserver errors during navigation,
without preventing the rendered layout or interaction checks.

Lint, typecheck, the tracked secret scan, and all 188 critical suites passed.
The configured production build is 48,982,336 bytes (17,664 bytes below the
repository's 49 MB gate). This is local candidate evidence, not publication or
physical Safari/device certification. Evidence files are prefixed
`consumption-guide-` in the local evidence folder. The read-only preview is
`http://127.0.0.1:4213/program/reset`.

## Backend Boundary

Only two handlers and their shared classification helper change, plus the
gateway revision marker. The gateway name, dispatch table, authorization,
request operations, provider ownership, and reward route revision are unchanged.
Inventory count validation uses the same helper as its read model; a missing
quantity cannot qualify as verified for a Shopify inventory action.

Browser call sites are Operations, Reporting, and Inventory Status. Existing
SDK gateway routing is unchanged. No scheduled workflow or entity configuration
changes are needed. Existing clients can ignore the added summary count fields.

On October 8 the deployed gateway was pulled read-only and its bundled source
matched the committed base byte-for-byte: 1,712,232 bytes, SHA-256
`722103047d20b5c50be26d8dc9fda458496080912d482f5ed9e172dabc8fdeed`.
Retained baseline: `/private/tmp/nuvira-admin-live-baseline-20261008`.
The new revision is `2026-10-08.admin-inventory-count-parity`.

## Verification and Promotion

The local browser checks use real React components with synthetic API responses
and no live writes: save confirmation/failure, retained drafts, error focus,
filter requests, and 1440/768/390 layouts. The focused backend suite invokes the
actual handlers with blocked writes and provider calls, including authorization,
missing quantities, demand-based food, verified thresholds, and pending bags
with sync errors. Existing G39N, G56A, G93, and G110 suites cover compatibility.

Before publication, require full critical regressions, lint/typecheck, tracked
secret scan, production build/size and dependency-boundary checks, PR review and
hosted CI. Package only a clean, exact commit using
`scripts/release/package-admin-gateway.mjs`; keep its input hashes and bundle
hash alongside the website manifest. Do not deploy all Base44 resources.

After approval, recheck production baseline, publish only this gateway and the
website, and verify the revision probe plus authenticated read-only Operations,
Inventory, Alerts, Events, Reporting, and Notifications. Compare counts and
confirm no read/render errors. Live operational writes and provider actions
remain separate tests requiring explicit authorization.

## Rollback and Limits

Keep the pulled gateway and the previous website artifact before promotion.
Restore the affected artifact if admin reads fail, summary counts diverge, or
save feedback regresses. Do not rebuild a guessed rollback or alter inventory
records to make a dashboard appear clear.

The locked dependency audit has 13 existing high findings and no new findings.
The expiring website-only dependency exception does not authorize a backend or
native release; the admin package is built only from repository backend/shared
sources with its existing external SDK imports. Website asset headroom remains
small and must be measured for each candidate. Physical stock verification,
payment submission, and provider effects are not established by these checks.

Local evidence: `outputs/admin-postlaunch-fixes-20261008` in the NuVira workspace.
This document describes a candidate, not proof of production publication.
