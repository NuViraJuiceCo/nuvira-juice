# Meta Shopping Funnel Tracking Update

Prepared September 6, 2026. Status: release approved by the user; deployment and live acceptance testing in progress.

## Source and Release Identity

- Base: canonical GitHub main `e0f1514dd0137e2c2e36fcc3060abce766f978f3`, refreshed at the start of this work.
- Local branch: `codex/meta-funnel-capi-20260906`.
- Worktree: `/Users/nuvisionary/Documents/NuVira Juice Co./nuvira-workspace/meta-funnel-capi-20260906`.
- Correct Base44 project: `69d48d0c39891f7945481152`.
- Meta dataset: `719023677458304`, `nuvirajuiceco's pixel`.
- Meta business: `837761741909478`; ad account: `1055493810138896`.
- Google GA4 stream: `G-H8R82365GM`.
- Live website still served `/assets/index-Do61ncEt.js` during this audit.
- The user explicitly approved this canonical-source release with "proceed" after being asked for publication approval. The earlier hold remains in force for unrelated work and incorrect projects.
- Never release from `NuViraCustomerApp-Temp`, the held Snapchat worktree, or Base44 project `6a0e3bf985b2c5cb0088adc7`. No native/Appflow release is part of this change.

## What Changes

| Event | Existing delivery | Added delivery |
| --- | --- | --- |
| ViewContent | Browser Meta Pixel | Server CAPI with the same event ID |
| AddToCart | Browser Meta Pixel | Server CAPI with the same event ID |
| InitiateCheckout | Browser Meta Pixel | Server CAPI with the same event ID |
| AddPaymentInfo | Browser Meta Pixel | Server CAPI with the same event ID |
| Purchase | Stripe-confirmed, server CAPI | No behavioral change |
| PageView, Search, Lead, CompleteRegistration | Browser Meta Pixel | No new server sender |

The browser starts the server request independently of pixel loading. A blocked pixel does not prevent the server request; slow/unavailable tracking cannot block a cart or payment action. Consent is checked before delivery and after asynchronous loading. Withdrawing consent cancels pending transport and clears attribution cookies.

Consented `_fbc` and `_fbp` cookies persist across page navigation, including when the pixel script is blocked. A new ad click updates `_fbc`; ordinary navigation preserves the original click timestamp. Cookies are secure, first-party, and expire after 90 days.

The server accepts only the four named commerce events, approved website origins and commerce paths, bounded numeric ecommerce parameters, recent event times, and valid event IDs. It strips query strings and arbitrary text/customer fields. Request headers supply IP and user agent. Logged-in identity comes from authenticated Base44 user data and is hashed with the existing Purchase normalizer; anonymous visitors use available browser/request attribution. No address or country is guessed for visitors.

Delivery logs contain event ID, event name, mode, outcome, and a fixed reason only. No token, raw contact details, browser IDs, IP address, or full payload is logged. The endpoint cannot emit Purchase. It uses the existing customer gateway, so no new top-level function or entity is required.

Deduplication uses the same event name and event ID in browser and server payloads. Local concurrent requests are coalesced; accepted IDs are cached for ten minutes. Across workers/restarts, Meta remains responsible for deduplication. Request limits are per runtime instance (60/minute per request IP and 600/minute total); they are not a distributed abuse-prevention service. Browser-declared cart values are diagnostic, not authoritative revenue.

## Changed Files

- `src/lib/metaPixel.js`: shared event IDs, independent server dispatch, cookie persistence, consent checks, bounded pixel loading.
- `src/lib/metaFunnelTransport.js`: existing gateway transport, keepalive, timeout, consent cancellation.
- `base44/functions/getCustomerAccountDashboardData/entry.ts`: route the new handler.
- `base44/functions/getCustomerAccountDashboardData/handlers/trackMetaFunnelEvent/entry.ts`: authenticated user lookup adapter.
- `base44/functions/getCustomerAccountDashboardData/handlers/trackMetaFunnelEvent/handler.js`: validate and deliver the allowed funnel events.
- `base44/shared/metaIdentity.js`: mechanically extracted identity normalization and hashing shared by Purchase and funnel handlers, in Base44's supported shared packaging directory.
- `base44/functions/stripeWebhook/metaConversions.js`: import the shared identity helper; Purchase behavior unchanged.
- `scripts/migration/run-g138-meta-capi-purchase-tests.mjs`: include the extracted shared source in existing source assertions.
- `scripts/migration/run-meta-funnel-capi-tests.mjs`: runtime tests using synthetic requests and a fake provider.
- `scripts/ci/run-critical-regressions.mjs`: run the new harness in CI.
- This release document.

## Verification Completed

