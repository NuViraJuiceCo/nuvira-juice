#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const results = [];
const pass = (name) => results.push(name);

const catalog = await import(`${pathToFileURL(path.join(root, 'src/lib/program-catalog.js')).href}?g103=${Date.now()}`);
assert.equal(catalog.PROGRAMS.length, 3);
assert.equal(catalog.DAILY_PROGRAM_SCHEDULES.hydration.length, 4);
assert.deepEqual(catalog.DAILY_PROGRAM_SCHEDULES.hydration.map((slot) => slot.product), ['OASIS', 'AURA', 'OASIS', 'OASIS']);
pass('catalog_has_three_programs_and_authoritative_daily_compositions');

const hydration = catalog.PROGRAM_BY_KEY.hydration;
const hydrationPaletteText = JSON.stringify(hydration.palette).toLowerCase();
for (const forbidden of ['aqua', 'cyan', 'coral', 'blue']) assert.equal(hydrationPaletteText.includes(forbidden), false);
assert.match(hydration.palette.primary, /^#[0-9a-f]{6}$/i);
assert.match(hydration.description, /OASIS-forward routine/i);
pass('hydration_uses_premium_juice_led_palette_not_generic_aqua_coral');

const claimsText = catalog.PROGRAMS.map((program) => `${program.tagline} ${program.description}`).join(' ').toLowerCase();
for (const prohibited of ['reduce inflammation', 'cellular repair', 'reduce bloating', 'detox', 'cure', 'treat disease']) {
  assert.equal(claimsText.includes(prohibited), false, `unsubstantiated outcome claim remains: ${prohibited}`);
}
pass('program_marketing_copy_avoids_unsubstantiated_health_outcomes');

const handlerPath = 'base44/functions/getCustomerAccountDashboardData/handlers/manageProgramJourney/entry.ts';
let handlerSource = read(handlerPath)
  .replace(/^import .*?;\s*$/m, '')
  .replace('export default async function handler', 'async function handler');
handlerSource += '\n;globalThis.__g103 = { handler, descriptorsForOrder, buildSchedule, freshnessState, paidDeliveredOrder, programForItem };';
handlerSource = ts.transpileModule(handlerSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const sandbox = { console, Date, Intl, Object, Array, Map, Set, Math, Number, String, Boolean, RegExp, Promise, JSON, Request, Response, crypto, encodeURIComponent, Deno: { env: { get: (name) => name === 'ENABLE_PROGRAM_JOURNEY_REMINDERS' ? 'true' : undefined } } };
vm.createContext(sandbox);
vm.runInContext(handlerSource, sandbox, { filename: handlerPath });
const logic = sandbox.__g103;

const order = {
  id: 'order-g103',
  order_number: 'NV-G103',
  customer_email: 'customer@example.com',
  payment_captured: true,
  payment_status: 'paid',
  status: 'delivered',
  delivered_at: '2026-08-09T18:00:00.000Z',
  items: [{ product_id: 'program_hydration', title: 'Hydration Program (3-Day)', quantity: 1, image_url: hydration.image, category: 'bundle' }],
};
assert.equal(logic.paidDeliveredOrder(order), true);
const [descriptor] = logic.descriptorsForOrder(order, '2026-08-15');
assert.equal(descriptor.delivered_date, '2026-08-09');
assert.equal(descriptor.quality_target_date, '2026-08-13');
assert.equal(descriptor.use_by_date, '2026-08-15');
assert.equal(descriptor.latest_start_date, '2026-08-13');
assert.equal(descriptor.use_by_source, 'production_batch');
pass('batch_use_by_overrides_estimate_with_five_day_quality_and_seven_day_outer_logic');

const estimated = logic.descriptorsForOrder(order, null)[0];
assert.equal(estimated.use_by_date, '2026-08-15');
assert.equal(estimated.use_by_source, 'delivery_estimate');
assert.equal(estimated.latest_start_date, '2026-08-13');
pass('delivery_fallback_uses_typical_five_to_seven_day_refrigerated_window');

const schedule = logic.buildSchedule(descriptor, '2026-08-11');
assert.equal(schedule.length, 12);
assert.equal(schedule[0].date, '2026-08-11');
assert.equal(schedule[11].date, '2026-08-13');
assert.deepEqual(Array.from(schedule.slice(0, 4), (step) => step.product_name), ['OASIS', 'AURA', 'OASIS', 'OASIS']);
assert.equal(schedule.every((step) => step.completed_at === null), true);
pass('three_day_schedule_has_twelve_uncompleted_customer_checkins');

const runtimeTodayParts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
}).formatToParts(new Date()).map((part) => [part.type, part.value]));
const runtimeToday = `${runtimeTodayParts.year}-${runtimeTodayParts.month}-${runtimeTodayParts.day}`;
const runtimeUseBy = new Date(`${runtimeToday}T12:00:00.000Z`);
runtimeUseBy.setUTCDate(runtimeUseBy.getUTCDate() + 6);
const runtimeUseByKey = runtimeUseBy.toISOString().slice(0, 10);
const liveOrder = {
  ...order,
  id: 'order-live-g103',
  delivered_at: `${runtimeToday}T18:00:00.000Z`,
  assigned_production_day: runtimeToday,
};
let storedJourneys = [];
const fakeEntities = {
  UserProfile: { filter: async () => [] },
  Order: { filter: async () => [liveOrder] },
  ProductionBatch: { filter: async () => [{ id: 'batch-g103', production_date: runtimeToday, use_by_date: runtimeUseByKey, is_test_batch: false, order_sources: [{ order_id: liveOrder.id }] }] },
  ProgramJourney: {
    filter: async (filter) => storedJourneys.filter((row) => !filter?.customer_email || row.customer_email === filter.customer_email),
    create: async (payload) => {
      const row = { ...payload, id: 'journey-live-g103' };
      storedJourneys.push(row);
      return row;
    },
    update: async (id, updates) => {
      const index = storedJourneys.findIndex((row) => row.id === id);
      storedJourneys[index] = { ...storedJourneys[index], ...updates };
      return storedJourneys[index];
    },
  },
};
const fakeBase44 = {
  auth: { me: async () => ({ email: 'customer@example.com', role: 'user' }) },
  asServiceRole: { entities: fakeEntities },
};
sandbox.createClientFromRequest = () => fakeBase44;
const invokeHandler = async (payload) => {
  const response = await logic.handler(new Request('https://example.test/functions/manageProgramJourney', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
  }));
  return { status: response.status, body: await response.json() };
};
const listResult = await invokeHandler({ action: 'list' });
assert.equal(listResult.status, 200);
assert.equal(listResult.body.journeys.length, 1);
const liveJourneyKey = listResult.body.journeys[0].journey_key;
const startResult = await invokeHandler({ action: 'start', journey_id: liveJourneyKey, start_date: runtimeToday, reminders_enabled: true, command_id: 'g103-start' });
assert.equal(startResult.status, 200);
assert.equal(startResult.body.journey.status, 'in_progress');
assert.equal(startResult.body.journey.schedule.length, 12);
const stepResult = await invokeHandler({ action: 'toggle_step', journey_id: liveJourneyKey, step_id: 'day-1-morning', completed: true, command_id: 'g103-step' });
assert.equal(stepResult.status, 200);
assert.equal(stepResult.body.journey.completed_steps, 1);
const replayResult = await invokeHandler({ action: 'toggle_step', journey_id: liveJourneyKey, step_id: 'day-1-morning', completed: true, command_id: 'g103-step' });
assert.equal(replayResult.body.idempotent_replay, true);
assert.equal(replayResult.body.journey.completed_steps, 1);
pass('gateway_start_and_checkin_commands_are_owned_validated_and_idempotent');

