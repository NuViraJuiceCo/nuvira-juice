#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = file => fs.readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
const app = read('android/app/build.gradle');
const root = read('android/build.gradle');
const properties = read('android/gradle.properties');
const rules = read('android/app/proguard-rules.pro').replace(/^\s*#.*$/gm, '');
const manifest = read('android/app/src/main/AndroidManifest.xml');
const main = read('android/app/src/main/java/com/nuvirajuice/app/MainActivity.java');
const capacitor = JSON.parse(read('capacitor.config.json'));
const androidWorkflow = read('.github/workflows/android-quality-gate.yml');
const checks = [];
function check(name, fn) { fn(); checks.push(name); }

check('CI packaging has bounded workers and enough heap without changing local defaults', () => {
  assert.match(androidWorkflow, /:app:assembleRelease :app:bundleRelease[^\n]*--max-workers=2/);
  assert.match(androidWorkflow, /-Dorg\.gradle\.jvmargs="-Xmx4g -XX:MaxMetaspaceSize=1g -Dfile\.encoding=UTF-8"/);
  assert.match(properties, /^org\.gradle\.jvmargs=-Xmx1536m\b/m);
});

check('release code optimization is enabled', () => assert.match(app, /release\s*\{\s*minifyEnabled true/));
check('R8 supports Stripe Kotlin 2.3 metadata', () => assert.match(root, /com\.android\.tools\.build:gradle:8\.13\.2/));
check('release resource shrinking is enabled', () => assert.match(app, /shrinkResources true/));
check('optimized default rules are selected', () => {
  assert.match(app, /getDefaultProguardFile\('proguard-android-optimize\.txt'\)/);
  assert.doesNotMatch(app, /getDefaultProguardFile\('proguard-android\.txt'\)/);
});
check('AGP 8.13 integrated resource shrinking is enabled', () => assert.match(properties, /^android\.r8\.optimizedResourceShrinking=true$/m));
check('optimization is not defeated by global escape hatches', () => {
  assert.doesNotMatch(properties, /^android\.enableR8\.fullMode=false$/m);
  assert.doesNotMatch(rules, /-(?:dontshrink|dontoptimize|dontobfuscate|ignorewarnings)\b/);
  assert.doesNotMatch(rules, /-dontwarn\s+\*\*/);
  assert.doesNotMatch(rules, /-keep\s+(?:class|interface)\s+\*\*/);
});
check('runtime annotations and JavaScript interface methods survive R8', () => {
  assert.match(rules, /-keepattributes[^\n]*\*Annotation\*/);
  assert.match(rules, /@android\.webkit\.JavascriptInterface\s+<methods>/);
  assert.match(rules, /-keep @interface com\.getcapacitor\.annotation\.\*\* \{ \*; \}/);
});
check('store identity is unchanged and Android build number advances', () => {
  assert.match(app, /applicationId "com\.nuvirajuice\.app"/);
  assert.match(app, /versionCode 38/);
  assert.match(app, /versionName "2\.117919\.0"/);
});
check('production signing remains local and has no debug fallback', () => {
  assert.match(app, /signingConfig signingConfigs\.release/);
  assert.doesNotMatch(app, /signingConfig signingConfigs\.debug/);
  assert.doesNotMatch(app, /storePassword\s+["'][^"']+["']/);
});
check('pending native Google Pay registration is present', () => {
  assert.match(main, /registerPlugin\(NativeGooglePayPlugin\.class\)/);
  assert.match(manifest, /android:name="\.NativeGooglePayActivity"\s+android:exported="false"/);
});
check('verified Android order links remain present', () => {
  assert.match(manifest, /android:autoVerify="true"/);
  assert.match(manifest, /android:pathPrefix="\/order-tracker\/"/);
  assert.match(manifest, /android:path="\/account\/orders"/);
});
check('native security and push services remain unchanged', () => {
  assert.match(manifest, /android:usesCleartextTraffic="false"/);
  assert.match(manifest, /android:allowBackup="false"/);
  assert.match(manifest, /android:name="\.NuViraMessagingService"/);
  assert.match(manifest, /android:name="\.DriverRouteTrackingService"/);
});
check('Android splash uses a bounded exact wordmark and the platform handoff', () => {
  assert.match(main, /SplashScreen\.installSplashScreen\(this\)/);
  const styles = read('android/app/src/main/res/values/styles.xml');
  assert.match(styles, /windowSplashScreenAnimatedIcon">@drawable\/nuvira_splash_icon/);
  assert.doesNotMatch(styles, /name="android:background">@drawable\/splash_screen/);
  const splash = read('android/app/src/main/res/drawable/nuvira_splash_icon.xml');
  assert.match(splash, /android:width="176dp" android:height="69dp" android:gravity="center"/);
  assert.match(splash, /@drawable\/nuvira_wordmark/);
  const adaptive = read('android/app/src/main/res/drawable-v26/nuvira_splash_icon.xml');
  assert.match(adaptive, /<adaptive-icon/);
  assert.match(adaptive, /android:insetLeft="25%"/);
});
check('launcher artwork is padded without regenerating the approved icon', () => {
  for (const name of ['ic_launcher', 'ic_launcher_round']) {
    assert.match(read(`android/app/src/main/res/mipmap-anydpi-v26/${name}.xml`), /@drawable\/nuvira_launcher_foreground/);
  }
  const foreground = read('android/app/src/main/res/drawable-v26/nuvira_launcher_foreground.xml');
  assert.match(foreground, /android:insetLeft="16\.67%"/);
  assert.match(foreground, /@mipmap\/ic_launcher_foreground/);
});
check('React startup logo is bundled and byte-identical to native artwork', () => {
  assert.match(read('src/components/SplashScreen.jsx'), /const LOGO_URL = "\/images\/brand\/nuvira-wordmark\.png"/);
  assert.deepEqual(
    fs.readFileSync(new URL('../../public/images/brand/nuvira-wordmark.png', import.meta.url)),
    fs.readFileSync(new URL('../../android/app/src/main/res/drawable-nodpi/nuvira_wordmark.png', import.meta.url)),
  );
});
check('live updates remain on the shared Production channel', () => {
  assert.equal(capacitor.plugins.LiveUpdates.appId, '044c03e1');
  assert.equal(capacitor.plugins.LiveUpdates.channel, 'Production');
  assert.equal(capacitor.server, undefined);
});
console.log(JSON.stringify({ ok: true, suite: 'g176-android-release-optimization', checks, provider_calls: false }, null, 2));
