import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_MARKETING_CADENCE_RULES,
  marketingCadenceDecision,
} from '../../base44/functions/customerJourneyAutomation/marketingCadencePolicy.js';
import {
  EVENT_WELCOME_DELAY_HOURS,
  scheduledEventWelcomeConfig,
  scheduledEventWelcomeDecision,
} from '../../base44/functions/customerJourneyAutomation/eventWelcomeTiming.js';

const read = (path) => readFileSync(path, 'utf8');
const journey = read('base44/functions/customerJourneyAutomation/customerJourneyAutomation.ts');
const entry = read('base44/functions/customerJourneyAutomation/entry.ts');
const functionConfig = JSON.parse(read('base44/functions/customerJourneyAutomation/function.jsonc'));
const eventEntity = read('base44/entities/CustomerJourneyEvent.jsonc');
const calendarEventEntity = read('base44/entities/Event.jsonc');
const eventEditor = read('src/pages/admin/AdminEvents.jsx');

assert.match(journey, /event_customer_welcome:\s*'nuvira\.event\.welcome\.ready'/);
assert.match(journey, /event_customer_welcome:\s*\['customer_name', 'event_name', 'event_date', 'event_location', 'mailing_address'\]/);
assert.match(journey, /event_welcome:<event_key>:<normalized_email>|event_welcome:\$\{config\.event_key\}:\$\{email\}/);
assert.match(journey, /orderMatchesVerifiedEvent\(row, config\)/);
assert.match(journey, /event_attribution_status === 'matched'/);
assert.match(journey, /event_welcome_pos_location_required/);
assert.match(journey, /existing_customer_prior_purchase/);
assert.match(journey, /event_welcome_already_recorded/);
assert.match(journey, /promotional_email_consent_missing/);
assert.match(journey, /SEND NUVIRA EVENT WELCOMES/);
assert.match(journey, /currentPolicy\.mode !== 'production'/);
assert.match(journey, /event_welcome_recipient_cap_exceeded/);
assert.match(journey, /event_welcome_send_too_early/);
assert.match(journey, /evaluateScheduledEventWelcomes/);
assert.match(journey, /two_hours_after_event_end/);
assert.match(journey, /eventWelcomePreview/);
assert.match(journey, /eventWelcomeSend/);
assert.match(journey, /Supplement Superstores St\. Peters Customer Appreciation BBQ/);
assert.match(journey, /NuVira - Event Welcome v1/);
assert.match(entry, /'event_welcome_preview'/);
assert.match(entry, /'event_welcome_send'/);
assert.match(eventEntity, /"event_customer_welcome"/);
assert.match(calendarEventEntity, /"end_time"/);
assert.match(calendarEventEntity, /"event_welcome_enabled"/);
assert.match(calendarEventEntity, /"event_welcome_key"/);
assert.match(eventEditor, /Send the event welcome two hours after the event ends/);
const scheduledSweep = functionConfig.automations.find(item => item.type === 'scheduled');
assert.equal(scheduledSweep.is_active, true);
assert.equal(scheduledSweep.repeat_unit, 'minutes');
assert.equal(scheduledSweep.repeat_interval, 15);

assert.equal(EVENT_WELCOME_DELAY_HOURS, 2);
const configuredEvent = {
  id: 'evt_september_12',
  hub_event_id: 'native-september-12-event',
  title: 'September Community Event',
  date: '2026-09-12',
  time: '10:00',
  end_time: '14:00',
  location: 'Wentzville, Missouri',
  shopify_pos_location_id: 'gid://shopify/Location/123456789',
  event_welcome_enabled: true,
  is_active: true,
};
const configured = scheduledEventWelcomeConfig(configuredEvent);
assert.equal(configured.valid, true);
assert.equal(configured.config.window_start.toISOString(), '2026-09-12T15:00:00.000Z');
assert.equal(configured.config.window_end.toISOString(), '2026-09-12T19:00:00.000Z');
assert.equal(configured.config.send_after_at.toISOString(), '2026-09-12T21:00:00.000Z');
assert.equal(scheduledEventWelcomeDecision(configuredEvent, '2026-09-12T20:59:59.000Z').due, false);
assert.equal(scheduledEventWelcomeDecision(configuredEvent, '2026-09-12T21:00:00.000Z').due, true);

const overnight = scheduledEventWelcomeConfig({
  ...configuredEvent,
  id: 'evt_overnight',
  hub_event_id: 'native-overnight-event',
  time: '20:00',
  end_time: '01:00',
});
assert.equal(overnight.valid, true);
assert.equal(overnight.config.window_end.toISOString(), '2026-09-13T06:00:00.000Z');
assert.equal(overnight.config.send_after_at.toISOString(), '2026-09-13T08:00:00.000Z');

const nowMs = Date.parse('2026-08-22T20:00:00.000Z');
assert.deepEqual(marketingCadenceDecision({
  email: 'newcustomer@example.net',
  eventName: 'event_customer_welcome',
  recentEvents: [],
  recentTransactionalMessages: [],
  nowMs,
  rules: DEFAULT_MARKETING_CADENCE_RULES,
}), { allowed: true, reason: 'eligible_within_cadence' });

assert.deepEqual(marketingCadenceDecision({
  email: 'newcustomer@example.net',
  eventName: 'event_customer_welcome',
  recentEvents: [{
    event_name: 'loyalty_joined',
    resend_status: 'accepted',
    resend_forwarded_at: '2026-08-22T19:00:00.000Z',
  }],
  recentTransactionalMessages: [],
  nowMs,
  rules: DEFAULT_MARKETING_CADENCE_RULES,
}), { allowed: false, reason: 'recipient_marketing_cooldown' });

console.log('G118 event welcome tests passed');
