# G49B Native Checkout Clean Release Candidate

## Current status

Website checkout is patched and live. Installed iOS apps still use bundled Capacitor assets and do not receive the website bundle automatically.

Current operational guidance remains: customers who need to order immediately should use Safari at `https://nuvirajuice.com` until a new native build is distributed and smoke-tested.

## Dirty worktree risk

A previous local native build was produced from:

```text
/Users/nuvisionary/Documents/NuVira Juice Co./nuvira-workspace/native-capacitor-push-shell-worktree
```

That worktree contained unrelated unstaged changes. Because `npm run build` and `npx cap sync ios` consume the full working tree, not only committed files, that artifact is not approved for TestFlight/App Store distribution.

## Authoritative native baseline

Best available local/GitHub evidence identifies the native release baseline as:

```text
native_release_baseline_branch=codex/p0-ios-app-access-build-19
native_release_baseline_commit=660a76462ac16c57806b199a6f23779cd146d83c
native_project_present_on_baseline=true
baseline_matches_current_distributed_app=unknown
```

Evidence:

- PR #331 title: `P0: bump iOS app access fix build 19`.
- PR #331 body states an App Store Connect upload succeeded and package processing started.
- Local archive metadata is not available to independently prove the currently distributed App Store/TestFlight build.

## Source comparison

```text
main_contains_g49a_checkout_fix=true
native_baseline_contains_g49a_checkout_fix=false
main_contains_apple_pay_diagnostic=true
native_baseline_contains_apple_pay_diagnostic=false
```

`origin/main` contains the already-approved G49A checkout boundary and Apple Pay side-effect-free diagnostic component. The native release baseline does not.

## Clean release worktree

Clean worktree:

```text
/Users/nuvisionary/Documents/NuVira Juice Co./nuvira-workspace/g49b-native-checkout-clean-release
```

Branch:

```text
codex/g49b-native-checkout-clean-release
```

Created from:

```text
origin/codex/p0-ios-app-access-build-19
```

Initial status was clean before applying the release delta.

## Exact source delta

Only these tracked source files changed:

```text
src/pages/Checkout.jsx
src/components/checkout/ApplePayMountDiagnostic.jsx
```

No admin, Shopify, push, native-shell, payment backend, Hub, schema, provider, notification, production, fulfillment, or inventory changes were included.

## Checkout source verification

`src/pages/Checkout.jsx` contains:

- `PAYMENT_ATTEMPT_STATE_UNKNOWN`
- stage-aware checkout processing
- `Still checking your checkout`
- `We couldn’t confirm whether checkout started`
- explicit no-write response handling
- no automatic retry
- ambiguous-state retry lock

Unsafe logging markers are absent:

```text
PaymentIntent ID=false
clientSecret prefix=false
```

## Apple Pay diagnostic verification

`src/components/checkout/ApplePayMountDiagnostic.jsx` preserves:

- admin/owner-only diagnostic access
- `APPLE_PAY_DIAGNOSTIC_PUBLIC_CONFIG`
- no `createPaymentIntent` call
- no pending Order creation
- fail-closed confirmation behavior

## Checks

```text
npm ci=passed
G49A harness=passed 37/37
G47F PATCH1 harness=passed 32/32
G47B/G47C harnesses=not runnable on native baseline without importing unrelated backend preview files
scoped ESLint=passed
npm run build=passed
npx cap sync ios=passed
iOS simulator build=passed
iOS archive=passed
```

The G47B/G47C harnesses require newer backend preview files that are not part of the native build-19 baseline. They were not imported because doing so would violate this release candidate's minimal source scope.

## Generated bundle verification

Generated iOS entry asset:

```text
ios/App/App/public/assets/index-CGyxmBm9.js
```

`ios/App/App/public/index.html` points to that asset, and only one `index-*.js` entry asset exists under `ios/App/App/public/assets/`.

Required markers:

```text
PAYMENT_ATTEMPT_STATE_UNKNOWN=true
Still checking your checkout=true
We couldn’t confirm whether checkout started=true
payment_intent_created=true
order_created=true
```

Forbidden markers:

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

## Archive verification

Local archive path:

```text
/tmp/G49B-NuVira-CleanCheckout.xcarchive
```

Safe archive metadata:

```text
archive_marketing_version=2.117903.0
archive_build_number=19
archive_bundle_id=com.base69d48d0c39891f7945481152.app
archive_index_asset=/assets/index-CGyxmBm9.js
```

The archive contains the same required G49A markers and does not contain the unsafe logging markers.

No upload, export, TestFlight distribution, or App Store release was performed.

## Dirty-tree isolation proof

```text
release_source_diff_expected_only=true
unrelated_dirty_source_included=false
generated_bundle_rebuilt_from_clean_source=true
```

The prior dirty worktree was not deleted, reset, copied wholesale, or used for this release candidate.

## Version/build-number plan

Current native baseline:

```text
current_marketing_version=2.117903.0
current_build_number=19
```

Proposed upload build:

```text
proposed_marketing_version=2.117903.0
proposed_build_number=20
```

The version/build number was not changed during this release-candidate source capture. A TestFlight/App Store upload should use build `20` because build `19` was already uploaded according to PR #331 evidence.

## TestFlight gate

Do not upload until separately approved.

Required before upload:

```text
authoritative_native_baseline_confirmed=true
clean_worktree_build=true
unrelated_dirty_source_included=false
g49a_markers_present=true
unsafe_logging_markers_absent=true
simulator_build_passed=true
archive_passed=true
version_build_increment_valid=true
source_capture_complete=true
```

The missing operational approval item is applying the approved build-number increment before upload.

## TestFlight smoke plan

After internal TestFlight distribution, verify on a real iPhone:

1. App version/build matches the new build.
2. Checkout page loads.
3. G49A processing behavior is present.
4. No real payment is required merely to prove the bundle version.
5. A controlled checkout attempt requires separate approval.
6. Website checkout remains the customer fallback until native smoke passes.

## Rollback

If the native build fails smoke:

- keep routing customers to `https://nuvirajuice.com` in Safari;
- do not instruct customers to retry app checkout;
- do not submit payments from the app for diagnosis;
- produce a narrow patch from this clean release branch.

## Customer guidance

Until TestFlight/App Store distribution and native smoke pass:

> Please place the order through Safari at https://nuvirajuice.com instead of the app right now. The website checkout has been updated. Tap checkout only once. If anything gets stuck or says “Still checking,” stop and send a screenshot.

## No-payment / no-write confirmation

This phase did not:

- submit a payment;
- open a customer checkout mount;
- create a Stripe PaymentIntent;
- create a Checkout Session;
- create or mutate an Order, ShopifyOrder, or FulfillmentTask;
- call Stripe, Shopify, Hub, or route providers;
- send notifications;
- change schemas;
- publish Base44 or Builder;
- upload to TestFlight/App Store.

## Classification

```text
native_checkout_clean_release_candidate_ready
```
