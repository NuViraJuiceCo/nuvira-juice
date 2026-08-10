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
assert.deepEqual(catalog.PROGRAM_BY_KEY.radiance.durationOptions.map(({ days, bottles, price }) => ({ days, bottles, price })), [
  { days: 2, bottles: 8, price: 104 },
  { days: 3, bottles: 12, price: 144 },
]);
assert.deepEqual(catalog.PROGRAM_BY_KEY.hydration.durationOptions[0].bundleComposition.map(({ product_name, quantity }) => ({ product_name, quantity })), [
  { product_name: 'OASIS', quantity: 6 },
  { product_name: 'AURA', quantity: 2 },
]);
assert.deepEqual(catalog.PROGRAM_BY_KEY.reset.durationOptions.map((option) => option.days), [3]);
assert.equal(catalog.PROGRAM_BY_KEY.radiance.shotPairing.title, 'Radiance Shot');
assert.equal(catalog.PROGRAM_BY_KEY.hydration.shotPairing.title, 'Hydration Shot');
assert.equal(catalog.PROGRAM_BY_KEY.reset.shotPairing.title, 'Reset Shot');
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

const publicProducts = read('src/lib/public-products.js').toLowerCase();
for (const prohibited of ['brighten skin', 'boost energy', 'optimize performance', 'clear the body', 'detox-forward']) {
  assert.equal(publicProducts.includes(prohibited), false, `unsupported wellness-shot outcome claim remains: ${prohibited}`);
}
pass('wellness_shot_copy_is_ingredient_led_and_claim_safe');

const celebrations = await import(`${pathToFileURL(path.join(root, 'src/lib/program-celebration.js')).href}?g103=${Date.now()}`);
const rewardJourney = {
  program_name: 'Hydration', status: 'in_progress', completed_steps: 5, total_steps: 12,
  schedule: [{ step_id: 'day-2-morning', product_name: 'OASIS' }],
};
const stepReward = celebrations.createProgramCelebration({ journey: rewardJourney, stepId: 'day-2-morning', completed: true, commandId: 'reward-step-1' });
assert.equal(stepReward.kind, 'step_complete');
assert.equal(stepReward.title, 'Good job!');
assert.match(stepReward.message, /OASIS is checked off/);
assert.equal(celebrations.createProgramCelebration({ journey: rewardJourney, stepId: 'day-2-morning', completed: true, commandId: 'reward-step-1', lastCelebratedCommandId: 'reward-step-1' }), null);
assert.equal(celebrations.createProgramCelebration({ journey: rewardJourney, stepId: 'day-2-morning', completed: false, commandId: 'reward-undo' }), null);
const completionReward = celebrations.createProgramCelebration({ journey: { ...rewardJourney, status: 'completed', completed_steps: 12 }, stepId: 'day-3-evening', completed: true, commandId: 'reward-finish' });
assert.equal(completionReward.kind, 'program_complete');
assert.equal(completionReward.title, 'You did it.');
pass('successful_checkins_receive_idempotent_step_and_program_completion_rewards');

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

const expectedDailyProducts = {
  radiance: ['AURA', 'OASIS', 'AURA', 'AURA'],
  hydration: ['OASIS', 'AURA', 'OASIS', 'OASIS'],
  reset: ['RE-NU', 'OASIS', 'RE-NU', 'RE-NU'],
};
for (const program of catalog.PROGRAMS) {
  const programOrder = {
    ...order,
    id: `order-${program.key}`,
    items: [{ product_id: `program_${program.key}`, title: `${program.name} Program (3-Day)`, quantity: 1, category: 'bundle' }],
  };
  const programDescriptor = logic.descriptorsForOrder(programOrder, '2026-08-15')[0];
  assert.equal(programDescriptor.program_key, program.key);
  const programSchedule = logic.buildSchedule(programDescriptor, '2026-08-11');
  assert.equal(programSchedule.length, 12);
  assert.deepEqual(Array.from(programSchedule.slice(0, 4), (step) => step.product_name), expectedDailyProducts[program.key]);
}
pass('radiance_hydration_and_reset_each_build_their_correct_twelve_step_schedule');

