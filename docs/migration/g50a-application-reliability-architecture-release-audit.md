# G50A — full application reliability, UX, architecture, and release audit

## Scope and status

Classification: `application_reliability_release_control_audit_pr_ready`

This is a static audit phase. It intentionally does **not** change runtime code, schemas, Base44 functions, Builder/UI publish state, provider configuration, Stripe behavior, Hub behavior, native records, customer records, orders, delivery records, or notifications.

Repository base audited: `origin/main` at commit `620d42ca827f493d7bbe72fe2813ca591a47c49d`.

## Executive root cause

The immediate customer-impacting failure is not an isolated iOS rendering bug. It is a release-control failure combined with fragile startup architecture.

The startup fix exists in PR #332 (`https://github.com/NuViraJuiceCo/nuvira-juice/pull/332`), but that PR is still open, draft, and unmerged. PR #332 changes only:

- `ios/App/App.xcodeproj/project.pbxproj`
- `src/App.jsx`
- `src/components/AppErrorBoundary.jsx`
- `src/lib/AuthContext.jsx`

Its logical fixes remove render-time hard navigation, automatic error-boundary reload, and native auth hard replacement. Later native release work was generated from current `main`, where the broken startup behavior still exists. That allowed a branch-specific fix to be overwritten by a later canonical-source release.

The deeper system root causes are:

1. Native releases are not constrained to a clean, merged, reviewed source-of-truth commit with an attached release manifest.
2. Startup/auth/profile/onboarding/routing/error recovery are interleaved in one fragile shell instead of one explicit bootstrap state machine.
3. Checkout still crosses a non-atomic payment/order boundary in Base44, so ambiguous retry and duplicate prevention cannot be treated as fully solved.
4. Customer/admin UI, backend read models, Hub fallback, and release practices evolved by patch accretion rather than by a small set of durable contracts.

## Current architecture map

### App shell

- `src/main.jsx` mounts `<App />` directly without top-level strict-mode/test instrumentation.
- `src/App.jsx` imports nearly every customer and admin page statically, owns the router, owns auth/onboarding gating, and contains an inline `ProtectedRoute`.
- `src/components/AppErrorBoundary.jsx` is global and currently performs automatic recovery behavior that can clear Base44/session storage and hard reload.
- `src/lib/AuthContext.jsx` owns Base44 auth checks, public settings, native callback handling, focus/pageshow/visibility refreshes, and an independent onboarding helper.

### Customer layout

- `src/components/layout/AppLayout.jsx` permanently mounts Home, Shop, and Cart and toggles visibility with CSS. This preserves tab state, but also keeps background page effects and data dependencies alive.

### Native shell

- `capacitor.config.json` uses `webDir: "dist"` and has no runtime `server.url`. The iOS app bundles the built web app. Web fixes and native fixes therefore diverge until a clean build, sync, archive, upload, approval, and device smoke occur.
- `ios/App/App.xcodeproj/project.pbxproj` currently identifies version `2.117906.0` and build `21`.

### Base44 client and data access

- `src/api/base44Client.js` uses the Base44 SDK with `requiresAuth:false`; route/function-level auth is therefore handled by app logic and backend function policies, not by one universal client guard.
- Pages still directly call entities and functions. There is no central data-access/read-model layer for customer state, checkout state, or admin state.

### Checkout path

- `src/pages/Checkout.jsx` creates a stable client idempotency key, calls `createPaymentIntent`, and then mounts payment UI from the returned Stripe mount credential.
- `base44/functions/createPaymentIntent/entry.ts` creates a Stripe PaymentIntent, attempts to dedupe pending Orders by filtering existing Orders for the PaymentIntent id, pre-creates a pending Customer App Order, then writes CheckoutSession compatibility data.
- `base44/functions/stripeWebhook/entry.ts` creates paid one-time Orders after Stripe success, with filter-then-create idempotency by session id.
- Stripe-level idempotency exists, but Base44 Order creation remains filter-then-create and is not an atomic reservation.

