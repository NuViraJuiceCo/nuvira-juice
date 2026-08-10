#!/usr/bin/env node
import fs from 'node:fs';

const eventsPage = fs.readFileSync('src/pages/Events.jsx', 'utf8');
const adminEvents = fs.readFileSync('src/pages/admin/AdminEvents.jsx', 'utf8');
const eventHandler = fs.readFileSync('base44/functions/getAdminOperationsDashboardSummary/handlers/getAdminCalendarEventsSummary/entry.ts', 'utf8');
const eventSchema = fs.readFileSync('base44/entities/Event.jsonc', 'utf8');

const checks = [
  ['Customer events are sourced from active Event records.', eventsPage.includes("base44.entities.Event.filter({ is_active: true }, 'date', 50)")],
  ['Customer event cards derive category from explicit fields or tags.', eventsPage.includes('function eventCategory(event = {})') && eventsPage.includes('event.tags')],
  ['Customer event cards retain a visible category fallback.', eventsPage.includes("|| 'Community';") && eventsPage.includes('{category}')],
  ['Admin event rows expose the stored category.', adminEvents.includes('const category = event.type || event.event_type') && adminEvents.includes('label={category}')],
  ['Admin event editor persists the selected category through tags.', adminEvents.includes('Category') && adminEvents.includes("setField('tags', [e.target.value, ...form.tags.slice(1)])")],
  ['Admin event mutations accept bounded tags.', eventHandler.includes('event.tags.map') && eventHandler.includes('.slice(0, 12)')],
  ['Public event venue addresses use the location-specific sanitizer.', eventHandler.includes('location: sanitizePublicLocation(event.location, 240)') && eventHandler.includes('location: sanitizePublicLocation(item?.location, 120)')],
  ['Public event locations still redact contact and secret-like values.', eventHandler.includes('function sanitizePublicLocation') && eventHandler.includes(".replace(/\\b(?:bearer|authorization|token|secret|api[_-]?key)")],
  ['General sanitization retains street-address redaction outside public event locations.', eventHandler.includes('(?:st|street|ave|avenue|rd|road|dr|drive|ln|lane|blvd|boulevard|way|ct|court|pl|place)')],
  ['Admin event creation remains audited and idempotent.', eventHandler.includes('createEventAudit') && eventHandler.includes('duplicate_request_id')],
  ['Admin event creation performs no provider call or customer notification.', eventHandler.includes('provider_call_impact: false') && eventHandler.includes('notifications_sent: false')],
  ['Event reads remain public while writes remain admin-only.', eventSchema.includes('"read": {}') && (eventSchema.match(/"role": "admin"/g) || []).length >= 3],
];

const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);
if (failed.length) {
  console.error(JSON.stringify({ suite: 'g105-event-publishing', ok: false, failed }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  suite: 'g105-event-publishing',
  ok: true,
  tests_passed: checks.length,
  writes_performed: false,
  provider_calls_performed: false,
}, null, 2));