for (const programKey of ['radiance', 'hydration']) {
  const twoDayOrder = {
    ...order,
    id: `order-${programKey}-2day`,
    items: [{
      product_id: `program_${programKey}_2day`,
      title: `${catalog.PROGRAM_BY_KEY[programKey].name} Program (2-Day)`,
      program_key: programKey,
      program_days: 2,
      quantity: 1,
      category: 'bundle',
    }],
  };
  const twoDayDescriptor = logic.descriptorsForOrder(twoDayOrder, '2026-08-15')[0];
  assert.equal(twoDayDescriptor.program_days, 2);
  assert.equal(twoDayDescriptor.latest_start_date, '2026-08-13');
  const twoDaySchedule = logic.buildSchedule(twoDayDescriptor, '2026-08-12');
  assert.equal(twoDaySchedule.length, 8);
  assert.equal(twoDaySchedule.at(-1).step_id, 'day-2-evening');
  assert.deepEqual(Array.from(twoDaySchedule.slice(0, 4), (step) => step.product_name), expectedDailyProducts[programKey]);
}
const invalidResetDuration = logic.programForItem({ product_id: 'program_reset_2day', title: 'Reset Program (2-Day)', program_days: 2 });
assert.equal(invalidResetDuration.days, 3);
pass('two_day_radiance_and_hydration_build_eight_steps_while_reset_remains_three_day_only');

const pairedOrder = {
  ...order,
  id: 'order-g103-tailored-pairings',
  items: [
    { product_id: 'program_radiance_2day', title: 'Radiance Program (2-Day)', program_key: 'radiance', program_days: 2, quantity: 1, category: 'bundle' },
    { product_id: 'program_hydration_2day', title: 'Hydration Program (2-Day)', program_key: 'hydration', program_days: 2, quantity: 1, category: 'bundle' },
    { product_id: 'radiance-shot', title: 'Radiance Shot', quantity: 2, category: 'shot', program_addon_for: 'radiance', program_addon_days: 2 },
    { product_id: 'hydration-shot', title: 'Hydration Shot', quantity: 2, category: 'shot', program_addon_for: 'hydration', program_addon_days: 2 },
  ],
};
const pairedDescriptors = logic.descriptorsForOrder(pairedOrder, null);
const radiancePairing = pairedDescriptors.find((descriptor) => descriptor.program_key === 'radiance');
const hydrationPairing = pairedDescriptors.find((descriptor) => descriptor.program_key === 'hydration');
assert.deepEqual(Array.from(radiancePairing.morning_shots), ['Radiance Shot', 'Radiance Shot']);
assert.deepEqual(Array.from(hydrationPairing.morning_shots), ['Hydration Shot', 'Hydration Shot']);
assert.deepEqual(
  Array.from(logic.buildSchedule(radiancePairing, '2026-08-12').filter((step) => step.time_key === 'morning'), (step) => step.morning_shot_name),
  ['Radiance Shot', 'Radiance Shot'],
);
assert.deepEqual(
  Array.from(logic.buildSchedule(hydrationPairing, '2026-08-12').filter((step) => step.time_key === 'morning'), (step) => step.morning_shot_name),
  ['Hydration Shot', 'Hydration Shot'],
);
pass('wellness_shot_quantities_remain_associated_with_the_program_the_customer_selected');

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
assert.deepEqual(entity.properties.program_days.enum, [2, 3]);
pass('program_journey_records_are_gateway_only_and_store_freshness_provenance');

const checkout = read('base44/functions/createPaymentIntent/entry.ts');
assert.match(checkout, /program_\$\{programKey\}_\$\{programDays\}day/);
assert.match(checkout, /program_schedule_version: PROGRAM_SCHEDULE_VERSION/);
assert.match(checkout, /bundle_composition: option\.composition/);
assert.match(checkout, /items: normalizedItems/);
assert.match(checkout, /program_addon_for: addonProgramKey/);
assert.match(checkout, /program_addon_days: addonDays/);
pass('checkout_persists_canonical_duration_formula_and_schedule_metadata_for_each_program_order');

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
for (const marker of ['AnimatePresence', 'useReducedMotion', 'aria-live="polite"', "previewCelebration === 'complete'", "previewCelebration === 'step'"]) assert.match(page, new RegExp(marker));
assert.match(page, /previewProgramKey/);
pass('customer_experience_includes_storage_time_temperature_label_and_wellness_guardrails');