### Hub/native migration state

- Hub fallback remains active in customer order surfaces, subscriptions, refunds/payments, and multi-delivery scenarios.
- Customer order history and tracker have exact native-enrichment allowlists only.
- Production, delivery, admin-order, and calendar surfaces have several native/read-model phases, but write command migration remains separately gated.
- Production Apple Pay payment confirmation remains blocked by the documented Base44 atomicity gap.

## Source evidence summary

| Area | Evidence |
| --- | --- |
| Release source failure | PR #332 is open/draft/unmerged and contains the startup fix logic, while current `main` still contains the startup hard behaviors. |
| Render-time hard redirect | `src/App.jsx:168-171` calls `window.location.replace('/account-setup')` during render. |
| Generic auth-only route guard | `src/App.jsx:79-94` checks only that `user` exists; `src/App.jsx:209-228` applies it to admin routes. |
| Onboarding lookup by mutable email | `src/App.jsx:128-138` filters `UserProfile` by `customer_email` and uses `profiles[0]`. |
| Startup blocks on profile/public/auth | `src/App.jsx:147-153` renders a global spinner while public settings, auth, or profile loading is in progress. |
| Error boundary clears app/session state | `src/components/AppErrorBoundary.jsx:26-56` removes recovery keys and all `base44_` keys from browser storage. |
| Error boundary hard reload loop risk | `src/components/AppErrorBoundary.jsx:66-73` uses hard navigation/reload; `src/components/AppErrorBoundary.jsx:86-120` schedules automatic recovery after a crash. |
| Auth timeout becomes public session | `src/lib/AuthContext.jsx:49-70` treats timeout as unauthenticated/public rather than timeout/offline/unknown. |
| Native auth callback hard replace | `src/lib/AuthContext.jsx:101-116` handles native callback and hard replaces to the return route. |
| Auth refresh fan-out | `src/lib/AuthContext.jsx:136-152` wires focus, pageshow, and visibility events to `checkAppState` without a durable single-flight state machine. |
| Inconsistent onboarding rule | `src/lib/AuthContext.jsx:154-159` uses first/last name while `src/App.jsx` uses profile `onboarding_complete`. |
| Checkout recovery contradiction | `src/pages/Checkout.jsx:70-114` removes `nuvira_pending_checkout_session` before the next effect tries to read it. |
| Checkout PaymentIntent call | `src/pages/Checkout.jsx:560-760` invokes `createPaymentIntent` and handles ambiguous failure state. |
| Checkout button state | `src/pages/Checkout.jsx:1100-1118` labels/disables the checkout button but cannot make backend order creation atomic. |
| PaymentIntent/order non-atomic boundary | `base44/functions/createPaymentIntent/entry.ts:443-557` creates Stripe PI and pending Order with filter-then-create dedupe. |
| Webhook non-atomic boundary | `base44/functions/stripeWebhook/entry.ts:757-775` filters existing Orders, then `:849-898` creates an Order. |
| Always-mounted tabs | `src/components/layout/AppLayout.jsx:23-26` always mounts Home, Shop, and Cart. |
| Warnings hidden | `vite.config.js:6-8` sets `logLevel: 'error'`, globally suppressing warnings. |
| Native bundles local web build | `capacitor.config.json:1-9` sets `webDir: "dist"` with no runtime server URL. |
| No standard test command | `package.json` has build/lint/typecheck/capacitor scripts but no canonical test script. |

## P0 defect registry

