# G50B — native startup hotfix on current main

## Status

Classification: `native_startup_hotfix_pr_ready`

G50B ports the logical native startup fix from PR #332 onto the latest canonical `main` after G50A merged. It is intentionally narrow: startup routing, error-boundary recovery, and native auth callback routing only.

No Base44 publish, Builder publish, App Store upload, TestFlight upload, schema change, backend function change, checkout change, payment change, provider call, Hub mutation, notification, delivery command, or migration feature activation is included.

## G50A closeout

G50A PR #566 merged into `main` with merge commit `eae7ca0dd239c137626c735f72481365f4e270b4`.

G50A confirmed the root cause:

- PR #332 contains the earlier native startup fix.
- PR #332 remained open, draft, and unmerged.
- A later iOS build was generated from current `main`.
- Current `main` still contained render-time hard navigation and automatic crash/reload recovery.
- The previously fixed native bundle could therefore be overwritten by a later current-main bundle containing older startup behavior.

## Exact regression cause

Current `main` before G50B contained these startup hazards:

- `src/App.jsx` called `window.location.replace('/account-setup')` during render when onboarding appeared incomplete.
- `src/App.jsx` called login navigation directly while rendering an auth-required error branch.
- `src/components/AppErrorBoundary.jsx` automatically cleared startup/auth storage, appended recovery query parameters, hard-navigated, and reloaded after a render crash.
- `src/lib/AuthContext.jsx` used `window.location.replace(callbackResult.returnTo)` after native auth callbacks.
- `src/lib/nativeAuthRedirect.js` hard-assigned same-origin login/logout routes.

## PR #332 comparison

PR #332 changed:

- `ios/App/App.xcodeproj/project.pbxproj`
- `src/App.jsx`
- `src/components/AppErrorBoundary.jsx`
- `src/lib/AuthContext.jsx`

The iOS project changes in PR #332 are old release metadata and are intentionally excluded from G50B.

```text
pr332_behavior_ported=
- account setup hard redirect replaced with React Router navigation
- native auth callback hard replace replaced with in-app route replacement
- automatic error-boundary reload loop removed
- stable user-visible recovery fallback added

pr332_behavior_obsolete=
- old minimal recovery copy superseded by explicit Try Again, Return Home, and Reset Sign-In actions
- old callback fallback behavior superseded by shared replaceInAppRoute helper

pr332_metadata_excluded=
- ios/App/App.xcodeproj/project.pbxproj marketing version changes
- ios/App/App.xcodeproj/project.pbxproj build number changes

current_main_conflicts=
- current main had newer checkout/idempotency and migration work that was not part of PR #332
- G50B did not cherry-pick PR #332 wholesale
```

## Behavior ported

### Render-time navigation removal

`src/App.jsx` now keeps React render pure for account setup routing:

- Incomplete loaded profile and missing profile are explicitly distinguished from pending and failed profile requests.
- Profile request failure shows a stable retry screen instead of being treated as incomplete onboarding.
- Incomplete/missing profile routing uses `<Navigate to="/account-setup" replace />`.
- Auth-required login navigation is triggered from a guarded effect, not directly from render.

### Error-boundary recovery change

`src/components/AppErrorBoundary.jsx` no longer:

- schedules automatic recovery;
- clears every Base44 storage key;
- uses recovery-attempt counters;
- appends `native_reopen`;
- hard-reloads automatically;
- leaves the customer on a logo-only fallback.

The fallback now shows a stable accessible recovery card with explicit user actions:

- **Try Again**: clears only the React error-boundary state.
- **Return Home**: user-triggered in-app route replacement to `/`, with no storage clearing.
- **Reset Sign-In**: user-triggered hosted logout attempt, narrow auth/bootstrap key clearing, and one full navigation/remount to `/native-login` with safe `return_to`, `reset_sign_in`, and `clear_access_token` parameters. After the first tap, the recovery actions are disabled and the card shows `Resetting Sign-In…` so repeat taps cannot start duplicate logout/navigation attempts.

Raw exception details are not displayed to customers.

### Native auth callback change

`src/lib/nativeAuthRedirect.js` adds `replaceInAppRoute(route)` and `resetSignInAndReload(returnRoute)`:

- normalizes return routes;
- rejects external/open redirects through existing `normalizeReturnRoute` rules;
- uses `window.history.replaceState`;
- dispatches one `popstate` event so `BrowserRouter` observes the in-app navigation.

`resetSignInAndReload(returnRoute)` is reserved for explicit Reset Sign-In taps from the recovery screen. It clears only documented auth/bootstrap keys, attempts the existing hosted logout endpoint with `credentials: include`, bounds that request with a 4-second timeout, tolerates success, rejection, timeout, or hang, and then proceeds from `finally` to one full route replacement to NativeLogin so `AuthProvider` and the Base44 client remount. A full-navigation fallback is present if `location.replace()` itself is unavailable. `NativeLogin` now recognizes `reset_sign_in=1` and suppresses its normal already-authenticated auto-navigation, preventing a bounce from stale in-memory auth state.

