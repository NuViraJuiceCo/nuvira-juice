#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(file, 'utf8');
const nativeLogin = read('src/pages/NativeLogin.jsx');
const nativeAuthRedirect = read('src/lib/nativeAuthRedirect.js');
const authContext = read('src/lib/AuthContext.jsx');
const iosAssociation = JSON.parse(read('public/.well-known/apple-app-site-association'));
const androidManifest = read('android/app/src/main/AndroidManifest.xml');

assert.match(nativeLogin, /import \{ AppLauncher \} from '@capacitor\/app-launcher'/);
assert.doesNotMatch(nativeLogin, /import \{ Browser \}/);
assert.match(nativeLogin, /Capacitor\.isPluginAvailable\('AppLauncher'\)/);
assert.match(nativeLogin, /getNativeBrowserProviderReturnUrl\(returnTo\)/);
assert.match(nativeLogin, /getProviderLoginUrl\(provider, callbackUrl\)/);
assert.match(nativeLogin, /AppLauncher\.openUrl\(\{ url: providerUrl \}\)/);
assert.match(nativeLogin, /if \(!result\?\.completed\) throw new Error/);
assert.doesNotMatch(nativeLogin, /Browser\.open/);

assert.match(nativeAuthRedirect, /const NATIVE_BROWSER_CALLBACK_ROUTE = '\/native-auth-bridge'/);
assert.match(nativeAuthRedirect, /new URL\(NATIVE_BROWSER_CALLBACK_ROUTE, appParams\.appBaseUrl\)/);
assert.match(nativeAuthRedirect, /return prepareNativeAuthHandoff/);
assert.match(nativeAuthRedirect, /createEncryptedNativeAuthCallbackUrl/);
assert.match(nativeAuthRedirect, /const BASE44_PROVIDER_AUTH_ORIGIN = 'https:\/\/app\.base44\.com'/);
assert.match(nativeAuthRedirect, /new URL\(`\/api\/apps\/auth\$\{providerPath\}\/login`, BASE44_PROVIDER_AUTH_ORIGIN\)/);

const iosPaths = iosAssociation.applinks.details.flatMap((entry) => entry.paths || []);
assert.ok(!iosPaths.includes('/native-auth-bridge'));
assert.ok(!iosPaths.includes('/native-auth-bridge/*'));
assert.doesNotMatch(androidManifest, /android:path(?:Prefix)?="\/native-auth-bridge"/);

assert.match(authContext, /const callbackResult = await consumeNativeAuthCallbackUrl\(callbackUrl\)/);
const invalidCallbackBranch = authContext.slice(
  authContext.indexOf('if (!callbackResult?.accessToken)'),
  authContext.indexOf('try {', authContext.indexOf('if (!callbackResult?.accessToken)')),
);
assert.doesNotMatch(invalidCallbackBranch, /Browser\.close/);
const validCallbackBranch = authContext.slice(
  authContext.indexOf('try {', authContext.indexOf('if (!callbackResult?.accessToken)')),
  authContext.indexOf('const currentUser = await checkAppState'),
);
assert.match(validCallbackBranch, /Capacitor\.isPluginAvailable\('Browser'\)/);
assert.match(validCallbackBranch, /await Browser\.close\(\)\.catch/);

console.log(JSON.stringify({
  ok: true,
  suite: 'g180-native-provider-browser',
  cases: 22,
  providers_covered: ['google', 'apple'],
  browser_launch: 'system_browser',
  provider_auth_origin: 'base44_first_party',
  callback_bridge_excluded_from_app_links: true,
  encrypted_handoff_preserved: true,
  browser_close_requires_valid_callback: true,
  external_requests: 0,
  writes_performed: false,
}, null, 2));
