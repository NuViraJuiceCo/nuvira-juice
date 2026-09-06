#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(file, 'utf8');
const app = read('src/App.jsx');
const nativeLogin = read('src/pages/NativeLogin.jsx');
const nativeAuthRedirect = read('src/lib/nativeAuthRedirect.js');
const authContext = read('src/lib/AuthContext.jsx');
const deliveryLiveActivity = read('src/lib/deliveryLiveActivity.js');
const iosAssociation = JSON.parse(read('public/.well-known/apple-app-site-association'));
const androidManifest = read('android/app/src/main/AndroidManifest.xml');

assert.match(nativeAuthRedirect, /const NATIVE_BROWSER_CALLBACK_ROUTE = '\/native-auth-bridge'/);
assert.match(app, /<Route path="\/native-auth-bridge" element=\{<NativeLogin \/>\} \/>/);
assert.match(nativeLogin, /getNativeBrowserProviderReturnUrl\(returnTo\)/);
assert.match(nativeLogin, /createEncryptedNativeAuthCallbackUrl\(window\.location\.href, accessToken\)/);
assert.match(nativeLogin, /window\.location\.replace\(callbackUrl\)/);

assert.match(nativeAuthRedirect, /new URL\(NATIVE_BROWSER_CALLBACK_ROUTE, appParams\.appBaseUrl\)/);
assert.match(nativeAuthRedirect, /callbackUrl\.pathname === NATIVE_BROWSER_CALLBACK_ROUTE/);
assert.match(nativeAuthRedirect, /new URL\(`\/api\/apps\/auth\$\{providerPath\}\/login`, appParams\.appBaseUrl\)/);
assert.doesNotMatch(nativeAuthRedirect, /BASE44_PROVIDER_AUTH_ORIGIN/);

const iosPaths = iosAssociation.applinks.details.flatMap((entry) => entry.paths || []);
assert.ok(!iosPaths.includes('/native-auth-bridge'));
assert.ok(!iosPaths.includes('/native-auth-bridge/*'));
assert.doesNotMatch(androidManifest, /android:path(?:Prefix)?="\/native-auth-bridge"/);

assert.match(nativeAuthRedirect, /if \(!rawAccessToken && !shouldClearToken\) return null/);
assert.match(nativeAuthRedirect, /if \(rawAccessToken && url\.searchParams\.get\(NATIVE_CALLBACK_MARKER\) !== '1'\) return null/);
const callbackConsumer = nativeAuthRedirect.slice(
  nativeAuthRedirect.indexOf('export async function consumeNativeAuthCallbackUrl'),
  nativeAuthRedirect.indexOf('export function getStoredBase44Token'),
);
assert.ok(
  callbackConsumer.indexOf('if (!rawAccessToken && !shouldClearToken) return null')
    < callbackConsumer.indexOf('const accessToken = applyBase44AuthParams(url)'),
  'Tokenless native web callbacks must be rejected before auth state is changed',
);

assert.match(deliveryLiveActivity, /const AUTH_CALLBACK_PATHS = new Set\(\['\/native-login', '\/native-auth-bridge'\]\)/);
assert.match(deliveryLiveActivity, /if \(AUTH_CALLBACK_PATHS\.has\(url\.pathname\)\) return null/);
assert.match(deliveryLiveActivity, /return matchDeliveryDeepLink\(`\$\{url\.pathname\}\$\{url\.search\}\$\{url\.hash\}`\)/);
assert.match(deliveryLiveActivity, /return ALLOWED_DEEP_LINK\.test\(path\) \? path : null/);
assert.doesNotMatch(deliveryLiveActivity, /return safeDeepLink\(`\$\{url\.pathname\}/);

assert.match(authContext, /const handledNativeAuthCallbacksRef = useRef\(new Set\(\)\)/);
assert.match(authContext, /handledNativeAuthCallbacksRef\.current\.has\(callbackUrl\)/);
assert.match(authContext, /handledNativeAuthCallbacksRef\.current\.add\(callbackUrl\)/);
assert.match(authContext, /if \(!callbackResult\?\.accessToken\)/);
assert.doesNotMatch(authContext, /from '@capacitor\/browser'/);
assert.doesNotMatch(authContext, /Browser\.close/);

console.log(JSON.stringify({
  ok: true,
  suite: 'g179-native-auth-reliability',
  cases: 26,
  browser_callback_route: '/native-auth-bridge',
  browser_callback_excluded_from_app_links: true,
  configured_auth_origin: true,
  tokenless_callback_rejected: true,
  duplicate_callback_suppressed: true,
  auth_urls_excluded_from_delivery_navigation: true,
  external_requests: 0,
  writes_performed: false,
}, null, 2));
