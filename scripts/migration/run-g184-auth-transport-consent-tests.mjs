#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

const checks = [];
for (const native of [false, true]) {
  for (const consent of [null, 'denied', 'granted']) {
    const values = new Map(consent ? [
      ['nuvira_analytics_consent_v1', consent],
      ['nuvira_marketing_consent_v1', consent],
    ] : []);
    let writes = 0;
    let scripts = 0;
    const storage = {
      getItem: key => values.get(key) ?? null,
      setItem: () => { writes++; }, removeItem: () => { writes++; },
    };
    const window = { localStorage: storage, sessionStorage: storage, location: null };
    const document = {
      title: 'NuVira',
      getElementById: () => null,
      createElement: () => { scripts++; throw new Error('Authentication transport must not load measurement scripts'); },
    };
    const imports = { '@/lib/nativeRuntime': { isNativeAppRuntime: () => native } };
    const load = (file, name) => {
      const module = { exports: {} };
      vm.runInNewContext(transformSync(fs.readFileSync(file, 'utf8'), { format: 'cjs' }).code, {
        module, exports: module.exports, URL, URLSearchParams, console, window, document,
        require: key => { assert.ok(key in imports, key); return imports[key]; },
      });
      imports[name] = module.exports;
      return module.exports;
    };
    const google = load('src/lib/googleAnalytics.js', '@/lib/googleAnalytics');
    const meta = load('src/lib/metaPixel.js', '@/lib/metaPixel');
    const snap = load('src/lib/snapPixel.js', '@/lib/snapPixel');
    for (const path of ['/native-login', '/native-auth-bridge', '/native-auth-bridge/', '/NATIVE-AUTH-BRIDGE']) {
      window.location = new URL(`${path}?native_browser_callback=1&return_to=%2Faccount`, 'https://nuvirajuice.com');
      assert.equal(google.isTrackableAnalyticsPath(path), false, 'The consent banner must not appear on the auth transport route');
      assert.equal(await google.loadGoogleAnalytics(), false);
      assert.equal(await google.trackGooglePageView(path), false);
      assert.equal(meta.isSafeMarketingEventContext(), false);
      assert.equal(await meta.trackMetaPageView(path), false);
      assert.equal(await meta.trackMetaStandardEvent('CompleteRegistration'), false);
      assert.equal(await snap.loadSnapPixel(), false);
      assert.equal(await snap.trackSnapPageView(path), false);
      assert.equal(writes, 0, 'A redirect or dismissed banner must not grant or modify consent');
      assert.equal(scripts, 0);
      assert.equal(google.getAnalyticsConsent(), consent);
      assert.equal(meta.getMarketingConsent(), consent);
    }
    window.location = new URL('https://nuvirajuice.com/shop');
    assert.equal(google.isTrackableAnalyticsPath('/shop'), true);
    assert.equal(meta.isTrackableMarketingPageView('/shop'), true);
    checks.push(`${native ? 'native' : 'web'} / ${consent || 'unset'}: auth transport stays quiet and consent unchanged`);
  }
}
const banner = fs.readFileSync('src/components/AnalyticsConsent.jsx', 'utf8');
assert.match(banner, /!isTrackableAnalyticsPath\(location\.pathname\)/);
assert.match(banner, /if \(isNative \|\| !showBanner/);
assert.match(banner, /marketingAllowed \? 'granted' : 'denied'/);
console.log(JSON.stringify({ ok: true, suite: 'g184-auth-transport-consent', checks, provider_calls: false, consent_writes: 0, production_writes: false }, null, 2));
