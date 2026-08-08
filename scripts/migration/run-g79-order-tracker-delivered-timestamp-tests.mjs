import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../../src/pages/OrderTracker.jsx', import.meta.url), 'utf8');

assert.match(
  source,
  /deliveryStatus\?\.delivered_at\s*\|\|\s*order\?\.delivered_at\s*\|\|\s*displayOrder\.delivered_at\s*\|\|\s*deliveredTimelineTimestamp/,
  'Delivered tracker timestamp must fall back through the authoritative order and delivered timeline.',
);
assert.match(source, /status_timeline[\s\S]*entry\?\.status === 'delivered'/, 'Delivered status history must be a timestamp fallback.');
assert.match(
  source,
  /formatDeliveredAt\([\s\S]*order\?\.assigned_delivery_date\s*\|\|\s*displayOrder\.estimated_delivery_date/,
  'Scheduled delivery remains only the final display fallback.',
);

console.log('G79 order tracker delivered timestamp tests passed.');
