import assert from 'node:assert/strict';
import {
  EVENT_DISPLAY_TIME_TBD,
  eventStructuredDateTimes,
  isBroadOperationalWindow,
  resolveEventTimeSemantics,
} from '../../src/lib/eventTimeSemantics.js';

function display(event) {
  return resolveEventTimeSemantics(event).displayTime;
}

function semantics(event) {
  return resolveEventTimeSemantics(event);
}

// 1. Explicit start/end event displays exact time range.
assert.equal(display({ date: '2026-07-04', start_time: '10:00', end_time: '14:30' }), '10:00 AM – 2:30 PM');
assert.equal(semantics({ date: '2026-07-04', start_time: '10:00', end_time: '14:30' }).source, 'explicit_start_end');

// 2. Explicit start-only event displays start only.
assert.equal(display({ date: '2026-07-04', start_time: '13:15' }), '1:15 PM');
assert.equal(semantics({ date: '2026-07-04', start_time: '13:15' }).source, 'explicit_start');

// 3. Date-only/all-day event does not display 7am-7pm.
assert.equal(display({ date: '2026-07-04', all_day: true, time: '7am-7pm' }), 'All day');
assert.notEqual(display({ date: '2026-07-04', all_day: true, time: '7am-7pm' }), '7am-7pm');

// 4. Missing time event displays safe no-time copy.
assert.equal(display({ date: '2026-07-04' }), EVENT_DISPLAY_TIME_TBD);
assert.equal(semantics({ date: '2026-07-04' }).source, 'missing_time');

// 5. Existing broad operational window is not treated as event time.
for (const value of ['7am-7pm', '7 AM - 7 PM', '7:00 AM – 7:00 PM', '07:00-19:00', 'business hours']) {
  assert.equal(isBroadOperationalWindow(value), true, `${value} should be broad operational window`);
  assert.equal(display({ date: '2026-07-04', time: value }), EVENT_DISPLAY_TIME_TBD, `${value} should not display as event time`);
}

// 6. America/Chicago display is stable for explicit UTC datetimes.
assert.equal(display({ date: '2026-07-04', start_datetime: '2026-07-04T15:00:00.000Z', timezone: 'America/Chicago' }), '10:00 AM');
assert.equal(semantics({ date: '2026-07-04', start_datetime: '2026-07-04T15:00:00.000Z' }).timeZone, 'America/Chicago');

// 7. Admin/customer shared formatter remains compatible with labels.
assert.equal(display({ date: '2026-07-04', time_label: '11am-1pm' }), '11:00 AM – 1:00 PM');
assert.equal(display({ date: '2026-07-04', display_time: 'Pop-up hours TBD' }), 'Pop-up hours TBD');

// 8. Hub fallback event with missing time does not invent time.
assert.equal(display({ hub_event_id: 'hub_evt_1', title: 'Hub Event', date: '2026-07-04', time: '' }), EVENT_DISPLAY_TIME_TBD);
assert.equal(display({ hub_event_id: 'hub_evt_2', title: 'Hub Event', date: '2026-07-04', time: '7:00 AM - 7:00 PM' }), EVENT_DISPLAY_TIME_TBD);

// Structured data should not invent an end date for date-only or ambiguous records.
assert.deepEqual(
  eventStructuredDateTimes({ date: '2026-07-04', time: '7am-7pm' }),
  {
    startDate: '2026-07-04',
    endDate: undefined,
    timeZone: 'America/Chicago',
    semantics: resolveEventTimeSemantics({ date: '2026-07-04', time: '7am-7pm' }),
  },
);
assert.equal(eventStructuredDateTimes({ date: '2026-07-04', time: '11am-1pm' }).startDate, '2026-07-04T11:00:00');
assert.equal(eventStructuredDateTimes({ date: '2026-07-04', time: '11am-1pm' }).endDate, '2026-07-04T13:00:00');

// 9-13. No PII/raw payload/write/provider/notification paths are introduced by the formatter contract.
const safe = semantics({ date: '2026-07-04', time: '7am-7pm', customer_identifier: 'redacted-customer', opaque_context: { source: 'x' } });
assert.deepEqual(Object.keys(safe).sort(), ['allDay', 'ambiguousTime', 'displayTime', 'hasReliableTime', 'source', 'timeZone'].sort());
assert.equal('writes_performed' in safe, false);
assert.equal('notifications_sent' in safe, false);
assert.equal('provider_calls' in safe, false);

console.log(JSON.stringify({ suite: 'g40b-event-time-semantics', tests_passed: 14 }));
