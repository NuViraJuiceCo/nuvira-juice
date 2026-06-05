# G23A Remaining Base44 Security Findings

Date: 2026-06-05
App: NuVira Juice Customer App (`69d48d0c39891f7945481152`)

## Summary

G23A reduced the visible Base44 security findings from the original baseline set to the remaining items below without using Base44 Fix All.

Published fixes completed before this note:

- G23A4: remaining entity RLS hardening for compliance and push-related entities.
- G23A5: admin auth hardening for remaining loyalty audit and native fulfillment preview functions.
- G23A6: scanner-obvious admin auth hardening for `verifyOutForDeliveryNotification`.
- G23A8: helper auth hardening for scheduling utilities and env-only legacy Hub loyalty URL configuration.

No native safeSync writer was enabled. No live business records were intentionally mutated. No Stripe, Shopify, provider, notification, sync, repair, production, fulfillment, inventory, or compliance action was run as part of these hardening changes.

## Current Scan State

After the G23A8 publish, the Base44 security page scan attempt still displayed the expanded visible set while the scan was in progress:

- 1 exposed-secret-style warning for `pushLoyaltyMemberToHub`.
- 6 unauthenticated backend function warnings:
  - `previewNativeSafeSyncDarkLaunchComparison`
  - `previewNativeSafeSyncOrderUpdate`
  - `assignDeliveryWindow`
  - `assignProductionWindow`
  - `testSchedulingLogic`
  - `validateComplianceEntry`
- 1 security header recommendation for `X-Frame-Options`.

Runtime boundary checks below are the source of truth for whether a listed function is actually publicly executable without auth.

## Remaining Visible Findings and Classifications

### `verifyOutForDeliveryNotification` auth warning

Base44 still showed this static finding immediately after the G23A6 publish/scan attempt:

- Category: unauthenticated backend function
- File: `functions/verifyOutForDeliveryNotification`
- Stated risk: debug utility could trigger notifications for any customer

Runtime boundary verification after G23A6 publish:

- `POST https://nuvirajuice.com/api/functions/verifyOutForDeliveryNotification` without auth returned `401`.
- `POST https://nuvira-fresh-flow.base44.app/api/functions/verifyOutForDeliveryNotification` without auth returned `401`.

Current classification:

- Runtime boundary is fail-closed for unauthenticated calls.
- The remaining visible finding should be treated as a Base44 static-scan lag/false positive unless a future scan proves otherwise.
- No valid/admin notification-triggering test was run during this phase.

Next action:

- Re-run Base44 security scan after the dashboard scan finishes or after the next publish window.
- If the warning remains visible while unauthenticated live calls continue to return `401`, escalate as a Base44 scanner/static-analysis issue rather than adding broader runtime changes.

### `pushLoyaltyMemberToHub` hardcoded Hub URL warning

Base44 showed a critical exposed-secret-style warning for the legacy Hub loyalty sync endpoint URL.

G23A8 source patch:

- Removed the hardcoded Hub URL from `pushLoyaltyMemberToHub`.
- Reads `HUB_LOYALTY_SYNC_URL` from runtime config if the existing `ENABLE_LOYALTY_MANUAL_HUB_PUSH` flag is ever enabled.
- Preserves the existing disabled default.

Runtime boundary verification after G23A8 publish:

- `POST https://nuvirajuice.com/api/functions/pushLoyaltyMemberToHub` without auth returned the safe disabled response.
- `POST https://nuvira-fresh-flow.base44.app/api/functions/pushLoyaltyMemberToHub` without auth returned the safe disabled response.

Current classification:

- Source-level hardcoded URL issue is patched.
- The function remains disabled by default before auth or Hub calls.
- If the scan continues to show this warning after a completed fresh scan, treat it as scan lag and re-run after the next publish window.

### Scheduling helper auth warnings

Base44 showed unauthenticated warnings for:

- `assignDeliveryWindow`
- `assignProductionWindow`
- `testSchedulingLogic`

G23A8 source patch:

- `assignDeliveryWindow` now requires admin auth before parsing request payload.
- `assignProductionWindow` now requires admin auth before parsing request payload.
- `testSchedulingLogic` now returns `401` for unauthenticated callers and `403` for non-admin callers.

Runtime boundary verification after G23A8 publish:

