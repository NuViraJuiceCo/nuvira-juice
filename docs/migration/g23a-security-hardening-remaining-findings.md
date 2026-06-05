# G23A Remaining Base44 Security Findings

Date: 2026-06-05
App: NuVira Juice Customer App (`69d48d0c39891f7945481152`)

## Summary

G23A reduced the visible Base44 security findings from the original baseline set to the remaining items below without using Base44 Fix All.

Published fixes completed before this note:

- G23A4: remaining entity RLS hardening for compliance and push-related entities.
- G23A5: admin auth hardening for remaining loyalty audit and native fulfillment preview functions.
- G23A6: scanner-obvious admin auth hardening for `verifyOutForDeliveryNotification`.

No native safeSync writer was enabled. No live business records were intentionally mutated. No Stripe, Shopify, provider, notification, sync, repair, production, fulfillment, inventory, or compliance action was run as part of these hardening changes.

## Remaining Visible Findings

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

## Hard Stops Preserved

- No Base44 Fix All.
- No native safeSync writer enablement.
- No live safeSync writer call.
- No provider calls.
- No notifications sent.
- No sync, repair, replay, production, fulfillment, inventory, compliance, payment, refund, or order-processing behavior changes.
