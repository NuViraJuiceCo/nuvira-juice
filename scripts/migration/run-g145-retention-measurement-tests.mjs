#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const analytics = read('src/lib/googleAnalytics.js');
const journeyPage = read('src/pages/ProgramJourney.jsx');
const preferences = read('src/components/NotificationPreferencesPanel.jsx');
const deliveryCard = read('src/components/delivery/DeliveryAvailabilityCard.jsx');
const critical = read('scripts/ci/run-critical-regressions.mjs');
const GOOGLE_EVENT_NAMES = new Set([
  'program_journey_start',
  'program_check_in',
  'program_journey_complete',
  'program_reminder_update',
  'notification_preferences_update',
  'delivery_area_check',
]);

const checks = [
  ['retention measurement uses a closed event and parameter contract', () => {
    for (const eventName of [
      'program_journey_start',
      'program_check_in',
      'program_journey_complete',
      'program_reminder_update',
      'notification_preferences_update',
      'delivery_area_check',
    ]) assert.match(analytics, new RegExp(`['"]${eventName}['"]`));
    assert.match(analytics, /GOOGLE_RETENTION_EVENTS/);
    assert.match(analytics, /PROGRAM_KEYS = new Set\(\['radiance', 'hydration', 'reset'\]\)/);
    assert.match(analytics, /DELIVERY_ZONE_TYPES = new Set\(\['core', 'extended', 'route_review', 'unavailable'\]\)/);
  }],
  ['program measurement runs only after a successful gateway mutation', () => {
    assert.match(journeyPage, /onSuccess: \(data, variables\) => \{/);
    assert.match(journeyPage, /resolveProgramJourneyMeasurements\(previousJourney, data\?\.journey, variables\)/);
    assert.ok(journeyPage.indexOf('const previousJourney = queryClient.getQueryData') < journeyPage.indexOf("queryClient.setQueryData(['program-journey', id]"));
    assert.doesNotMatch(journeyPage, /mutationFn:[\s\S]{0,180}trackGoogleRetentionEvent/);
  }],
  ['subscription preferences are removed without a schema or backend mutation', () => {
    assert.doesNotMatch(preferences, /subscription_updates|Subscription Updates|subscription alerts/i);
    assert.match(preferences, /Order and delivery alerts are always on/);
    assert.match(preferences, /\['order_updates', 'delivery_updates'\]\.includes\(key\)/);
  }],
  ['notification preference measurement occurs only after persistence succeeds', () => {
    const saveIndex = preferences.indexOf("trackGoogleRetentionEvent('notification_preferences_update'");
    assert.ok(saveIndex > preferences.indexOf('NotificationPreference.update'));
    assert.ok(saveIndex > preferences.indexOf('NotificationPreference.create'));
    assert.ok(saveIndex < preferences.indexOf("toast.success('Notification preferences saved.')"));
    assert.doesNotMatch(preferences.slice(saveIndex, saveIndex + 500), /customer_email|user\.email|prefId/);
  }],
  ['delivery-area measurement excludes ZIP and precise zone identifiers', () => {
    const measurement = deliveryCard.slice(
      deliveryCard.indexOf("trackGoogleRetentionEvent('delivery_area_check'"),
      deliveryCard.indexOf("trackGoogleRetentionEvent('delivery_area_check'") + 420,
    );
    assert.match(measurement, /availability_outcome/);
    assert.match(measurement, /zone_type/);
    assert.doesNotMatch(measurement, /\bzip\b|postal|zone_key|zone_name/i);
  }],
  ['native exclusion and advertising-consent denials remain explicit', () => {
    assert.match(analytics, /function trackGoogleLifecycleEvent[\s\S]{0,180}isNativeAppRuntime\(\)/);
    assert.match(analytics, /ad_storage: 'denied'/);
    assert.match(analytics, /ad_user_data: 'denied'/);
    assert.match(analytics, /ad_personalization: 'denied'/);
  }],
  ['G145 remains in the critical regression suite', () => {
    assert.match(critical, /run-g145-retention-measurement-tests\.mjs/);
  }],
];

let passed = 0;
for (const [name, check] of checks) {
  check();
  passed += 1;
  console.log(`PASS ${passed}: ${name}`);
}

const measurementModule = await import(`${pathToFileURL(path.join(root, 'src/lib/program-journey-measurement.js')).href}?g145=${Date.now()}`);
const baseJourney = {
  program_key: 'hydration',
  program_days: 2,
  status: 'not_started',
  completed_steps: 0,
  total_steps: 8,
  reminders_enabled: false,
  schedule: [{ step_id: 'day-1-morning', day_number: 1, time_key: 'morning', completed_at: null }],
};
const startedJourney = { ...baseJourney, status: 'in_progress', reminders_enabled: true };
assert.deepEqual(measurementModule.resolveProgramJourneyMeasurements(baseJourney, startedJourney, {
  action: 'start', reminders_enabled: true,
}).map((event) => event.eventName), ['program_journey_start']);
assert.deepEqual(measurementModule.resolveProgramJourneyMeasurements(startedJourney, startedJourney, {
  action: 'start', reminders_enabled: true,
}), []);
passed += 1;
console.log(`PASS ${passed}: start measurement requires a real not-started to in-progress transition`);

const checkedJourney = {
  ...startedJourney,
  completed_steps: 1,
  schedule: [{ ...startedJourney.schedule[0], completed_at: '2026-08-27T15:00:00.000Z' }],
};
assert.deepEqual(measurementModule.resolveProgramJourneyMeasurements(startedJourney, checkedJourney, {
  action: 'toggle_step', step_id: 'day-1-morning', completed: true,
}).map((event) => event.eventName), ['program_check_in']);
assert.deepEqual(measurementModule.resolveProgramJourneyMeasurements(checkedJourney, checkedJourney, {
  action: 'toggle_step', step_id: 'day-1-morning', completed: true,
}), []);
assert.deepEqual(measurementModule.resolveProgramJourneyMeasurements(checkedJourney, startedJourney, {
  action: 'toggle_step', step_id: 'day-1-morning', completed: false,
}), []);
passed += 1;
console.log(`PASS ${passed}: check-in replay and undo do not inflate retention measurement`);

const finalPrevious = {
  ...startedJourney,
  completed_steps: 7,
  schedule: [{ step_id: 'day-2-evening', day_number: 2, time_key: 'evening', completed_at: null }],
};
const finalNext = {
  ...finalPrevious,
  status: 'completed',
  completed_steps: 8,
  schedule: [{ ...finalPrevious.schedule[0], completed_at: '2026-08-28T23:00:00.000Z' }],
};
assert.deepEqual(measurementModule.resolveProgramJourneyMeasurements(finalPrevious, finalNext, {
  action: 'toggle_step', step_id: 'day-2-evening', completed: true,
}).map((event) => event.eventName), ['program_check_in', 'program_journey_complete']);
assert.deepEqual(measurementModule.resolveProgramJourneyMeasurements(finalNext, finalNext, {
  action: 'toggle_step', step_id: 'day-2-evening', completed: true,
}), []);
passed += 1;
console.log(`PASS ${passed}: final check-in emits one check-in and one completion transition`);

const remindersOff = { ...startedJourney, reminders_enabled: false };
const remindersOn = { ...startedJourney, reminders_enabled: true };
assert.deepEqual(measurementModule.resolveProgramJourneyMeasurements(remindersOff, remindersOn, {
  action: 'set_reminders', reminders_enabled: true,
}).map((event) => event.eventName), ['program_reminder_update']);
assert.deepEqual(measurementModule.resolveProgramJourneyMeasurements(remindersOn, remindersOn, {
  action: 'set_reminders', reminders_enabled: true,
}), []);
passed += 1;
console.log(`PASS ${passed}: reminder measurement requires a persisted state change`);

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
    location: { origin: 'https://nuvirajuice.com', href: 'https://nuvirajuice.com/account/programs', pathname: '/account/programs', search: '', hash: '' },
    history: { replaceState: () => {} },
    dispatchEvent: () => true,
  };
  const documentMock = {
    title: 'NuVira retention test', cookie: '',
    head: { appendChild: (script) => { scripts.set(script.id, script); queueMicrotask(() => script.onload?.()); } },
    createElement: () => ({ dataset: {}, remove() { scripts.delete(this.id); } }),
    getElementById: (id) => scripts.get(id) || null,
  };
  const executable = analytics
    .replace("import { isNativeAppRuntime } from '@/lib/nativeRuntime';", `const isNativeAppRuntime = () => ${native};`)
    .replace(/^export /gm, '')
    + '\nglobalThis.__g145 = { setAnalyticsConsent, trackGoogleRetentionEvent };';
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
  return { api: context.__g145, localStored, windowMock };
}