| ID | Defect | Impact | Required direction |
| --- | --- | --- | --- |
| G50A-P0-001 | Native release source of truth failure: PR #332 fix stayed unmerged and was overwritten by a release from current `main`. | Regressions can reappear even after being fixed once. | Enforce release manifest, merged clean commit, included/excluded critical PR list, and physical device upgrade smoke. |
| G50A-P0-002 | Render-time account setup hard redirect. | Startup reload/flicker loop risk, especially in Capacitor. | Move to React Router navigation in an effect; add regression test. |
| G50A-P0-003 | Error boundary auto-clears Base44/session storage and hard reloads. | Can erase session context and repeat the same crash. | Stable recovery screen, no automatic reload, explicit reset only. |
| G50A-P0-004 | Auth timeout treated as public unauthenticated state. | False logout/public routing on slow network. | Bootstrap state machine with timeout/offline/unknown/authenticated states. |
| G50A-P0-005 | Native auth callback uses hard `window.location.replace`. | Native callback can reload the whole bundled app. | History replacement/popstate through router; fallback only if router unavailable. |
| G50A-P0-006 | Focus/pageshow/visibility auth checks lack a central single-flight state machine. | Races, stale results, flicker, redundant network calls. | Single in-flight auth/bootstrap controller with cancellation/staleness protection. |
| G50A-P0-007 | Onboarding identity is inconsistent and email-based. | Wrong profile or route can be selected; startup blocks on fragile lookup. | Immutable authenticated user/profile key and one canonical onboarding rule. |
| G50A-P0-008 | Admin frontend routes are protected only by generic user presence. | Customer sessions can load admin shells and issue doomed admin requests. | Add frontend `AdminRoute`; keep backend auth authoritative. |
| G50A-P0-009 | Checkout deletes pending-session recovery state before reading it. | Ambiguous checkout failures are harder to recover or diagnose. | Dedicated checkout-attempt controller with explicit state transitions. |
| G50A-P0-010 | `createPaymentIntent` still has non-atomic pending Order creation. | Duplicate Order risk under concurrent retries remains. | Atomic reservation primitive or safer architecture; keep Apple Pay confirmation blocked. |
| G50A-P0-011 | Stripe webhook Order creation also uses filter-then-create. | Duplicate Order risk under concurrent webhook/retry edge cases. | Idempotent event/order contract backed by atomic uniqueness when available. |
| G50A-P0-012 | Production client observability is inadequate. | Customer incidents arrive as screenshots instead of actionable traces. | Safe client incident layer with version/build/route/stage/error class and no PII/secrets. |
| G50A-P0-013 | No enforceable native release gate. | App Store builds can be generated from wrong source or auto-release before smoke. | Release checklist plus CI/tooling that blocks dirty/unmerged builds. |
| G50A-P0-014 | No canonical automated test command/CI baseline. | Regressions can hide behind manual harnesses. | Establish PR CI, startup tests, checkout tests, and native smoke gates. |

## P1 defect registry

| ID | Defect | Impact | Required direction |
| --- | --- | --- | --- |
| G50A-P1-001 | `App.jsx` statically imports nearly every route. | Large startup bundle and broad blast radius. | Route-level lazy loading and shells. |
| G50A-P1-002 | Home/Shop/Cart are permanently mounted. | Background effects, memory usage, stale state, unexpected queries. | Controlled tab persistence, not always-on page components. |
| G50A-P1-003 | Vite warning suppression. | Build warnings can be missed. | Make warnings visible in CI with an explicit allowlist. |
| G50A-P1-004 | Browser storage holds business/recovery state. | State can be stale, cleared, duplicated, or inconsistent across native/web. | Server-owned checkout/reward/order state; storage only for harmless UI preferences. |
| G50A-P1-005 | Page-specific data reads are scattered. | Inconsistent identity, fallback, masking, loading, and error behavior. | Data-access/read-model layer with explicit contracts. |
| G50A-P1-006 | Global-only error boundary. | One page failure can take down app shell. | Route-level/page-level error boundaries. |
| G50A-P1-007 | Migration feature gates/allowlists are numerous and operationally fragile. | Hard to know what is truly live. | Central release/config registry and status dashboard. |
| G50A-P1-008 | Admin/customer shells are not separated. | Customer app carries admin code and failure modes. | Separate admin shell, lazy-loaded admin bundle, explicit role gate. |
| G50A-P1-009 | Dependency and SDK version drift is not tied to release risk. | SDK transport/platform changes can break admin pages or native builds unexpectedly. | Dependency update runbook with transport/size smoke. |
| G50A-P1-010 | Native/web parity is manual. | Web can be fixed while iOS remains stale. | Bundle hash and release parity checks. |

