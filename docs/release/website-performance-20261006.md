# Public website performance repair — October 6, 2026

Status: isolated implementation and local verification; not published. V3 remains separate.

Final local checks: 170/170 regression harnesses, zero lint/typecheck diagnostics, zero new audit fingerprints, secret scan and build passed. Existing audit findings remain 13 high-severity packages, no critical findings; existing review policy is unchanged. Final site: 47,281,817 bytes across 381 files.

PR #808 initially failed in shared CI because main had independently advanced to `bdbd0b4` (Base44's automated SDK update back to `^0.8.53`). Main was incorporated while restoring the already owner-approved exact 0.8.52 manifest/lock entries. This preserves the original tested runtime; it does not disable the SDK consent guard or introduce a new dependency decision. No automation permissions were changed. Recheck main and exact dependency parity again immediately before any publication.

## Source and scope

Base: `d4b8af7b0b133912102542e65e5c26945b632d4c`, the published desktop website and SDK-preservation release. Branch: `codex/website-performance-20261006`.

This is a deliberate website behavior patch, not another presentation-only change. The earlier desktop structural snapshot remains unchanged and is not relaxed to approve these changes. No dependency, image, backend, auth-verification, checkout/payment, inventory, price, native distribution, or V3 configuration changes are included.

## Confirmed observations, not assumed causality

In the owner's Chrome on this Mac, a normal `/shop` reload spent 4.84 seconds waiting for the HTML server response (4.85 seconds total); document ready/load were 4.92/4.97 seconds. Public product requests varied from 1.16 to 3.94 seconds. One multiplexed customer-gateway response spent 23.01 seconds waiting for the server. Its action was not inspected, so this is not proof that an account-dashboard action, or that request alone, blocked Shop.

Independent anonymous HTTP samples also showed variable HTML response times on both public domains. No equivalent pre-desktop-release timing sample exists. Source review did not find new auth/query/startup behavior in the desktop layout changes. These facts do not prove either that the desktop release caused all latency or that all slowness is local to this Mac.

## Changes

1. Public website Home/Shop share a complete 100-product read contract, isolated from incompatible legacy query entries. Fresh reads are reused for two minutes; stale mounts, explicit refresh and existing prefix invalidations still refetch. Banner/bundle reads use the same website-only freshness policy. Cache remains in the existing principal-scoped, in-memory QueryClient; no cross-user or persistent cache is added. Native Home50/Shop100 and native/global always-refetch behavior are retained. Checkout's authoritative validation is unchanged.
2. Pending public route code uses a content-area Suspense fallback, leaving desktop/mobile navigation present. Native, protected, unknown, admin and captured OAuth-return startup states retain the outer fallback and existing auth gates.
3. Desktop customer navigation preloads code only on hover/focus for Home, Shop, About, Contact and Support. Explicit native/admin exclusions, a two-import concurrency bound, five-route retention bound and retryable failures prevent eager whole-app loading. No query hook is mounted or provider read initiated by the preloader itself.
4. Public Contact details and Support FAQs can appear while startup checks run. Forms remain disabled until auth/settings and any signed-in onboarding redirect settle, avoiding draft loss from principal remounts. A passive observer watches the existing onboarding query and cannot issue an extra request. Anonymous forms enable after startup settles; failed unconfirmed signed-in profile checks keep the form held with guidance, while public contact details remain available. Submission payloads and handlers are unchanged.

## Controlled browser comparison

Real production builds were served on loopback-only ports 4198/4199 with identical historical catalog fixtures. All writes/functions/protected reads were denied; CSP blocked external connections. Synthetic response delays were 3 seconds for selected route chunks, 1.2 seconds for public reads and 4 seconds for the anonymous session check. No live forms, payments, orders or customer records were touched.

On the initial Home → Shop → Home → Shop sequence within the freshness window:

| Public requests | Published baseline | Candidate |
| --- | ---: | ---: |
| Product | 4 | 1 |
| Banner | 2 | 1 |
| SubscriptionBundle | 2 | 1 |
| Total | 8 | 3 |

This verifies 5 avoided public reads in that controlled sequence (62.5% fewer), not a 62.5% real-world speed increase. The query tests separately verify stale/manual refresh and identity boundaries. Cold browser captures show the baseline full-screen startup state versus the candidate's retained navigation and inline loading status. The intermediate comparison build preceded the final form/captured-callback refinements; final candidate smoke checks are recorded separately in workspace evidence.

## Verification and release boundary

Four new regression harnesses cover catalog freshness, public route fallback, bounded navigation preloading and startup-safe inquiry forms. Existing startup tests now cover Contact/Support plus native/callback/protected exclusions. They are registered in the critical-regression runner.

Workspace evidence is under `outputs/desktop-layout-20261005/`: `performance-investigation-20261006.json`, `performance-critical.json`, `performance-diagnostics.json`, `performance-baseline-loading.png`, `performance-candidate-loading.png` and final candidate screenshots/build receipts.

Provider/server response delay remains unresolved by this frontend patch. After an approved website-only publication, remeasure cold HTML, public data, route transitions and authenticated operations in Chrome/Safari and on a phone. Investigate the exact slow gateway action through provider logs before proposing a separate backend change; do not deploy the unreleased function estate incidentally.

Local fixture measurements are not production Core Web Vitals, Google ranking evidence, a live payment test or proof that every system is fast. No live release, source merge, native distribution or provider support message is authorized by this document.

## Reproduce

```sh
DISABLE_BASE44_VITE_PLUGIN=true npm run build
npm run ci:critical-regressions
npm run ci:diagnostic-baseline
npm run ci:secret-scan
node scripts/qa/serve-desktop-preview.mjs
```

Keep the prior approved build and exact source provenance for rollback. Publish only the approved website bundle after action-time owner approval and required checks.
