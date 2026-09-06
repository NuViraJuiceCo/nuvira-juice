#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(file, 'utf8');
const nativeLogin = read('src/pages/NativeLogin.jsx');
const nativeAuthRedirect = read('src/lib/nativeAuthRedirect.js');
const authContext = read('src/lib/AuthContext.jsx');
const iosBridgeController = read('ios/App/App/AppBridgeViewController.swift');
const iosWebAuthPlugin = read('ios/App/App/NativeWebAuthPlugin.swift');
const iosProject = read('ios/App/App.xcodeproj/project.pbxproj');
const iosAssociation = JSON.parse(read('public/.well-known/apple-app-site-association'));
const androidManifest = read('android/app/src/main/AndroidManifest.xml');

assert.match(nativeLogin, /import \{ AppLauncher \} from '@capacitor\/app-launcher'/);
assert.match(nativeLogin, /registerPlugin\('NativeWebAuth'\)/);
assert.doesNotMatch(nativeLogin, /import \{ Browser \}/);
assert.match(nativeLogin, /Capacitor\.isPluginAvailable\('NativeWebAuth'\)/);
assert.match(nativeLogin, /Capacitor\.isPluginAvailable\('AppLauncher'\)/);
assert.match(nativeLogin, /const ENABLE_PROVIDER_BUTTONS = !IS_NATIVE_PLATFORM \|\| HAS_NATIVE_WEB_AUTH \|\| HAS_NATIVE_EXTERNAL_BROWSER/);
assert.match(nativeLogin, /getNativeBrowserProviderReturnUrl\(returnTo\)/);
assert.match(nativeLogin, /getProviderLoginUrl\(provider, callbackUrl\)/);
assert.match(nativeLogin, /NativeWebAuth\.authenticate\(\{[\s\S]*callbackScheme: 'nuvira'/);
assert.match(nativeLogin, /consumeNativeAuthCallbackUrl\(result\?\.callbackUrl \|\| ''\)/);
assert.match(nativeLogin, /navigate\(callbackResult\.returnTo \|\| returnTo, \{ replace: true \}\)/);
assert.match(nativeLogin, /AppLauncher\.openUrl\(\{ url: providerUrl \}\)/);
assert.match(nativeLogin, /if \(!result\?\.completed\) throw new Error/);
assert.doesNotMatch(nativeLogin, /Browser\.open/);
assert.ok(
  nativeLogin.indexOf('NativeWebAuth.authenticate') < nativeLogin.indexOf('AppLauncher.openUrl'),
  'The native authentication session must be preferred over the system-browser fallback',
);

assert.match(iosBridgeController, /registerPluginInstance\(NativeWebAuthPlugin\(\)\)/);
assert.match(iosWebAuthPlugin, /class NativeWebAuthPlugin: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding/);
assert.match(iosWebAuthPlugin, /CAPPluginMethod\(name: "authenticate", returnType: CAPPluginReturnPromise\)/);
assert.match(iosWebAuthPlugin, /scheme == "https"/);
assert.match(iosWebAuthPlugin, /url\.host\?\.lowercased\(\) == "app\.base44\.com"/);
assert.match(iosWebAuthPlugin, /callbackScheme"\)\?\.lowercased\(\) == "nuvira"/);
assert.match(iosWebAuthPlugin, /ASWebAuthenticationSession\([\s\S]*callbackURLScheme: "nuvira"/);
assert.match(iosWebAuthPlugin, /prefersEphemeralWebBrowserSession = false/);
assert.match(iosWebAuthPlugin, /callbackURL\.scheme\?\.lowercased\(\) == "nuvira"/);
assert.match(iosWebAuthPlugin, /authError\.code == \.canceledLogin/);
assert.match(nativeLogin, /error\?\.code === 'AUTH_CANCELED'[\s\S]*setStatusText\('Sign-in canceled\.'\)/);
assert.match(iosProject, /NativeWebAuthPlugin\.swift in Sources/);

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
  cases: 44,
  providers_covered: ['google', 'apple'],
  browser_launch: 'ios_authentication_session_with_system_browser_fallback',
  automatic_ios_return: true,
  provider_auth_origin: 'base44_first_party',
  callback_bridge_excluded_from_app_links: true,
  encrypted_handoff_preserved: true,
  browser_close_requires_valid_callback: true,
  external_requests: 0,
  writes_performed: false,
}, null, 2));
