# Browser Admin Refresh

## Scope

Website-only publication candidate based on
`b3245eede86610468fe48a2c9efaaeea5f17a969`. Covers the 25 existing admin
routes with a browser-specific navigation shell, readable light surfaces,
consistent operational typography, responsive tables and forms, accessible
dialogs, and explicit loading/error states. Unavailable reads no longer imply
zero counts or ready status. Failed product and compliance saves preserve entries
and require confirmed success before closing.

The customer website top-bar logo is reduced from 116 x 46 to 104 x 40 pixels,
with a minimum 44-pixel link target and unchanged navigation height. Compact
browser layouts use an 88 x 34 pixel image.

Native navigation and theme remain separate. This candidate does not publish
backend functions, change authorization, write operational records, send
notifications, redeem rewards, submit payments, update Appflow, or release an
installed app. Shared components receive compatibility checks only.

## Local Evidence

- All 184 critical regression harnesses passed, including the new admin suite.
- Full lint, typecheck, and configured production build passed.
- 25 admin routes checked at 1440, 800, and 390 CSS pixels with isolated data.
- Error states checked on every route; populated products, suppliers, and events
  reviewed separately.
- Product and compliance failed-save recovery, dialog focus restoration, compact
  navigation, notification tabs, and admin-theme cleanup checked locally.
- Header logo checked at 1440, 800, and 390 pixels with no horizontal overflow.
- Evidence and screenshots are kept outside Git in the local output directory.

Fixture-based browser checks do not certify real operational writes, all possible
record contents, full accessibility conformance, physical Safari devices, or
native release behavior. No production data was mutated during this review.

## Promotion Gates

Record the exact PR and approved commit, pass hosted checks, preserve a rehashed
current-live rollback artifact, then request final website publication approval.
After website-only publication, verify hosted asset hashes and public/authenticated
read-only route rendering. Do not deploy backend functions or native channels.

Rollback if customer navigation regresses, admin pages become unreadable, or
unexpected application errors appear. Restore the preserved website artifact;
do not alter operational data as part of a visual rollback.
