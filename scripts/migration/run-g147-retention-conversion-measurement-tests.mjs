#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const analytics = read('src/lib/googleAnalytics.js');
const rewards = read('src/pages/Rewards.jsx');
const orders = read('src/pages/OrderHistory.jsx');
const critical = read('scripts/ci/run-critical-regressions.mjs');
const G147_EVENTS = new Set(['reward_apply', 'reward_remove', 'reorder_start']);

const checks = [
  ['retention conversion measurement uses a closed event contract', () => {
    for (const eventName of G147_EVENTS) assert.match(analytics, new RegExp(`['"]${eventName}['"]`));
    assert.match(analytics, /REWARD_TYPES = new Set/);
    assert.match(analytics, /REORDER_SOURCES = new Set\(\['order_history'\]\)/);
  }],
  ['reward measurement runs after the customer-visible state change', () => {
    const standardApply = rewards.indexOf("trackGoogleRetentionEvent('reward_apply', { reward_type: reward.reward_type })");
    const freeApply = rewards.indexOf("trackGoogleRetentionEvent('reward_apply', { reward_type: rewardType })");
    const remove = rewards.indexOf("trackGoogleRetentionEvent('reward_remove', { reward_type: rewardType })");
    assert.ok(standardApply > rewards.indexOf('setActiveReward(r);'));
    assert.ok(freeApply > rewards.indexOf('setPendingReward(null);'));
    assert.ok(remove > rewards.indexOf('setActiveReward(null);', rewards.indexOf('const handleRemoveReward')));
  }],
  ['reorder measurement runs after cart additions and excludes order identity', () => {
    const handler = orders.slice(orders.indexOf('const handleReorder'), orders.indexOf('return (', orders.indexOf('const handleReorder')));
    assert.ok(handler.indexOf("trackGoogleRetentionEvent('reorder_start'") > handler.indexOf('reorderItems.forEach'));
    assert.match(handler, /reorder_source: 'order_history'/);
    assert.doesNotMatch(handler, /order_number|customer_email|customer_name|delivery_address/);
  }],
  ['G147 remains in the critical regression suite', () => {
    assert.match(critical, /run-g147-retention-conversion-measurement-tests\.mjs/);
  }],
];

let passed = 0;
for (const [name, check] of checks) {
  check();
  passed += 1;
  console.log(`PASS ${passed}: ${name}`);
}

function analyticsRuntime(native = false) {
  const localStored = new Map();
  const scripts = new Map();
  const windowMock = {
    localStorage: {
      getItem: (key) => localStored.get(key) || null,
      setItem: (key, value) => localStored.set(key, String(value)),
      removeItem: (key) => localStored.delete(key),
    },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    location: { origin: 'https://nuvirajuice.com', href: 'https://nuvirajuice.com/account/orders', pathname: '/account/orders', search: '', hash: '' },
    history: { replaceState: () => {} },
    dispatchEvent: () => true,
  };
  const documentMock = {
    title: 'NuVira retention conversion test', cookie: '',
    head: { appendChild: (script) => { scripts.set(script.id, script); queueMicrotask(() => script.onload?.()); } },
    createElement: () => ({ dataset: {}, remove() { scripts.delete(this.id); } }),
    getElementById: (id) => scripts.get(id) || null,
  };
  const executable = analytics
    .replace("import { isNativeAppRuntime } from '@/lib/nativeRuntime';", `const isNativeAppRuntime = () => ${native};`)
    .replace(/^export /gm, '')
    + '\nglobalThis.__g147 = { setAnalyticsConsent, trackGoogleRetentionEvent };';
  const context = vm.createContext({
    window: windowMock,
    document: documentMock,
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    console,
    URL,
    URLSearchParams,
    encodeURIComponent,
    queueMicrotask,
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(executable, context);
  return { api: context.__g147, windowMock };
}

const web = analyticsRuntime(false);
assert.equal(web.api.trackGoogleRetentionEvent('reward_apply', { reward_type: 'free_shot' }), false);
assert.equal(web.api.setAnalyticsConsent('granted'), true);
assert.equal(web.api.trackGoogleRetentionEvent('reward_apply', {
  reward_type: 'free_shot', reward_title: 'private', customer_email: 'customer@example.com',
}), true);
assert.equal(web.api.trackGoogleRetentionEvent('reward_remove', {
  reward_type: 'discount_10pct', user_id: 'private-user',
}), true);
assert.equal(web.api.trackGoogleRetentionEvent('reorder_start', {
  reorder_source: 'order_history', item_count: 4, distinct_item_count: 3, contains_program: true,
  order_number: 'NV-PRIVATE', product_ids: ['private-product'],
}), true);
assert.equal(web.api.trackGoogleRetentionEvent('reward_apply', { reward_type: 'customer-supplied' }), false);
assert.equal(web.api.trackGoogleRetentionEvent('reorder_start', {
  reorder_source: 'order_tracker', item_count: 4, distinct_item_count: 3, contains_program: true,
}), false);
assert.equal(web.api.trackGoogleRetentionEvent('reorder_start', {
  reorder_source: 'order_history', item_count: 1, distinct_item_count: 2, contains_program: false,
}), false);

const emitted = web.windowMock.dataLayer.map((entry) => Array.from(entry));
const conversionEvents = emitted.filter((entry) => entry[0] === 'event' && G147_EVENTS.has(entry[1]));
assert.equal(conversionEvents.length, 3);
assert.equal(conversionEvents.map((entry) => entry[1]).join(','), 'reward_apply,reward_remove,reorder_start');
const serialized = JSON.stringify(conversionEvents);
for (const privateValue of ['customer@example.com', 'private-user', 'NV-PRIVATE', 'private-product', 'reward_title', 'customer_email', 'order_number', 'product_ids']) {
  assert.equal(serialized.includes(privateValue), false, `private value leaked: ${privateValue}`);
}
passed += 1;
console.log(`PASS ${passed}: web retention conversion events are consent-gated and PII-free`);

const native = analyticsRuntime(true);
assert.equal(native.api.setAnalyticsConsent('granted'), false);
assert.equal(native.api.trackGoogleRetentionEvent('reward_apply', { reward_type: 'free_shot' }), false);
assert.equal(native.api.trackGoogleRetentionEvent('reorder_start', {
  reorder_source: 'order_history', item_count: 2, distinct_item_count: 1, contains_program: false,
}), false);
assert.equal(native.windowMock.dataLayer, undefined);
passed += 1;
console.log(`PASS ${passed}: native runtime remains excluded from web analytics`);

console.log(`\nG147 retention conversion measurement tests passed (${passed}/${passed}).`);