- All three functions returned `401` without auth on both `nuvirajuice.com` and `nuvira-fresh-flow.base44.app`.

Current classification:

- Runtime boundary is closed.
- If these warnings remain visible after a completed fresh scan, treat them as static-scan lag unless a future boundary test proves otherwise.

### `validateComplianceEntry` auth warning

Base44 showed an unauthenticated helper warning for `validateComplianceEntry`.

Current source behavior:

- POST-only.
- Requires authenticated `admin` or `staff`.
- Can create `ComplianceAlert` only after auth and valid compliance payload.

Runtime boundary verification:

- `POST https://nuvirajuice.com/api/functions/validateComplianceEntry` without auth returned `401`.
- `POST https://nuvira-fresh-flow.base44.app/api/functions/validateComplianceEntry` without auth returned `401`.

Current classification:

- Runtime boundary is closed.
- Treat the remaining visible warning as static-scan lag/false positive unless future boundary testing changes.

### Native safeSync preview auth warnings

Base44 still shows unauthenticated warnings for:

- `previewNativeSafeSyncOrderUpdate`
- `previewNativeSafeSyncDarkLaunchComparison`

Current source behavior:

- Dry-run only.
- No native writer enabled.
- No live entity writes.
- Used by fixture runners and by backend service-role callers such as `syncOrderToHub`, `processMay30NativeOrderOps`, and `executeNativeSafeSyncOrderUpdate`.

Current classification:

- Real hardening candidate, but not patched in G23A because adding direct user auth could break backend service-role invocations without an approved internal-call auth contract.
- Do not patch blindly.

Recommended next action:

- Add a dedicated internal/admin access contract for native preview functions.
- Preserve fixture runner imports, dry-run behavior, and backend service-role invocation compatibility.
- Boundary test direct unauthenticated calls after the contract patch.

### X-Frame-Options recommendation

Base44 still shows:

- Category: security header recommendation
- Finding: block iframe embedding with `X-Frame-Options`
- Stated risk: auth and payment pages can be clickjacked without this header

Live response header spot check:

- `https://nuvirajuice.com` returned `strict-transport-security`, `x-content-type-options`, and `referrer-policy`.
- `X-Frame-Options` was not present in the checked response.

Current classification:

- Platform/header backlog item.
- Do not implement an unsafe app-code header workaround unless Base44 exposes a supported project setting or documented deployment header configuration.
- No known Customer App iframe embedding requirement was identified during this phase.

Recommended target if supported by Base44:

- Prefer `X-Frame-Options: DENY` for the Customer App.
- Use `SAMEORIGIN` only if a confirmed NuVira-owned admin/embed workflow requires same-origin framing.

Next action:

- Use Base44-supported security header configuration if available.
- Otherwise open a Base44 support item requesting an app-level X-Frame-Options setting for the Customer App domains.

## Non-Backlog Items Resolved

The following original visible findings are no longer considered open G23A blockers:

- `BatchComplianceLog` RLS: direct entity access hardened to admin/ops scope.
- `ComplianceAlert` RLS: direct entity access hardened to admin/ops scope.
- `DeliveryWaitlist` RLS: public create preserved for the active waitlist form; public reads remain blocked.
- `PushSubscription` RLS: user-owned/admin access applied; public token reads are not allowed.
- `auditCustomerAppLoyaltyAfterPhase2`: unauthenticated access returns `401`.
- `previewNativeFulfillmentTaskLifecycle`: unauthenticated access returns `401`.
- `verifyOutForDeliveryNotification`: unauthenticated runtime access returns `401`; static scan follow-up remains.
- `pushLoyaltyMemberToHub`: hardcoded Hub URL removed from source; disabled response preserved.
- `assignDeliveryWindow`: unauthenticated runtime access returns `401`.
- `assignProductionWindow`: unauthenticated runtime access returns `401`.
- `testSchedulingLogic`: unauthenticated runtime access returns `401`.
- `validateComplianceEntry`: unauthenticated runtime access returns `401`; static scan follow-up remains.

## Hard Stops Preserved

- No Base44 Fix All.
- No native safeSync writer enablement.
- No live safeSync writer call.
- No provider calls.
- No notifications sent.
- No sync, repair, replay, production, fulfillment, inventory, compliance, payment, refund, or order-processing behavior changes.
