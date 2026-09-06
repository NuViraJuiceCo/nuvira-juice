# Android optimized-release QA

This procedure tests the actual optimized release build, not a debug variant. It
does not approve a Play release or substitute for physical-device/provider smoke.
Use the shared native release checklist and exact canonical deployment provenance
before producing any store-upload artifact.

## Changes and invariants

- Android 38 / 2.117919.0 enables R8 and resource shrinking with AGP 8.13.2.
- Capacitor's reflected annotation interfaces and dynamic Cordova XML are retained.
  The permission-read test must pass; a successful Gradle build alone did not catch
  an earlier full-mode annotation removal crash.
- Launcher and splash drawables add safe-area padding around the existing artwork.
  No bottle, label, wordmark, launcher PNG, or iOS app-icon pixels are regenerated.
- React's startup wordmark is bundled for offline startup. The web and native PNGs
  must be byte-identical to the approved source.
- The new Android CI job compiles unsigned optimized APK/AAB artifacts and retains
  R8 mapping evidence. It does not sign, publish, or exercise a payment provider.

## Build and static artifact checks

1. Use a clean, approved source and `npm ci`; run all standard release gates.
2. Run `npm run build` and `npx cap sync android`.
3. With Java 21 and Android SDK 36 available, run from `android`:

   ```sh
   ./gradlew :app:assembleRelease :app:bundleRelease --no-daemon --console=plain
   ```

4. From the repository root, run:

   ```sh
   node scripts/android/verify-release-artifact.mjs
   ```

   It verifies R8 mapping, reflected plugin entry points, Production live-update
   configuration, and byte parity for every packaged web asset. HTTPS-only
   `.well-known` files are excluded by Android's established asset packaging rule.
   Its renamed-class percentage is **not** Google's proprietary optimization score.

## Disposable emulator tests

Never use an owner's physical device or a customer session for this harness. Use a
dedicated emulator and record its serial explicitly. Do not reset another device.

1. From `android`, build the opt-in instrumentation target:

   ```sh
   NUVIRA_ANDROID_QA=1 ./gradlew --init-script ../scripts/android/qa-release.init.gradle \
     :app:assembleRelease :app:assembleReleaseAndroidTest --no-daemon --console=plain
   ```

2. Sign **copies** of the release APK and instrumentation APK with a local QA key;
   install those copies on the disposable emulator. Never upload QA-signed copies.
   The init script does not alter production signing configuration.
3. Disable Wi-Fi and mobile data on that emulator; run:

   ```sh
   adb -s <qa-emulator> shell am instrument -w -e nuviraReleaseQa true \
     com.nuvirajuice.app.test/com.nuvirajuice.app.ReleaseQaRunner
   ```

   Require `G176 OPTIMIZED RELEASE NATIVE CONTRACTS PASS`. The checks cover plugin
   availability, version, permission reads without registration, rejected invalid
   wallet inputs, declared intent routing, non-exported components, and resume.
   These are not real wallet, OAuth, verified-domain, or remote-push transactions.

4. Restore emulator Wi-Fi and data. An optional anonymous online test reads public
   catalog data and syncs the existing Appflow Production channel:

   ```sh
   adb -s <qa-emulator> shell am instrument -w -e nuviraReleaseQa true \
     -e onlinePublicCatalog true \
     com.nuvirajuice.app.test/com.nuvirajuice.app.ReleaseQaRunner
   ```

   Require `G176 ONLINE PUBLIC CATALOG PASS`. Confirm all three shot image URLs and
   nonzero decoded dimensions, the exact approved Appflow build ID, and the active
   main script. Inspect the captured storefront and all 15 launcher-mask previews.
   This test never signs in, adds cart items, checks out, or sends notifications.
   Repeat after a cold relaunch to verify snapshot persistence. Do not infer an
   active snapshot solely from the configured channel name.

5. Record a cold launch both offline and online. Inspect the native splash, WebView
   handoff, React logo, and final page. A screenshot of a loaded DOM hidden beneath
   a splash is not valid storefront visual evidence.

## iOS icon inspection

`scripts/android/render-ios-icon-qa.swift` renders the unchanged 1024px iOS icon at
13 common sizes through approximate rounded-square masks. These are QA previews,
not replacement assets or proof of the currently installed iOS icon. Confirm any
reported installed iOS crop on a physical device before changing iOS artwork.

## Remaining release gates

Rebuild from the final exact merged source after Base44/Appflow parity is recorded.
Play internal testing, signed upgrade/clean-install checks, physical Android wallet,
auth, push and checkout smoke, and Google's processed optimization result remain
separate gates. A locally passing emulator does not authorize customer rollout.
