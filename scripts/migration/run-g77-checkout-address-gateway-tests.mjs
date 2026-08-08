import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const client = read('src/api/base44Client.js');
const checkout = read('src/pages/Checkout.jsx');
const autocomplete = read('src/components/AddressAutocomplete.jsx');

assert.match(client, /export const invokeCustomerGateway/);
assert.match(client, /base44\.functions\.fetch\(gateway/);
assert.match(client, /JSON\.stringify\(\{ gateway_action: action, payload \}\)/);
assert.match(client, /'X-App-Id': appParams\.appId/);

assert.match(checkout, /invokeCustomerGateway\('validateDeliveryEligibility'/);
assert.doesNotMatch(checkout, /base44\.functions\.invoke\('validateDeliveryEligibility'/);
assert.match(checkout, /const eligibility = res\?\.data \|\| res/);
assert.match(checkout, /typeof eligibility\.checkout_allowed !== 'boolean'/);
assert.match(checkout, /role="alert">\{addressValidationError\}/);

assert.match(autocomplete, /invokeCustomerGateway\('addressSuggest'/);
assert.doesNotMatch(autocomplete, /base44\.functions\.invoke\('addressSuggest'/);
assert.match(autocomplete, /Google-verified address suggestions/);
assert.match(autocomplete, /Start typing and select a Google-verified address/);
assert.match(autocomplete, /onFocus=\{\(\) => \{/);

console.log(JSON.stringify({
  ok: true,
  suite: 'g77-checkout-address-gateway',
  cases: 12,
  live_writes_performed: false,
  provider_calls_performed: false,
  payment_actions_performed: false,
}, null, 2));