const webRuntime = analyticsRuntime(false);
assert.equal(webRuntime.api.trackGoogleRetentionEvent('program_journey_start', {
  program_key: 'hydration', program_days: 2, reminders_enabled: true,
}), false, 'retention events must fail closed before consent');
assert.equal(webRuntime.api.setAnalyticsConsent('granted'), true);
assert.equal(webRuntime.api.trackGoogleRetentionEvent('program_journey_start', {
  program_key: 'hydration', program_days: 2, reminders_enabled: true, email: 'customer@example.com', journey_id: 'private',
}), true);
assert.equal(webRuntime.api.trackGoogleRetentionEvent('program_check_in', {
  program_key: 'hydration', program_days: 2, completed_steps: 1, total_steps: 8, day_number: 1, day_period: 'morning', phone: '6366976028',
}), true);
assert.equal(webRuntime.api.trackGoogleRetentionEvent('notification_preferences_update', {
  optional_enabled_count: 3, optional_total_count: 4, program_reminders_enabled: true, customer_email: 'private@example.com',
}), true);
assert.equal(webRuntime.api.trackGoogleRetentionEvent('delivery_area_check', {
  availability_outcome: 'eligible', zone_type: 'core', zip: '63366', zone_name: 'private',
}), true);
assert.equal(webRuntime.api.trackGoogleRetentionEvent('unapproved_event', { value: 'private' }), false);
assert.equal(webRuntime.api.trackGoogleRetentionEvent('program_check_in', {
  program_key: 'hydration', program_days: 9, completed_steps: 99, total_steps: 1, day_number: 8, day_period: 'free-form',
}), false);
assert.equal(webRuntime.api.trackGoogleRetentionEvent('delivery_area_check', null), false);
const emitted = webRuntime.windowMock.dataLayer.map((entry) => Array.from(entry));
const retentionEvents = emitted.filter((entry) => entry[0] === 'event' && GOOGLE_EVENT_NAMES.has(entry[1]));
assert.equal(retentionEvents.length, 4);
const serialized = JSON.stringify(retentionEvents);
for (const privateValue of ['customer@example.com', 'private@example.com', '6366976028', '63366', 'private']) {
  assert.equal(serialized.includes(privateValue), false, `private value leaked: ${privateValue}`);
}
passed += 1;
console.log(`PASS ${passed}: runtime contract is consent gated, allowlisted, and strips identity and ZIP data`);

const nativeRuntime = analyticsRuntime(true);
nativeRuntime.localStored.set('nuvira_analytics_consent_v1', 'granted');
assert.equal(nativeRuntime.api.trackGoogleRetentionEvent('delivery_area_check', {
  availability_outcome: 'eligible', zone_type: 'core',
}), false);
assert.equal(nativeRuntime.windowMock.dataLayer, undefined);
passed += 1;
console.log(`PASS ${passed}: native runtime remains excluded even with stored web consent`);

console.log(`G145 retention measurement coverage: ${passed}/${checks.length + 6} checks passed`);
