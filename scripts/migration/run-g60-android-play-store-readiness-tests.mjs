#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const capacitorConfig = JSON.parse(fs.readFileSync('capacitor.config.json', 'utf8'));
const variablesGradle = fs.readFileSync('android/variables.gradle', 'utf8');
const appGradle = fs.readFileSync('android/app/build.gradle', 'utf8');
const manifest = fs.readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');
const strings = fs.readFileSync('android/app/src/main/res/values/strings.xml', 'utf8');
const styles = fs.readFileSync('android/app/src/main/res/values/styles.xml', 'utf8');
const rootGitignore = fs.readFileSync('.gitignore', 'utf8');
const androidGitignore = fs.readFileSync('android/.gitignore', 'utf8');

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test('1. Capacitor Android dependency is pinned to the active Capacitor major/minor.', () => {
  assert.equal(packageJson.dependencies['@capacitor/android'], '8.3.4');
  assert.equal(packageJson.dependencies['@capacitor/core'], '^8.3.4');
  assert.equal(packageJson.dependencies['@capacitor/cli'], '^8.3.4');
});

test('2. Android package identity follows the existing shared Capacitor app ID.', () => {
  assert.equal(capacitorConfig.appId, 'com.base69d48d0c39891f7945481152.app');
  assert.match(appGradle, /namespace = "com\.base69d48d0c39891f7945481152\.app"/);
  assert.match(appGradle, /applicationId "com\.base69d48d0c39891f7945481152\.app"/);
  assert.match(strings, /<string name="package_name">com\.base69d48d0c39891f7945481152\.app<\/string>/);
});

test('3. Play release metadata matches the current native release line.', () => {
  assert.match(appGradle, /versionCode 32/);
  assert.match(appGradle, /versionName "2\.117913\.0"/);
});

test('4. Android SDK levels satisfy current Play readiness.', () => {
  assert.match(variablesGradle, /minSdkVersion = 24/);
  assert.match(variablesGradle, /compileSdkVersion = 36/);
  assert.match(variablesGradle, /targetSdkVersion = 36/);
});

test('5. Android app shell is hardened for backups and cleartext transport.', () => {
  assert.match(manifest, /android:allowBackup="false"/);
  assert.match(manifest, /android:fullBackupContent="false"/);
  assert.match(manifest, /android:usesCleartextTraffic="false"/);
});

test('6. Android login callback scheme matches native auth code.', () => {
  assert.match(strings, /<string name="custom_url_scheme">nuvira<\/string>/);
  assert.match(manifest, /android:scheme="nuvira"/);
  assert.match(manifest, /android:host="auth"/);
  assert.match(manifest, /android:path="\/callback"/);
});

test('7. Android notification and network permissions are explicit.', () => {
  assert.match(manifest, /android\.permission\.INTERNET/);
  assert.match(manifest, /android\.permission\.POST_NOTIFICATIONS/);
});

test('8. Release signing uses local ignored keystore properties only.', () => {
  assert.match(appGradle, /def keystorePropertiesFile = rootProject\.file\("keystore\.properties"\)/);
  assert.match(appGradle, /signingConfigs\s*\{\s*release/);
  assert.match(appGradle, /signingConfig signingConfigs\.release/);
  assert.match(rootGitignore, /android\/keystore\.properties/);
  assert.match(rootGitignore, /android\/\*\.jks/);
  assert.match(androidGitignore, /keystore\.properties/);
  assert.match(androidGitignore, /\*\.jks/);
});

test('9. Android splash and launcher branding resources are present.', () => {
  for (const file of [
    'android/app/src/main/res/values/colors.xml',
    'android/app/src/main/res/drawable/splash_screen.xml',
    'android/app/src/main/res/drawable/splash_logo.png',
    'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png',
    'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.png',
    'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png',
  ]) {
    assert.ok(fs.existsSync(file), `${file} must exist`);
  }
  assert.match(styles, /@drawable\/splash_screen/);
  assert.match(styles, /windowSplashScreenAnimatedIcon/);
});

test('10. Google services configuration is not accidentally committed.', () => {
  assert.ok(!fs.existsSync('android/app/google-services.json'), 'android/app/google-services.json must be added intentionally only after Firebase Android app registration');
});

for (const item of tests) {
  item.fn();
}

console.log(JSON.stringify({
  success: true,
  suite: 'g60-android-play-store-readiness',
  cases: tests.length,
  writes_performed: false,
  provider_calls_performed: false,
  customer_notifications_sent: false,
  operational_records_mutated: false,
}, null, 2));