`src/lib/AuthContext.jsx` now uses the in-app route helper for native auth callback return routing.

`src/pages/NativeLogin.jsx` preserves normal already-authenticated redirect behavior except when the explicit reset-sign-in route parameter is present.

`src/App.jsx` also recognizes the exact reset route (`/native-login` plus `reset_sign_in=1`). On that route only, it bypasses onboarding profile lookup, profile-loading wait state, profile-error UI, account-setup routing, and auth-required redirects so a stale hosted session cannot prevent NativeLogin from rendering after a best-effort logout failure.

## Loading and onboarding behavior

G50B does not rewrite the full bootstrap model. That remains G50E.

The hotfix preserves the existing public-settings/auth/profile loading surface while preventing the confirmed regression mechanisms:

- no hard reload during account setup routing;
- no account setup redirect during profile pending state;
- no account setup redirect during profile request failure;
- no onboarding/profile gate on the exact reset-sign-in route;
- no direct login navigation during render;
- no automatic crash recovery loop.

## Web/native compatibility

The same React source is used for Web and Capacitor.

G50B preserves:

- public Home access;
- `/native-login`;
- account setup routing;
- protected customer routes;
- admin route definitions;
- browser direct-link routing;
- Capacitor local bundle model with `webDir=dist` and no `server.url`.

## Generated-bundle proof

After `npm run build` and `npx cap sync ios`, the generated bundle under `ios/App/App/public/` was scanned by `scripts/migration/run-g50b-native-startup-hotfix-tests.mjs`.

Required absent legacy markers:

```text
window.location.replace('/account-setup')
scheduleAutomaticRecovery()
MAX_IMMEDIATE_RECOVERY_ATTEMPTS
native_reopen
clearNativeBootstrapState
```

Required present behavior:

```text
manual recovery copy
Return Home recovery copy
Reset Sign-In recovery copy
in-app auth callback route replacement
full-remount sign-in reset route
React Router account setup navigation
```

## Tests

New harness:

```text
scripts/migration/run-g50b-native-startup-hotfix-tests.mjs
```

G50A closeout ran and passed the G50A audit harness before this source hotfix. On this G50B branch, the G50A harness is intentionally superseded by the G50B harness because the G50A harness asserts that legacy startup defect markers still exist in source. Those markers are removed by G50B and are now forbidden by the G50B harness.

Coverage includes:

- no account setup hard redirect during render;
- incomplete profile routes through React Router;
- profile request failure does not redirect as incomplete onboarding;
- auth-required navigation does not run during render;
- navigation is guarded to avoid repeated redirects;
- global error boundary performs no automatic reload or broad storage clearing;
- Try Again, Return Home, and Reset Sign-In require user action;
- Return Home uses in-app navigation only and clears no storage;
- Reset Sign-In attempts hosted logout with a bounded timeout, clears only intended auth/bootstrap keys, preserves unrelated storage, and performs one full navigation/remount even if logout fails or hangs;
- Reset Sign-In double taps are ignored after the first tap;
- fallback is visible and accessible;
- raw exceptions are not displayed;
- native auth callback uses in-app route replacement and normalized return routes;
- NativeLogin reset cannot bounce from stale in-memory auth because reset mode suppresses its already-authenticated auto-navigation after the full remount;
- App startup gating cannot route the exact reset-sign-in path into profile loading, profile-error UI, or account setup before NativeLogin renders;
- old startup/recovery markers are absent from generated iOS bundle after sync;
- checkout/payment/backend/Hub behavior is unchanged.

## Release prerequisites

G50B is source PR prep only. After merge, do not build or release native production from anything except the merged canonical commit.

Required next gates:

- **G50C**: release-source and CI gate with release manifest, dirty-worktree check, critical-open-PR check, bundle hash/source parity, and startup marker assertions.
- **G50D**: controlled native release from exact merged G50B commit, TestFlight first, upgrade install over current App Store build, clean install, signed-in/out, complete/incomplete profile, auth callback, offline, background/resume, and recovery smoke.

## Rollback

If G50B causes a startup regression before native release:

1. Revert the G50B commit from `main`.
2. Do not archive or upload iOS from the reverted/dirty state.
3. Re-run G50A/G50B startup marker harnesses.
4. Re-plan G50B as a narrower startup-only patch.

If a native build has already been distributed, rollback requires the G50C/G50D release manifest and App Store/TestFlight rollback plan.

## No-write confirmation

G50B changes frontend startup source, one static migration harness, and documentation only.

It does not change:

- checkout/payment source;
- `createPaymentIntent`;
- Stripe webhook code;
- Base44 functions;
- entities/schemas;
- Hub/provider functions;
- admin read models;
- iOS version/build metadata;
- blocked Apple Pay PR #545.

It performs no live Order, ShopifyOrder, FulfillmentTask, Hub, provider, Stripe, Shopify, notification, sync, repair, replay, inventory, PurchaseOrder, Base44 publish, Builder publish, TestFlight upload, or App Store upload action.
