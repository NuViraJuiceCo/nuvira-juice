#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const metaSource = fs.readFileSync('src/lib/metaPixel.js', 'utf8');
const register = fs.readFileSync('src/pages/Register.jsx', 'utf8');
const authContext = fs.readFileSync('src/lib/AuthContext.jsx', 'utf8');
const critical = fs.readFileSync('scripts/ci/run-critical-regressions.mjs', 'utf8');

const checks = [
  ['CompleteRegistration is an approved Meta standard event', () => {
    assert.match(metaSource, /META_STANDARD_EVENTS[\s\S]{0,260}'CompleteRegistration'/);
  }],
  ['email registration is staged only after OTP verification succeeds', () => {
    assert.match(register, /await base44\.auth\.verifyOtp\(\{ email, otpCode \}\);[\s\S]{0,320}prepareMetaRegistrationEvent\('email'\);/);
    assert.ok(register.indexOf("prepareMetaRegistrationEvent('email')") < register.indexOf('window.location.href = safeReturnTo()'));
  }],
  ['email registration is consumed only after authenticated readback', () => {
    assert.match(authContext, /if \(currentUser\) \{[\s\S]{0,420}void consumeMetaRegistrationEvent\(\);/);
  }],
  ['Google registration is emitted only after verified provider completion', () => {
    assert.match(authContext, /providerEventCompleted && pendingProviderAuthEvent\?\.eventName === 'sign_up'/);
    assert.match(authContext, /trackMetaCompleteRegistration\(pendingProviderAuthEvent\.method\)/);
  }],
  ['registration marker is short lived and removed before emission', () => {
    assert.match(metaSource, /META_REGISTRATION_TTL_MS = 10 \* 60 \* 1000/);
    assert.match(metaSource, /storage\.removeItem\(META_REGISTRATION_STORAGE_KEY\)/);
    assert.match(metaSource, /ageMs < 0 \|\| ageMs > META_REGISTRATION_TTL_MS/);
  }],
  ['registration payload is PII free', () => {
    const registrationBlock = metaSource.slice(
      metaSource.indexOf('export function trackMetaCompleteRegistration'),
      metaSource.indexOf('export async function consumeMetaRegistrationEvent'),
    );
    assert.doesNotMatch(registrationBlock, /(?:^|\s)(?:email|phone|first_name|last_name|address|user_id|external_id)\s*:/m);
    assert.match(registrationBlock, /content_name: 'NuVira account'/);
    assert.match(registrationBlock, /registration_method: safeLabel\(method, 'unknown'\)/);
  }],
  ['native measurement exclusion remains explicit', () => {
    assert.match(metaSource, /prepareMetaRegistrationEvent[\s\S]{0,180}isNativeAppRuntime\(\)/);
    assert.match(metaSource, /consumeMetaRegistrationEvent[\s\S]{0,180}isNativeAppRuntime\(\)/);
  }],
  ['G142 remains part of the critical regression suite', () => {
    assert.match(critical, /run-g142-meta-registration-measurement-tests\.mjs/);
  }],
];

let passed = 0;
for (const [name, check] of checks) {
  check();
  passed += 1;
  console.log(`PASS ${passed}: ${name}`);
}

const localStored = new Map();
const sessionStored = new Map();
const scripts = new Map();
const emitted = [];
const windowMock = {
  localStorage: {
    getItem: (key) => localStored.get(key) || null,
    setItem: (key, value) => localStored.set(key, String(value)),
    removeItem: (key) => localStored.delete(key),
  },
  sessionStorage: {
    getItem: (key) => sessionStored.get(key) || null,
    setItem: (key, value) => sessionStored.set(key, String(value)),
    removeItem: (key) => sessionStored.delete(key),
  },
  location: { search: '' },
  dispatchEvent: () => true,
};
const documentMock = {
  cookie: '',
  head: {
    appendChild: (script) => {
      scripts.set(script.id, script);
      queueMicrotask(() => script.onload?.());
    },
  },
  createElement: () => ({
    dataset: {},
    remove() {
      scripts.delete(this.id);
    },
  }),
  getElementById: (id) => scripts.get(id) || null,
};
const executable = metaSource
  .replace("import { isNativeAppRuntime } from '@/lib/nativeRuntime';", 'const isNativeAppRuntime = () => false;')
  .replace(/^export /gm, '')
  + '\nglobalThis.__g142 = { setMarketingConsent, prepareMetaRegistrationEvent, consumeMetaRegistrationEvent, trackMetaCompleteRegistration };';
const context = vm.createContext({
  window: windowMock,
  document: documentMock,
  CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
  console,
  crypto: { randomUUID: () => 'g142-registration-event' },
  URLSearchParams,
  JSON,
  Date,
  Math,
  queueMicrotask,
});
vm.runInContext(executable, context);

assert.equal(await context.__g142.trackMetaCompleteRegistration('email'), false, 'registration must fail closed before consent');
assert.equal(context.__g142.prepareMetaRegistrationEvent('email'), true);
assert.equal(sessionStored.size, 1);
assert.equal(await context.__g142.consumeMetaRegistrationEvent(), false, 'pending registration must remain consent gated');
assert.equal(sessionStored.size, 0, 'consumed registration marker must not replay');

assert.equal(context.__g142.setMarketingConsent('granted'), true);
windowMock.fbq = (...args) => emitted.push(args);
assert.equal(context.__g142.prepareMetaRegistrationEvent('google'), true);
assert.equal(await context.__g142.consumeMetaRegistrationEvent(), true);
const registrationEvents = emitted.filter((entry) => entry[0] === 'track' && entry[1] === 'CompleteRegistration');
assert.equal(registrationEvents.length, 1);
assert.equal(registrationEvents[0][2].content_name, 'NuVira account');
assert.equal(registrationEvents[0][2].registration_method, 'google');
assert.equal(registrationEvents[0][3].eventID, 'web:CompleteRegistration:g142-registration-event');
assert.equal(JSON.stringify(registrationEvents).includes('@'), false);
assert.equal(JSON.stringify(registrationEvents).includes('636'), false);
assert.equal(await context.__g142.consumeMetaRegistrationEvent(), false, 'replay without a marker must be ignored');

sessionStored.set('nuvira_meta_registration_event_v1', JSON.stringify({ method: 'email', createdAt: Date.now() - (11 * 60 * 1000) }));
assert.equal(await context.__g142.consumeMetaRegistrationEvent(), false, 'expired marker must be ignored');
assert.equal(registrationEvents.length, 1);

console.log(`PASS ${checks.length + 1}: runtime harness verifies consent, authenticated staging, PII omission, TTL, and replay safety`);
console.log(`G142 Meta registration measurement coverage: ${passed + 1}/${checks.length + 1} checks passed`);
