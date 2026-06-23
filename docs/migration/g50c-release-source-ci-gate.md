# G50C — release-source and CI gate

## Current state

G50B merged the native startup hotfix into `main` at:

```text
5998e9c7a820759c27839b3efa37aa090a81aede
```

G50C does not archive, upload, distribute, publish Base44/Builder, or change runtime app behavior. Its purpose is to prevent a fixed startup path from disappearing in a later build because the build came from a stale branch, dirty worktree, or unreviewed source.

## Existing release-control audit

```text
pr_ci_present=false
native_ci_present=false
branch_protection_present=manual_admin_verification_required
required_checks_present=false
release_manifest_present=false
clean_source_gate_present=false
open_critical_pr_gate_present=false
web_native_bundle_parity_gate_present=false
native_simulator_gate_present=false
```

Existing diagnostic debt on clean current main after `npm ci`:

```text
lint_errors=12
lint_warnings=0
typecheck_diagnostics=838
audit_total=23
audit_low=1
audit_moderate=12
audit_high=9
audit_critical=1
```

G50C records that baseline and gates against new regressions. It does not claim lint, typecheck, or audit are clean, and it does not hide warnings permanently.

## Canonical release-source contract

Native release source must satisfy:

```text
worktree_clean=true
head_is_exact_approved_commit=true
head_reachable_from_origin_main=true
head_matches_origin_main=true
all_required_checks_passed=true
release_manifest_generated=true
unacknowledged_open_critical_prs=0
web_native_bundle_parity=true
```

A release must not be built from:

- an unmerged PR branch;
- a dirty worktree;
- an old native-shell branch;
- a detached local commit not on main;
- copied generated assets;
- a source tree containing unrelated unstaged files.

## Critical-path PR detection

`config/release/critical-paths.json` defines release-critical paths. Draft PRs are release-relevant. `scripts/release/verify-open-critical-prs.mjs` fails when an open critical PR is not either included in the release or acknowledged as excluded with a reason.

Known approved exclusions:

```text
PR #545: Apple Pay deferred-intent backend remains blocked by Base44 platform atomicity.
PR #563: stale draft native checkout release candidate from old build-19 baseline; excluded from current-main release source.
PR #331: stale iOS build-19 metadata/upload branch; excluded from current-main release source.
```

## CI workflows

G50C adds:

- `.github/workflows/quality-gate.yml`
  - visible `web-quality-gate`
  - visible `release-policy-gate`
- `.github/workflows/native-quality-gate.yml`
  - visible `native-quality-gate`
- `.github/workflows/native-release-gate.yml`
  - manual release-source verification workflow

The jobs run npm install from lockfile, critical regressions, diagnostic baseline checks, Web build, native sync, Web/native bundle parity, iOS simulator build, open critical PR checks, and safe release manifest generation.

## Critical regression suite

`scripts/ci/run-critical-regressions.mjs` runs a curated set only:

- G50B startup
- G49A checkout processing
- G47F Apple Pay diagnostic public config and side-effect-free mount
- G47B checkout/order parity
- G43B/G43C customer order surfaces
- G39D/G42B delivery
- G39J/G39L admin orders
- G35 refunds
- G36 subscriptions
- G39N operations
- G27 cutover readiness

It fails if a required harness is missing or fails. It does not indiscriminately execute every historical migration script.

## Web/native bundle parity

`scripts/release/verify-web-native-bundle-parity.mjs` verifies:

- `capacitor.config.json` uses `webDir=dist`;
- no unexpected `server.url` is present;
- `dist/index.html` and `ios/App/App/public/index.html` reference the same active assets;
- active Web/native asset hashes match after `npx cap sync ios`;
- required G49A/G50B markers are present;
- legacy startup markers are absent.

Required markers include:

```text
PAYMENT_ATTEMPT_STATE_UNKNOWN
Still checking your checkout
We couldn
NuVira hit a loading issue
Try Again
Return Home
Reset Sign-In
reset_sign_in
logout_request_timeout
```

Forbidden markers include:

```text
window.location.replace('/account-setup')
scheduleAutomaticRecovery
MAX_IMMEDIATE_RECOVERY_ATTEMPTS
native_reopen
clearNativeBootstrapState
```

## Release-source verifier

`scripts/release/verify-native-release-source.mjs` verifies clean source and fails closed. Release mode requires `HEAD` to equal the approved commit and `origin/main`.

No silent force bypass exists. Any emergency override must be a separate risk document and recorded approval.

## Release manifest

`scripts/release/generate-native-release-manifest.mjs` emits safe metadata only:

- git/source commits;
- acknowledged excluded critical PRs;
- marketing/build metadata;
- Node version;
- package-lock hash;
- Web/native index and active entry hashes;
- Capacitor config hash;
- marker and simulator-build result references;
- generated timestamp.

It excludes signing credentials, provisioning profiles, Apple credentials, Stripe keys, Base44 tokens, customer data, and private session data.

## Repository rules

After G50C merges, configure GitHub branch protection or rulesets for `main`:

- require pull request before merge;
- require the visible CI jobs added by G50C;
- require branch up to date before merge where practical;
- require conversation resolution;
- disallow force pushes;
- disallow branch deletion where practical.

Do not enable an impossible owner-only approval model. CODEOWNERS is added for critical paths as documentation and future enforcement, but a mandatory second code-owner approval should wait until an operational second reviewer exists.

## G50D contract

G50D must start from exact merged current main, generate the release manifest, intentionally increment version/build, build/archive once from verified source, upload to TestFlight internal distribution first, and smoke real-device upgrade/clean install before App Store submission.

G50D is not executed by G50C.

## No-write policy

G50C performs no runtime app behavior change, no Base44 publish, no Builder publish, no native archive, no App Store/TestFlight upload, no backend/schema change, no provider call, no checkout/payment change, no Hub mutation, and no notification.
