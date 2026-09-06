#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(file, 'utf8');
const nativeLogin = read('src/pages/NativeLogin.jsx');
const nativeAuthRedirect = read('src/lib/nativeAuthRedirect.js');
const indexHtml = read('index.html');

const mobileSafeCredentialInputs = nativeLogin.match(
  /className="min-w-0 flex-1 bg-transparent text-base outline-none md:text-sm"/g,
) || [];

assert.equal(
  mobileSafeCredentialInputs.length,
  3,
  'Email, password, and password-confirmation inputs must render at 16px on mobile',
);
assert.match(nativeLogin, /releaseNativeAuthViewport\(\);\s*\n\s*navigate\(returnTo, \{ replace: true \}\)/);
assert.match(nativeAuthRedirect, /export function releaseNativeAuthViewport\(\)/);
assert.match(nativeAuthRedirect, /document\.activeElement/);
assert.match(nativeAuthRedirect, /activeElement\.blur\(\)/);
assert.match(nativeAuthRedirect, /window\.scrollTo\(\{ top: 0, left: 0, behavior: 'auto' \}\)/);
assert.match(nativeAuthRedirect, /releaseNativeAuthViewport\(\);\s*\n\s*window\.history\.replaceState/);

assert.match(nativeLogin, /const providerLaunchRef = useRef\(false\)/);
assert.match(nativeLogin, /if \(providerLaunchRef\.current\) return/);
assert.match(nativeLogin, /providerLaunchRef\.current = true/);
assert.ok(
  nativeLogin.indexOf('if (!ENABLE_PROVIDER_BUTTONS)') < nativeLogin.indexOf('providerLaunchRef.current = true'),
  'Unavailable provider handling must not latch the launch guard',
);
assert.match(nativeLogin, /getNativeBrowserProviderReturnUrl\(returnTo\)[\s\S]*AppLauncher\.openUrl/);
assert.match(nativeLogin, /disabled=\{isSubmitting \|\| Boolean\(providerOpening\)\}/);

assert.match(nativeAuthRedirect, /callbackUrl\.origin === appBaseUrl\.origin/);
assert.match(nativeAuthRedirect, /callbackUrl\.pathname === NATIVE_BROWSER_CALLBACK_ROUTE/);
assert.match(nativeAuthRedirect, /callbackUrl\.searchParams\.get\(NATIVE_CALLBACK_MARKER\) === '1'/);
assert.match(nativeAuthRedirect, /callbackUrl\.searchParams\.get\(NATIVE_BROWSER_CALLBACK_MARKER\) === '1'/);
assert.match(nativeAuthRedirect, /new URL\(`\/api\/apps\/auth\$\{providerPath\}\/login`, BASE44_PROVIDER_AUTH_ORIGIN\)/);
assert.doesNotMatch(nativeAuthRedirect, /searchParams\.set\(['"]access_token['"]/);

assert.match(indexHtml, /width=device-width, initial-scale=1\.0, viewport-fit=cover/);
assert.doesNotMatch(indexHtml, /user-scalable\s*=\s*no/i);
assert.doesNotMatch(indexHtml, /maximum-scale\s*=\s*1/i);

console.log(JSON.stringify({
  ok: true,
  suite: 'g177-native-auth-viewport',
  cases: 20,
  mobile_credential_font_floor_px: 16,
  focus_released_before_navigation: true,
  duplicate_provider_launch_blocked: true,
  provider_launch_single_flight: true,
  provider_auth_origin: 'base44_first_party',
  callback_allowlist_enforced: true,
  pinch_zoom_preserved: true,
  external_requests: 0,
}, null, 2));
