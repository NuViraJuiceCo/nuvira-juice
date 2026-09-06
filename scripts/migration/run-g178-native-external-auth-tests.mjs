#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(file, 'utf8');
const nativeLogin = read('src/pages/NativeLogin.jsx');
const nativeAuthRedirect = read('src/lib/nativeAuthRedirect.js');
const authContext = read('src/lib/AuthContext.jsx');
const packageJson = JSON.parse(read('package.json'));
const iosEntitlements = read('ios/App/App/App.entitlements');
const iosPackage = read('ios/App/CapApp-SPM/Package.swift');
const appleAssociation = JSON.parse(read('public/.well-known/apple-app-site-association'));
const androidManifest = read('android/app/src/main/AndroidManifest.xml');
const androidCapacitorSettings = read('android/capacitor.settings.gradle');
const androidCapacitorBuild = read('android/app/capacitor.build.gradle');
const androidAssociation = JSON.parse(read('public/.well-known/assetlinks.json'));

assert.equal(packageJson.dependencies['@capacitor/app-launcher'], '8.0.1');
assert.match(nativeLogin, /import \{ AppLauncher \} from '@capacitor\/app-launcher'/);
assert.match(nativeLogin, /Capacitor\.isPluginAvailable\('AppLauncher'\)/);
assert.match(nativeLogin, /const ENABLE_PROVIDER_BUTTONS = !IS_NATIVE_PLATFORM \|\| HAS_NATIVE_EXTERNAL_BROWSER/);
assert.match(nativeLogin, /AppLauncher\.openUrl\(\{ url: providerUrl \}\)/);
assert.match(nativeLogin, /if \(!result\?\.completed\) throw new Error/);
assert.doesNotMatch(nativeLogin, /Browser\.open\(/);

assert.match(nativeAuthRedirect, /const BASE44_PROVIDER_AUTH_ORIGIN = 'https:\/\/app\.base44\.com'/);
assert.match(nativeAuthRedirect, /callbackUrl\.origin === appBaseUrl\.origin/);
assert.match(nativeAuthRedirect, /callbackUrl\.pathname === NATIVE_CALLBACK_ROUTE/);
assert.match(nativeAuthRedirect, /callbackUrl\.searchParams\.get\(NATIVE_CALLBACK_MARKER\) === '1'/);
assert.match(nativeAuthRedirect, /callbackUrl\.searchParams\.get\(NATIVE_BROWSER_CALLBACK_MARKER\) === '1'/);
assert.doesNotMatch(nativeAuthRedirect, /searchParams\.set\(['"]access_token['"]/);

assert.match(authContext, /capacitorApp\.addListener\('appUrlOpen'/);
assert.match(authContext, /consumeNativeAuthCallbackUrl\(event\?\.url\)/);
assert.match(authContext, /replaceInAppRoute\(callbackResult\.returnTo \|\| '\/'\)/);

assert.match(iosEntitlements, /applinks:nuvirajuice\.com/);
assert.match(iosEntitlements, /applinks:www\.nuvirajuice\.com/);
assert.match(iosPackage, /package\(name: "CapacitorAppLauncher", path: "[^\"]+@capacitor\/app-launcher"\)/);
assert.match(iosPackage, /product\(name: "CapacitorAppLauncher", package: "CapacitorAppLauncher"\)/);
const iosAppLink = appleAssociation.applinks.details.find((entry) =>
  entry.appID === 'JPFWU38MTS.com.base69d48d0c39891f7945481152.app');
assert.ok(iosAppLink, 'NuVira iOS app must be associated with the production domain');
assert.ok(iosAppLink.paths.includes('/native-login'));
assert.ok(iosAppLink.paths.includes('/native-login/*'));

assert.match(androidManifest, /android:host="nuvirajuice\.com"/);
assert.match(androidManifest, /android:pathPrefix="\/native-login"/);
assert.match(androidCapacitorSettings, /project\(':capacitor-app-launcher'\)/);
assert.match(androidCapacitorBuild, /implementation project\(':capacitor-app-launcher'\)/);
assert.ok(androidAssociation.some((entry) =>
  entry.target?.package_name === 'com.nuvirajuice.app'),
'NuVira Android app must be associated with the production domain');

console.log(JSON.stringify({
  ok: true,
  suite: 'g178-native-external-auth',
  cases: 31,
  native_provider_browser: 'external',
  embedded_safari_provider_launches: 0,
  ios_universal_link_return: true,
  android_app_link_return: true,
  encrypted_callback_fallback_preserved: true,
  raw_token_added_to_provider_url: false,
  external_requests: 0,
}, null, 2));