const entity = JSON.parse(read('base44/entities/ProgramJourney.jsonc'));
assert.equal(entity.rls.read.user_condition.role, 'admin');
assert.equal(entity.rls.create.user_condition.role, 'admin');
assert.equal(entity.rls.update.user_condition.role, 'admin');
assert.ok(entity.properties.use_by_date);
assert.ok(entity.properties.quality_target_date);
pass('program_journey_records_are_gateway_only_and_store_freshness_provenance');

const gateway = read('base44/functions/getCustomerAccountDashboardData/entry.ts');
const client = read('src/api/base44Client.js');
assert.match(gateway, /manageProgramJourney/);
assert.match(gateway, /g103-premium-program-journey/);
assert.match(client, /'manageProgramJourney'/);
assert.equal(fs.existsSync(path.join(root, 'base44/functions/manageProgramJourney')), false);
pass('journey_uses_existing_customer_gateway_without_consuming_function_slot');

const page = read('src/pages/ProgramJourney.jsx');
for (const marker of ['40°F or below', 'more than 2 hours', 'more than 1 hour', 'printed on each bottle', 'not medical advice']) {
  assert.match(page, new RegExp(marker.replace(/[°]/g, '°')));
}
assert.match(page, /5–7 day refrigerated shelf life/);
assert.match(page, /future_program_step_cannot_be_completed/);
pass('customer_experience_includes_storage_time_temperature_label_and_wellness_guardrails');

const notifications = read('base44/functions/sendCustomerNotification/entry.ts');
const alwaysSendBody = notifications.match(/const ALWAYS_SEND = new Set\(\[([\s\S]*?)\]\);/)?.[1] || '';
const elevatedBody = notifications.match(/const ELEVATED_TRANSACTIONAL_SUBTYPES = new Set\(\[([\s\S]*?)\]\);/)?.[1] || '';
assert.equal(alwaysSendBody.includes('program_reminder'), false);
assert.equal(elevatedBody.includes('program_reminder'), true);
assert.match(notifications, /program_reminder:\s+'program_reminders'/);
const automation = read('base44/functions/customerJourneyAutomation/customerJourneyAutomation.ts');
assert.match(automation, /ENABLE_PROGRAM_JOURNEY_REMINDERS/);
assert.match(automation, /program_reminder:\$\{journey\.id\}:\$\{clock\.date\}/);
assert.match(automation, /clock\.hour < 8 \|\| clock\.hour >= 20/);
pass('program_reminders_are_opt_in_preference_aware_daily_idempotent_and_quiet_hours_aware');

const elevated = read('base44/functions/sendOrderStatusNotification/elevatedTransactionalCommunications.ts');
const fallback = read('base44/functions/sendOrderStatusNotification/entry.ts');
assert.match(elevated, /event === 'delivered' && orderContainsProgram\(order\)/);
assert.match(fallback, /new_status === 'delivered' && orderContainsProgram\(fullOrderForRouting\)/);
assert.match(elevated, /'\/account\/programs'/);
pass('delivered_program_notifications_deep_link_into_program_journeys');

const app = read('src/App.jsx');
const home = read('src/pages/Home.jsx');
const account = read('src/pages/Account.jsx');
const tracker = read('src/pages/OrderTracker.jsx');
assert.match(app, /path="\/account\/programs\/:id"/);
assert.match(home, /ActiveProgramJourneyCard/);
assert.match(account, /My Program Journeys/);
assert.match(tracker, /Open My Program Journey/);
pass('journey_has_home_account_order_tracker_and_protected_detail_entry_points');

console.log(JSON.stringify({
  ok: true,
  suite: 'g103-premium-program-journey',
  checks: results.length,
  writes_performed: false,
  provider_calls_performed: false,
  results,
}, null, 2));