- New runtime tests: matching browser/server IDs, consent denial and withdrawal, blocked pixel fallback, attribution persistence, guest and authenticated identity, payload rejection, test/live isolation, duplicate/concurrent delivery, retry after rejection, transport failure, rate limits, and native/local-preview exclusions.
- Existing Meta Purchase, catalog, registration, Google Measurement Protocol, and growth-measurement tests passed in the full critical regression run (105 suites).
- ESLint and TypeScript checks passed.
- Deno check passed for the new handler entrypoint.
- Static import-graph regression verifies that the gateway depends only on its own packaged subtree and `base44/shared`, never a sibling function.
- Production frontend build succeeded with the canonical app ID and URL explicitly configured. Built output contains the correct app and pixel IDs and no forbidden app ID.
- Secret scan passed, including the new files after marking them intent-to-add locally.
- No live provider events, real orders, ad changes, or publishing were performed by the tests.

## Live Evidence and Remaining Limits

Meta Events Manager was inspected in Safari for dataset `719023677458304`, August 9 through September 5, 2026. The overview showed PageView (177), View content (46), Search (5), Add to cart (4), and Initiate checkout (2). No Purchase row was visible. Screenshot: `/tmp/nuvira-meta-events-receipt-20260906.png`.

Google Ads was inspected in the NuVira Juice Co. account (`ocid=8498621021`). The conversion action `NuVira Juice Co. - GA4 (web) purchase` was Primary, included in account-level goals, counted Every conversion, and used a 90-day click window. The displayed August 26 through September 5 range showed `No recent conversions`, 0.00 conversions, and 0.00 value. This does not establish that GA4 received no purchases, or that tracking is broken; Google Ads reports eligible attributed conversions. Screenshot: `/tmp/nuvira-google-conversions-receipt-20260906.png`.

The prior Purchase sandbox was accepted as a server event, but that is not proof of a real customer purchase being received, matched, or attributed to an ad. Receipt, event match quality, deduplication, and ad attribution are separate checks. This patch does not change the current Traffic/landing-page-view campaign into a Sales/Purchase campaign.

Subscription Purchase coverage remains a separate gap. `invoice.payment_succeeded` and `invoice.paid` use subscription activation paths without the one-time Purchase sender. Before advertising subscription acquisition, capture consent/attribution in the subscription checkout and deduplicate both invoice event types against one invoice/payment identity. Separate first payments from renewals. Offline/POS imports are also outside this update.

## Coordinated Release Sequence

1. Explicit coordinated approval received. `origin/main` was refreshed and still matched the stated base. A read-only copy of the deployed gateway was pulled into `/tmp/nuvira-meta-funnel-release-backup-20260906` before deployment. The deployed gateway predates canonical G172 guest-purchase-claim validation; the release preserves that existing canonical protection.
2. Verify the selected Base44 project ID immediately before any publication. Use the existing server-only `META_CONVERSIONS_API_TOKEN`; never put it in frontend variables, command output, or a source file.
3. Publish the customer gateway with the new handler and its imported helper, initially with `META_CAPI_FUNNEL_MODE` unset/disabled. There is no need to republish the Stripe webhook for this helper export alone.
4. Set server-only `META_CAPI_FUNNEL_MODE=test` and the existing `META_CONVERSIONS_API_TEST_EVENT_CODE` for the exact NuVira dataset. `test` mode sends these funnel events to Test Events. An unset/unknown mode disables the relay. The existing Purchase gate is independent.
5. Publish the matching frontend from the approved canonical revision. Verify the actual served bundle includes the new transport and retains the current growth/Google/Meta functionality.
6. With Ad insights consent granted, perform one controlled product view, cart addition, checkout start, and payment-info entry. Confirm the server event for each appears in Meta Test Events. Compare its event ID with the browser request and confirm deduplication after processing. Do not claim live server receipt from local tests.
7. Verify no funnel requests are delivered without consent, after withdrawal, from native runtime, or from local previews. Confirm slow/rejected tracking does not affect checkout.
8. Set `META_CAPI_FUNNEL_MODE=live` after acceptance checks. Confirm server logs report accepted production funnel events without a test code; check Events Manager diagnostics and deduplication as reporting catches up.
9. Reconcile the next legitimate consented paid order against Stripe, the Meta Purchase delivery log, Meta Events Manager, and GA4 transaction ID/value/currency. Google Ads attribution additionally requires an eligible Google ad interaction and processing time. Do not generate a fake production sale to manufacture verification.

Rollback: disable `META_CAPI_FUNNEL_MODE`. Existing browser events and the separate server Purchase integration continue. Any frontend rollback must use an approved canonical build that preserves the current growth and Purchase code, not a stale temporary-app bundle.