## UX and accessibility defect matrix

| Surface | Current risk | User impact | Stabilization requirement |
| --- | --- | --- | --- |
| App startup | Hard redirects, global spinners, auth timeout ambiguity. | Blank screen, flicker, app loop, false logout. | Explicit bootstrap states, stable loading copy, no render-time navigation. |
| Native auth | Callback hard replacement and event fan-out. | User can be returned to a reloaded or stale route. | Router-native callback handling with one state machine. |
| Account setup | Profile lookup by email plus render-time redirect. | Customers can loop or land in wrong setup state. | Canonical profile identity and route effect. |
| Checkout | Ambiguous processing state, non-atomic backend boundary. | Customer sees stuck processing or duplicate-risk stop. | Attempt controller, server reservation, exact retry policy. |
| Order history/tracker | Exact allowlists and Hub fallback. | Partial native enrichment only; safe but incomplete. | Keep fallback until generalized eligibility is proven. |
| Admin pages | Generic route guard; SDK transport/large payload risk. | Admin page can fail at runtime or issue unauthorized calls. | Admin shell, compact contracts, backend auth. |
| Delivery/production | Read models improving, write paths separately held. | Staff may see mixed old/new signals. | Canonical read models plus explicit command readiness. |
| Safe area/mobile layout | Recently patched but depends on release parity. | Native app can lag web safe-area fixes. | Native upgrade-install smoke and screenshot evidence. |

Accessibility-specific requirements for stabilization:

- No spinner-only indefinite states; every long operation needs user-facing copy and timeout/next action.
- Navigation controls must remain router-stable and screen-reader predictable.
- Checkout error states must be readable and actionable without repeated taps.
- Admin-only diagnostics must stay out of customer payloads and UI.
- Native safe-area behavior must be tested on an installed build, not inferred from web.

## Native/web divergence matrix

| Item | Web behavior | Native iOS behavior | Risk | Required gate |
| --- | --- | --- | --- | --- |
| Bundle source | Served/published web app can update immediately. | Capacitor bundles `dist` into the iOS archive. | Web fix can be live while installed app remains stale. | Bundle hash and commit manifest for both. |
| Runtime server | Hosted web origin. | No `server.url`; local bundled web assets. | Native cannot receive web-only fixes until new build. | `npm run build && npx cap sync ios` from clean commit. |
| Auth callback | Browser navigation can tolerate reload better. | WKWebView hard reload can restart app shell. | Native startup/recovery loop. | Native callback smoke on physical device. |
| Error recovery | Browser reload may recover. | App reload can preserve broken native session state. | Persistent app loop. | No automatic reload recovery. |
| Release | Builder/web publish. | App Store review/release plus user install/update. | Release timing mismatch. | Manual smoke before broad release. |

## Backend, Hub, and source-of-truth matrix

