# G49C Native Current-Main iOS Release Candidate

## Goal

Bring the native iOS app bundle up to the current `origin/main` app source instead of shipping only the narrow G49B checkout hotfix from an older native baseline.

This release candidate is intended to catch the installed app up with the current website/customer UI source that is live on `nuvirajuice.com`.

## Baseline and source

```text
source_branch=origin/main
source_commit=c36ca919e39b219591e9c2dabc5a299e58bad5ea
source_commit_subject=Merge pull request #562 from NuViraJuiceCo/codex/g49a-checkout-processing-error-boundary
```

Prior native upload evidence:

```text
prior_native_build_branch=codex/p0-ios-app-access-build-19
prior_native_build_commit=660a76462ac16c57806b199a6f23779cd146d83c
prior_marketing_version=2.117903.0
prior_build_number=19
```

`origin/main` contains all current merged app updates and the G49A checkout stuck-processing protection, but its native project build number was still `18`. This release candidate increments only the native build number to `20`.

## Clean release worktree

```text
worktree=/Users/nuvisionary/Documents/NuVira Juice Co./nuvira-workspace/g49c-native-current-main-ios-release
branch=codex/g49c-native-current-main-ios-release
```

The worktree was created cleanly from `origin/main`. The dirty native worktree was not used to build this candidate.

## Source delta

Tracked release-source delta:

```text
ios/App/App.xcodeproj/project.pbxproj
```

Change:

```text
CURRENT_PROJECT_VERSION=20
MARKETING_VERSION=2.117903.0
```

No checkout/payment/backend/source behavior was changed in this branch; the app source is current `origin/main`.

## Customer-facing source catch-up from build 19

Compared with the prior build-19 branch, current `origin/main` includes app/source updates across checkout, order pages, events, admin pages, delivery, account/cart/product/program pages, package updates, and the G49A checkout processing boundary.

The generated native bundle for this candidate uses the same entry asset name as the currently live website checkout bundle:

```text
/assets/index-CEd-4yzQ.js
```

## Checks

```text
npm ci=passed
G49A checkout processing boundary harness=passed 37/37
G47F PATCH1 side-effect-free Apple Pay mount harness=passed 32/32
scoped ESLint=passed
npm run build=passed
npx cap sync ios=passed
ios_simulator_build=passed
ios_archive=passed
```

Dependency audit warnings were reported by `npm ci`; no dependency changes were made in this emergency release candidate.

## Generated iOS bundle verification

Generated/copied asset:

```text
ios/App/App/public/assets/index-CEd-4yzQ.js
```

`ios/App/App/public/index.html` points to exactly one active entry asset.

Required checkout markers:

```text
PAYMENT_ATTEMPT_STATE_UNKNOWN=true
Still checking your checkout=true
We couldn’t confirm whether checkout started=true
payment_intent_created=true
order_created=true
```

Forbidden unsafe logging markers:

```text
PaymentIntent ID=false
clientSecret prefix=false
```

Capacitor configuration:

```text
webDir=dist
server.url=
ota_live_update_plugin=false
```

Because there is no OTA/live-update path, installed customer apps will not receive this update until a new native build is distributed.

## Archive verification

Local archive:

```text
/tmp/G49C-NuVira-CurrentMain-Build20.xcarchive
```

Safe archive metadata:

```text
archive_marketing_version=2.117903.0
archive_build_number=20
archive_bundle_id=com.base69d48d0c39891f7945481152.app
archive_index_asset=/assets/index-CEd-4yzQ.js
archive_entry_count=1
```

Archive marker verification matched the generated iOS bundle markers above.

No upload, export, TestFlight distribution, or App Store release was performed.

## Release gate

Do not upload or distribute without separate approval.

Required upload gate:

```text
clean_current_main_worktree=true
build_number_incremented=true
checkout_markers_present=true
unsafe_logging_markers_absent=true
npm_build_passed=true
capacitor_sync_passed=true
ios_simulator_build_passed=true
ios_archive_passed=true
```

## TestFlight smoke plan

After TestFlight/internal distribution:

1. Confirm installed app version/build is `2.117903.0 (20)`.
2. Confirm checkout page loads in the native app.
3. Confirm the app no longer uses the stale pre-G49A checkout bundle.
4. Do not submit a payment merely to prove bundle freshness.
5. A controlled checkout attempt requires separate approval and monitoring.
6. Website checkout remains the immediate fallback until native smoke passes.

## Customer guidance until distribution

> Please place the order through Safari at https://nuvirajuice.com instead of the app right now. The website checkout has been updated. Tap checkout only once. If anything gets stuck or says “Still checking,” stop and send a screenshot.

## No-payment / no-write confirmation

This phase did not:

- submit payment;
- open a customer checkout mount;
- create a Stripe PaymentIntent;
- create a Checkout Session;
- create or mutate Order, ShopifyOrder, or FulfillmentTask records;
- call Stripe, Shopify, Hub, route providers, or notifications;
- publish Base44 or Builder;
- upload to TestFlight/App Store.

## Classification

```text
native_current_main_ios_release_candidate_ready_build20
```