assert.match(page, /resolveOrderItemImage\(\{ title: step\.product_name/);
assert.match(page, /resolveOrderItemImage\(\{ title: step\.morning_shot_name/);
assert.match(page, /alt=\{`\$\{step\.product_name\} bottle`\}/);
assert.match(page, /Suggested · \$\{step\.suggested_time\} CT/);
assert.match(page, /formatCheckinTimestamp\(step\.completed_at\)/);
assert.match(page, /Checked \$\{checkinTimestamp \|\| 'in'\} · Tap to undo/);
pass('checklist_uses_current_product_and_shot_images_with_clear_suggested_and_recorded_times');

const programDetail = read('src/pages/ProgramDetail.jsx');
const consumptionSchedule = read('src/components/program/ConsumptionSchedule.jsx');
const cartContext = read('src/lib/cartContext.jsx');
assert.match(programDetail, /Build Your Daily Shot Pairing/);
assert.match(programDetail, /Best match/);
assert.match(programDetail, /program_addon_for: program\.key/);
assert.match(programDetail, /program_addon_days: selectedOption\.days/);
assert.match(programDetail, /\[recommendedShot\.id\]: selectedOption\.days/);
assert.match(programDetail, /FALLBACK_WELLNESS_SHOTS/);
assert.match(programDetail, /placeholderData: FALLBACK_WELLNESS_SHOTS/);
assert.match(consumptionSchedule, /Your morning shot plan/);
assert.match(consumptionSchedule, /Day \{index \+ 1\} · \{name\}/);
assert.match(cartContext, /extra\.cart_line_key \|\| product\.id/);
pass('program_detail_supports_repeat_daily_pairings_mixed_shots_and_distinct_cart_lines');

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
const dashboardGateway = read('base44/functions/getCustomerAccountDashboardData/entry.ts');
assert.match(elevated, /event === 'delivered' && orderContainsProgram\(order\)/);
assert.match(fallback, /new_status === 'delivered' && orderContainsProgram\(fullOrderForRouting\)/);
assert.match(elevated, /'\/account\/programs'/);
pass('delivered_program_notifications_deep_link_into_program_journeys');

assert.match(fallback, /authoritativeOrder\?\.is_test_order === true/);
assert.match(fallback, /test_order_customer_communications_suppressed/);
assert.ok(
  fallback.indexOf('test_order_customer_communications_suppressed') < fallback.indexOf('if (elevatedTransactionalEnabled())'),
  'marked sandbox orders must be suppressed before any elevated or fallback communication path',
);
assert.match(dashboardGateway, /g104-program-shot-pairing-and-sandbox-safety-20260810/);
pass('marked_test_orders_are_suppressed_before_customer_communications');

const app = read('src/App.jsx');
const home = read('src/pages/Home.jsx');
const account = read('src/pages/Account.jsx');
const tracker = read('src/pages/OrderTracker.jsx');
const journeyState = read('src/lib/program-journey-state.js');
const mobileNav = read('src/components/layout/MobileNav.jsx');
const sideNav = read('src/components/layout/SideNav.jsx');
assert.match(app, /path="\/account\/programs\/:id"/);
assert.match(home, /ActiveProgramJourneyCard/);
assert.match(account, /My Program Journeys/);
assert.match(account, /label: 'Rewards', path: '\/rewards'/);
assert.match(tracker, /Open My Program Journey/);
pass('journey_has_home_account_order_tracker_and_protected_detail_entry_points');

assert.match(journeyState, /row\.status === 'in_progress'/);
assert.match(journeyState, /row\.status === 'ready'/);
assert.match(mobileNav, /label: 'Journey'/);
assert.match(mobileNav, /location\.pathname\.startsWith\('\/account\/programs'\)/);
assert.match(sideNav, /label: 'My Journey'/);
assert.match(sideNav, /location\.pathname\.startsWith\('\/account\/programs'\)/);
pass('active_or_ready_journey_remains_persistently_discoverable_on_mobile_and_desktop_navigation');

console.log(JSON.stringify({
  ok: true,
  suite: 'g103-premium-program-journey',
  checks: results.length,
  writes_performed: false,
  provider_calls_performed: false,
  results,
}, null, 2));