| Domain | Current source/fallback posture | Preserve temporarily | Replace/rebuild direction |
| --- | --- | --- | --- |
| Checkout payment | Stripe is payment authority; Base44 creates PI, pending Order, CheckoutSession; webhook finalizes paid Order. | Existing card checkout and Hub fallback. | Atomic checkout reservation or webhook-only Order creation after platform decision. |
| Apple Pay | Side-effect-free diagnostic is live; production payment confirmation blocked by Base44 atomicity gap. | Diagnostic endpoint and existing card path. | Do not activate until atomic reservation contract exists or owner separately accepts risk. |
| Customer order history | Customer App Order canonical; limited native enrichment allowlist only. | Hub/payment/subscription fallback. | Automatic eligibility only after complete source coverage and ownership filtering. |
| Customer tracker | Customer App Order canonical; one exact tracker allowlist. | Hub fallback for unsupported/risky rows. | Generalize only after history migration proves stable and exact task identity exists. |
| Refunds/payments | Hub/payment source-of-truth. | Yes. | Move only with payment-state reconciliation and refund authority design. |
| Subscriptions/multi-delivery | Hub source-of-truth; native parents/occurrence chain incomplete. | Yes. | Future occurrence chain: Subscription parent -> occurrence -> Customer App Order -> native ShopifyOrder -> FulfillmentTask. |
| Production/admin read models | Native/read-model work is underway. | Hub fallback until backend-authoritative contracts are deployed and disabled/activated safely. | Shared canonical read models per domain, no page-specific matching. |
| Delivery lifecycle | `getAdminDeliveryRouteSummary` owns canonical read model after G48D. | Existing action functions/write paths. | Read readiness must remain distinct from command readiness. |
| Rewards | Limited native-first work exists but should remain gated until account/reward source-of-truth is clear. | Hub/source fallback where configured. | Consolidate into one server-owned reward ledger/read model. |
| Events | Hub -> Customer App Event sync re-enabled for public display. | Public read-only Event display. | Keep event sync isolated from order/payment/delivery migration. |

## Repeated blockers and shared architectural root causes

| Repeated blocker | Shared root cause |
| --- | --- |
| Startup fixes lost across native releases | No release manifest or merged-source enforcement. |
| Checkout duplicate/ambiguous state | No Base44 atomic uniqueness/reservation primitive and UI creates backend side effects before payment UI is stable. |
| Customer order migration proceeds by exact allowlists | No complete generalized identity/ownership/readiness contract across Order, ShopifyOrder, FulfillmentTask, Hub, payment, and subscription state. |
| Admin transport failures | Large monolithic payloads and SDK transport limits without compact contracts. |
| Hub fallback remains broad | Several domains lack deterministic native identity and source-of-truth ownership. |
| Many migration harnesses, few app-level tests | Migration work is well documented but not integrated into a standard app CI/test release gate. |

## What to preserve versus replace

### Preserve temporarily

- Hub fallback for refunds/payments, subscriptions, multi-delivery, unsupported order rows, and risky migration cases.
- Existing card checkout path while Apple Pay production confirmation is blocked.
- Existing delivery/production write actions until command-readiness contracts are explicitly proven.
- Public read-only event sync/display.
- Current exact allowlists until generalized eligibility has decision-grade evidence.

### Replace rather than copy

- Render-time navigation and hard reload recovery.
- Filter-then-create idempotency for payment/order creation.
- Email-based profile/order identity matching.
- Page-level direct entity queries for cross-domain business state.
- Monolithic app/admin shell imports.
- Manual release/source tracking.
- Browser-storage business state.

### New components/data models recommended

1. `AppBootstrapController`: a single auth/profile/settings state machine.
2. `ClientIncident` read/write contract: safe client error events with app version/build/commit/route/stage, no PII/secrets.
3. `CheckoutAttempt` or platform-supported atomic `CheckoutReservation`: one deterministic reservation per cart/customer/session before payment confirmation.
4. `ReleaseManifest`: generated artifact containing git commit, app version/build, bundle hashes, included PRs, excluded open critical PRs, dirty-worktree status, smoke results.
5. `AdminRoute` and separate admin shell.
6. Central `customerOrderSurfaceReadModel` policy used by history/tracker rather than scattered page matching.
7. Central `NativeIdentityLink` or equivalent durable linkage for Customer App Order, ShopifyOrder, FulfillmentTask, subscription occurrence, delivery route/stop.

## Patch-versus-rewrite decisions

