# G50D Controlled Native Startup Hotfix Release

## Source baseline

```text
main_commit=90d0104f65e764a04b69533bda2560e6dc9bdeb9
source_branch=origin/main
release_branch=codex/g50d-controlled-native-release
git_status_clean_at_worktree_create=true
head_matches_origin_main_at_worktree_create=true
canonical_release_source_ci_gate_live=true
dependency_release_risk_gate_passed=true
g50d_native_release_planning_allowed=true
replacement_release_reason=build_22_testflight_startup_recovery_regression
```

G50D starts from the exact reviewed main commit that merged PR #570. The existing website checkout remains the fallback until the new native build passes TestFlight smoke and is manually released.

## Release metadata baseline

Safe values only:

```text
current_main_marketing_version=2.117906.0
current_main_build_number=21
app_store_current_version=2.117906.0
app_store_current_build=21
highest_processed_build_number=22
latest_testflight_build=2.117907.0_22_do_not_submit
failed_testflight_build_number=22
bundle_identifier=com.base69d48d0c39891f7945481152.app
signing_release_configuration=Release
proposed_marketing_version=2.117907.0
proposed_build_number=23
```

Apple's public lookup endpoint confirmed `app_store_current_version=2.117906.0` on 2026-06-23. Build `2.117907.0 (22)` was uploaded to TestFlight, processed, installed on a real iPhone, and held because startup landed on App Recovery. Build `23` is the replacement build for the same marketing version. Before archive or upload, App Store Connect must confirm that build `23` does not already exist; otherwise this release must stop and bump again before archiving.

No signing identities, team ids, API keys, certificates, or provisioning profiles are recorded in this document.

## Metadata PR scope

Allowed changes:

- `ios/App/App.xcodeproj/project.pbxproj`
- `docs/migration/g50d-controlled-native-startup-hotfix-release.md`
- `scripts/migration/run-g50d-controlled-native-release-tests.mjs`

Explicitly out of scope:

- `src/`
- `base44/`
- `package.json`
- `package-lock.json`
- `capacitor.config.json`
- checkout or payment semantics
- dependencies
- Hub/provider code
- Base44 or Builder publish

## Included runtime fixes

G50D build 23 adds one focused runtime repair on top of the already merged startup hotfix release metadata:

- G50B startup hotfix from current main: stable recovery screen, `Try Again`, `Return Home`, `Reset Sign-In`, `reset_sign_in`, bounded hosted logout timeout, no render-time `/account-setup` hard redirect, no automatic storage-clear/reload loop.
- Capacitor appUrlOpen listener compatibility repair: supports both synchronous listener handles and Promise-returning listener registration so native startup cannot crash on `.then is not a function`.
- G49A checkout processing protection from current main: `PAYMENT_ATTEMPT_STATE_UNKNOWN`, "Still checking your checkout" copy, ambiguous checkout-state handling, and no unsafe client-secret or PaymentIntent logging.
- G50C release-source and native release gates.
- G50C-SEC2 lockfile remediation with critical and high dependency vulnerabilities cleared.

## Security and release-gate result

Required pre-release security state:

```text
critical_vulnerabilities=0
high_vulnerabilities=0
moderate_vulnerabilities=2
g50d_triage_required=false
moderate_quill_react_quill_followup=https://github.com/NuViraJuiceCo/nuvira-juice/issues/571
```

The two remaining moderate findings are the tracked `quill` and `react-quill` rich-text editor dependency debt. They are not a G50D release blocker under the accepted SEC2 gate, but they remain visible follow-up work.

## Required post-merge manifest

After this metadata PR merges, the manual Native Release Gate must be dispatched against the exact metadata merge commit. The release manifest must match:

```text
git_commit=<metadata_merge_commit>
origin_main_commit=<metadata_merge_commit>
marketing_version=2.117907.0
build_number=23
critical=0
high=0
g50d_triage_required=false
web_native_bundle_parity=true
release_archive_created=false
app_store_upload_performed=false
```

Any mismatch is a hard stop. No archive or upload may happen before this manifest passes.

## TestFlight matrix

Real-device TestFlight smoke must cover:

- upgrade install over the current App Store build;
- clean install;
- signed-out launch;
- signed-in complete-profile launch;
- signed-in incomplete-profile routing;
- normal network;
- slow network;
- temporary offline launch and reconnect;
- background/resume after network loss;
- force close/reopen;
- email sign-in;
- approved provider callback path;
- logout;
- Reset Sign-In;
- Try Again and Return Home recovery paths;
- checkout page load, validation, existing card, and Express Checkout presentation.

Do not initialize or submit a real payment for release smoke without separate explicit approval.

Acceptance requires:

```text
upgrade_install_passed=true
clean_install_passed=true
signed_out_startup_passed=true
complete_profile_startup_passed=true
incomplete_profile_routing_passed=true
slow_network_passed=true
offline_recovery_passed=true
background_resume_passed=true
force_close_reopen_passed=true
auth_callback_passed=true
reset_sign_in_passed=true
checkout_page_load_passed=true
duplicate_reload_loop_detected=false
unexpected_logout_detected=false
startup_crash_detected=false
```

Classification after a clean TestFlight smoke:

```text
native_startup_hotfix_testflight_smoke_passed
```

Any startup, login, routing, or checkout regression is:

```text
hard_stop_native_startup_hotfix_testflight_regression
```

## App Store release hold

Do not submit to App Review until TestFlight smoke passes. When submitted, attach the exact tested build and use manual release only:

```text
app_review_build_matches_testflight=true
manual_release_enabled=true
automatic_release_enabled=false
```

Do not release after approval until the approved build matches the tested build, the release manifest matches, website fallback is operational, and no new critical-path PR has appeared.

## Rollback and fallback

The website checkout remains the immediate customer fallback through the observation window. If TestFlight or post-release smoke finds a startup, auth, routing, or checkout regression:

1. Stop release progression.
2. Keep App Store manual release held, or halt phased/manual release if already live.
3. Direct customers to website checkout.
4. Use the last approved App Store build as the native fallback.
5. Open a focused rollback or fix-forward PR from current main.
6. Regenerate CI evidence and a Native Release Gate manifest before any replacement archive.

## No-payment / no-write confirmation

This metadata phase does not:

- submit payment;
- create a Stripe PaymentIntent;
- create a Checkout Session;
- create or mutate Order, ShopifyOrder, FulfillmentTask, Hub, provider, route, inventory, notification, or Base44 records;
- publish Base44 or Builder;
- archive;
- upload to TestFlight or App Store;
- submit to App Review;
- release to App Store customers.

## Classification

```text
native_startup_hotfix_build23_replacement_ready
```
