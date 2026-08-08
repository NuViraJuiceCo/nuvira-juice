import fs from 'node:fs';

const source = fs.readFileSync('src/components/LowercaseRedirect.jsx', 'utf8');
const tracker = fs.readFileSync('src/pages/OrderTracker.jsx', 'utf8');
const detail = fs.readFileSync('base44/functions/getCustomerOrderDetail/entry.ts', 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(source.includes("'order-tracker'"), 'Order tracker must preserve dynamic identifier case');
assert(source.includes("'order-confirmation'"), 'Order confirmation must preserve dynamic identifier case');
assert(source.includes("'cart'"), 'Cart permalink payload must preserve dynamic identifier case');
assert(source.includes("segments.slice(2).join('/')"), 'Dynamic segments must be copied without lowercasing');
assert(!source.includes('navigate(lower + search + hash'), 'Legacy whole-path lowercase redirect remains');
assert(tracker.includes("rawParam.replace(/^#/, '')"), 'Tracker must pass the preserved route identifier to lookup');
assert(detail.includes(".replace(/^#/, '').toUpperCase()"), 'Backend tracker lookup must normalize order numbers');

console.log(JSON.stringify({
  success: true,
  suite: 'g82-dynamic-url-case-preservation',
  cases: 7,
  writes_performed: false,
  provider_calls_performed: false,
}, null, 2));