| Area | Decision | Reason |
| --- | --- | --- |
| Startup PR #332 logic | Patch immediately. | Small, known, customer-impacting regression; must be ported onto current main without stale native metadata. |
| App bootstrap/auth shell | Rewrite next. | Current shell intermixes too many states; patching each redirect/event separately will keep producing edge cases. |
| Error boundary | Patch immediately, then redesign. | Automatic reload/storage-clear is unsafe now; long-term incident/recovery UX needs a broader design. |
| Native release process | Rebuild process immediately. | A technical fix is not enough if the wrong source can ship again. |
| Checkout processing UI | Patch only for safety messages. | UI cannot solve Base44 atomicity; backend architecture decision is required. |
| Checkout payment/order creation | Rebuild after platform/owner decision. | Filter-then-create remains a TOCTOU race. |
| Customer history/tracker migration | Continue gated/incremental. | Domain has valid fallback and insufficient broad eligibility evidence. |
| Admin large payload/read models | Consolidate by domain. | Backend-authoritative compact read contracts are working better than page-specific patches. |
| Hub replacement | Do not mirror blindly. | Replace weak Hub patterns with deterministic native identities and server-owned contracts. |

## First 10 stabilization PRs in exact order

1. **G50B — startup hotfix on current main.** Port PR #332 logical changes only: React Router account-setup navigation, non-reloading error boundary, native callback history replacement. Do not port stale iOS version/build metadata. Add startup regression tests.
2. **G50C — release manifest and source gate.** Add script/check that records commit, version/build, bundle hashes, included PRs, excluded open critical PRs, dirty-worktree status, and required smoke evidence.
3. **G50D — native upgrade-install smoke gate.** Physical device upgrade over current App Store version for signed-out, signed-in, incomplete-profile, slow-network, offline, auth-callback, background/resume, and checkout-safe paths.
4. **G50E — app bootstrap/auth state machine.** Replace scattered startup logic with explicit states: `initializing`, `public`, `authenticated`, `profile_required`, `ready`, `recoverable_error`, `fatal_error`.
5. **G50F — stable error recovery and client incident reporting.** Add safe incident references, route/stage/build metadata, route-level boundaries, no PII/secrets/tokens/client secrets.
6. **G50G — checkout attempt controller.** Remove contradictory pending-session storage effects, define one attempt state, one request id, one user action, one ambiguous-state stop.
7. **G50H — checkout reservation architecture decision.** Implement Base44-supported atomic reservation if available; otherwise decide webhook-only Order creation or explicitly accepted residual risk.
8. **G50I — admin/customer shell separation.** Add `AdminRoute`, lazy admin shell, and frontend role gate while preserving backend authorization as authoritative.
9. **G50J — route-level lazy loading and page boundaries.** Split monolithic imports and always-mounted tab pages into controlled route bundles with scoped error/loading states.
10. **G50K — CI and quality gate baseline.** Add canonical test script, startup harnesses, checkout harnesses, migration regression suite selection, lint/typecheck policy, build warnings visible, and native release manifest verification.

## Exact first hotfix

**G50B must be the first hotfix.**

Required scope:

- Port the logical PR #332 changes onto current `main`.
- Replace `window.location.replace('/account-setup')` render-time redirect with React Router navigation in an effect.
- Remove automatic error-boundary reload and automatic Base44/session storage clearing.
- Keep explicit user-controlled session reset available.
- Replace native auth callback hard replacement with router/history replacement.
- Add regression tests proving those removed behaviors do not exist.
- Build and sync a clean iOS bundle from the merged commit.
- Upgrade-install test over the current App Store build, not only clean install.

Hard limits:

- Do not blindly merge PR #332 because its Xcode version/build metadata may be stale.
- Do not combine with feature work.
- Do not auto-release through App Store before physical-device smoke.

## Exact first architectural rewrite

**G50E must be the first architectural rewrite.**

Target: `AppBootstrapController` / bootstrap state machine.

Required states:

```text
initializing
public
authenticated
profile_required
ready
recoverable_error
fatal_error
```

