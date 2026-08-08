import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const handlerPath = path.join(root, 'base44/functions/getCustomerAccountDashboardData/handlers/getOrderBySession/entry.ts');
const source = fs.readFileSync(handlerPath, 'utf8');

assert.match(source, /isPlausibleStripeSessionId\(session_id\)/, 'Malformed session ids must be rejected before Stripe lookup.');
assert.match(source, /\^cs_/, 'Stripe Checkout Session ids must be shape-validated.');
assert.match(source, /isStripeMissingResource\(e\)/, 'Stripe resource-missing errors need an explicit customer-safe boundary.');
assert.match(source, /found:\s*false[\s\S]*session_status:\s*null[\s\S]*payment_status:\s*null/, 'A missing session must resolve to a stable not-found payload.');
assert.match(source, /Unable to verify checkout session[^\n]+status:\s*502/, 'True provider outages must be separated from missing sessions.');
assert.doesNotMatch(source, /Failed to fetch session from Stripe[^\n]+status:\s*500/, 'The old generic customer-facing 500 path must remain removed.');

console.log(JSON.stringify({
  ok: true,
  suite: 'g76-order-session-error-boundary',
  cases: 6,
  writes_performed: false,
  provider_calls_performed: false,
  customer_notifications_sent: false,
}, null, 2));
