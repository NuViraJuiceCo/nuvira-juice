import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_MARKETING_CADENCE_RULES,
  marketingCadenceDecision,
} from '../../base44/functions/customerJourneyAutomation/marketingCadencePolicy.js';

const read = (path) => readFileSync(path, 'utf8');
const journey = read('base44/functions/customerJourneyAutomation/customerJourneyAutomation.ts');
const entry = read('base44/functions/customerJourneyAutomation/entry.ts');
const eventEntity = read('base44/entities/CustomerJourneyEvent.jsonc');

assert.match(journey, /event_customer_welcome:\s*'nuvira\.event\.welcome'/);
assert.match(journey, /event_customer_welcome:\s*\['customer_name', 'event_name', 'event_date', 'event_location', 'mailing_address'\]/);
assert.match(journey, /event_welcome:<event_key>:<normalized_email>|event_welcome:\$\{config\.event_key\}:\$\{email\}/);
assert.match(journey, /isPosEventOrder\(row\) && paidCommerceOrder\(row\) && orderWithinEventWindow/);
assert.match(journey, /existing_customer_prior_purchase/);
assert.match(journey, /event_welcome_already_recorded/);
assert.match(journey, /promotional_email_consent_missing/);
assert.match(journey, /SEND NUVIRA EVENT WELCOMES/);
assert.match(journey, /currentPolicy\.mode !== 'production'/);
assert.match(journey, /event_welcome_recipient_cap_exceeded/);
assert.match(journey, /eventWelcomePreview/);
assert.match(journey, /eventWelcomeSend/);
assert.match(journey, /Supplement Superstores St\. Peters Customer Appreciation BBQ/);
assert.match(journey, /NuVira - Event Welcome v1/);
assert.match(entry, /'event_welcome_preview'/);
assert.match(entry, /'event_welcome_send'/);
assert.match(eventEntity, /"event_customer_welcome"/);

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