Rules:

- No navigation during React render.
- No automatic hard reload.
- No automatic broad storage clearing.
- One in-flight auth/bootstrap request at a time.
- Distinguish unauthenticated, timeout, offline, user-not-registered, and profile-required.
- Canonical onboarding decision comes from one server-owned profile contract.
- Native auth callback updates router state without restarting the app shell.
- Splash behavior is presentation-only, not auth state.

## Dead-code and cleanup inventory

Remove only after regression tests and release gates exist:

- Automatic `AppErrorBoundary` hard reload/reopen paths.
- Blanket removal of `base44_` storage keys.
- Render-time account setup redirect.
- Native auth hard-replace callback route.
- Dead or contradictory `nuvira_pending_checkout_session` recovery paths.
- Debug storage count logging in checkout startup.
- Page-specific profile/order matching helpers that duplicate canonical server read models.
- Stale migration allowlists/flags once the owning domain is generalized or retired.
- Hidden build-warning policy in `vite.config.js`.
- Always-mounted Home/Shop/Cart once route-level state persistence is implemented safely.

## Release gate checklist

A native or production release is not releasable until all required items are true:

1. Source commit is merged to the release branch and cleanly checked out.
2. Worktree is clean before build.
3. Release manifest is generated and committed or attached.
4. Manifest includes git commit, app version, build number, web bundle hash, native bundle hash, included PRs, excluded/open critical PRs, and dirty-worktree result.
5. PR #332 logical startup fix, or its replacement, is included before any next iOS release.
6. `npm run build` passes with warnings visible or explicitly allowlisted.
7. Startup regression tests pass.
8. Checkout safe-state regression tests pass.
9. Relevant migration harnesses pass for touched domains.
10. Native `npm run build && npx cap sync ios` is run from the same source commit.
11. Physical-device upgrade install over current App Store version passes.
12. Signed-out, signed-in, incomplete-profile, slow-network, offline, native auth callback, background/resume, checkout entry, and customer fallback paths are smoked.
13. App Store release is not automatic unless post-approval smoke and rollout controls are explicitly approved.
14. Customer fallback URL is confirmed before rollout.
15. No production payment/provider/schema/write change is included without separate approval.

## Definition of done for app stabilization

The application is stable enough to resume broad feature migration when:

- Current App Store build and website are generated from the same known merged commit or have an intentional documented divergence.
- Startup has no render-time hard navigation, automatic reload loop, or automatic broad storage clearing.
- Native upgrade-install smoke passes on a physical iPhone.
- Checkout has deterministic attempt handling and no ambiguous automatic retry behavior.
- Production Apple Pay payment confirmation is either still blocked or backed by an accepted atomic/order-creation contract.
- Admin/customer routes are separated and backend auth remains authoritative.
- Release manifest and smoke evidence are mandatory for every native build.
- CI runs a standard test/build/lint gate and selected migration regressions.
- Observability can identify app version/build/commit/route/stage for customer-impacting failures without PII, secrets, client secrets, Stripe keys, or raw provider payloads.

## Hard stops

- No further feature work before G50B/G50C/G50D are complete or explicitly waived by ownership.
- No App Store archive from an unmerged branch, dirty worktree, or unknown commit.
- No automatic native release before smoke.
- No production Apple Pay payment confirmation while Base44 atomic reservation remains unavailable and risk is not separately accepted.
- No Hub write suppression or broad native cutover from scanner evidence that is incomplete, truncated, or ownership-untested.
- No customer-facing retry loops for checkout ambiguity.

## No-write confirmation

G50A is documentation/static audit only. It performs no live writes, no Order mutation, no ShopifyOrder mutation, no FulfillmentTask mutation, no Hub mutation, no provider calls, no Stripe calls, no Shopify calls, no notifications, no inventory deduction, no PurchaseOrder creation, no Base44 publish, and no Builder publish.
