#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const results = [];

function loadStandaloneRetirementHandler() {
  const source = read('base44/functions/syncCustomerToHub/entry.ts');
  let handler = null;
  vm.runInContext(source, vm.createContext({
    Response,
    Deno: { serve: value => { handler = value; } },
    console,
  }));
  return handler;
}

const retiredCustomerSync = loadStandaloneRetirementHandler();
assert.equal(typeof retiredCustomerSync, 'function');
const retiredResponse = await retiredCustomerSync({ method: 'POST' });
const retiredPayload = await retiredResponse.json();
assert.equal(retiredResponse.status, 200);
assert.equal(retiredPayload.success, true);
assert.equal(retiredPayload.skipped, true);
assert.equal(retiredPayload.retired, true);
assert.equal(retiredPayload.external_calls_performed, false);
results.push('legacy_customer_sync_name_is_a_backward_compatible_no_op');

const wrongMethod = await retiredCustomerSync({ method: 'GET' });
assert.equal(wrongMethod.status, 405);
results.push('legacy_customer_sync_rejects_non_post_requests');

function loadGatewayProfileRetirementHandler() {
  let source = read('base44/functions/getCustomerAccountDashboardData/handlers/syncUserToHub/entry.ts');
  source = source.replace(/^import .*$/gm, '');
  source = source.replace('export default async function handler(req: Request)', 'globalThis.__handler = async function handler(req)');
  let unexpectedFetchCount = 0;
  const context = vm.createContext({
    console, Response,
    createClientFromRequest: req => req.__base44,
    fetch: async () => { unexpectedFetchCount += 1; throw new Error('unexpected network'); },
    globalThis: {},
  });
  vm.runInContext(source, context);
  return { handler: context.globalThis.__handler, getUnexpectedFetchCount: () => unexpectedFetchCount };
}

const profileHandler = loadGatewayProfileRetirementHandler();
const selfResponse = await profileHandler.handler({
  __base44: { auth: { me: async () => ({ id: 'user_1', role: 'user', email: 'member@example.test' }) } },
  json: async () => ({ email: 'member@example.test', phone: 'synthetic' }),
});
const selfPayload = await selfResponse.json();
assert.equal(selfResponse.status, 200);
assert.equal(selfPayload.retired, true);
assert.equal(selfPayload.external_calls_performed, false);
assert.equal(profileHandler.getUnexpectedFetchCount(), 0);
results.push('authenticated_legacy_profile_sync_is_a_no_network_no_op');

const crossAccount = await profileHandler.handler({
  __base44: { auth: { me: async () => ({ id: 'user_1', role: 'user', email: 'member@example.test' }) } },
  json: async () => ({ email: 'other@example.test' }),
});
assert.equal(crossAccount.status, 403);
results.push('legacy_profile_sync_preserves_ownership_boundary');

const checkout = read('src/pages/Checkout.jsx');
const accountSettings = read('src/pages/AccountSettings.jsx');
assert.equal(checkout.includes("invoke('syncCustomerToHub'"), false);
assert.equal(accountSettings.includes("invoke('syncUserToHub'"), false);
assert.ok(checkout.includes('base44.entities.BagReturn.create'));
assert.ok(accountSettings.includes('base44.auth.updateMe'));
results.push('current_checkout_and_profile_flows_persist_native_records_without_hub_sync');

const stripeWebhook = read('base44/functions/stripeWebhook/entry.ts');
const pauseStandalone = read('base44/functions/pauseSubscription/entry.ts');
const pauseGateway = read('base44/functions/getCustomerAccountDashboardData/handlers/pauseSubscription/entry.ts');
const cancelStandalone = read('base44/functions/cancelSubscriptionFutureRenewal/entry.ts');
const cancelGateway = read('base44/functions/getCustomerAccountDashboardData/handlers/cancelSubscriptionFutureRenewal/entry.ts');
for (const source of [stripeWebhook, pauseStandalone, pauseGateway, cancelStandalone, cancelGateway]) {
  assert.equal(/functions\.invoke\(['"]syncCustomerToHub['"]/.test(source), false);
}
assert.ok(stripeWebhook.includes("const hubResult = 'retired_no_external_sync'"));
results.push('stripe_and_subscription_lifecycle_no_longer_call_the_hub_bridge');

const syncCustomerSource = read('base44/functions/syncCustomerToHub/entry.ts');
const syncUserSource = read('base44/functions/getCustomerAccountDashboardData/handlers/syncUserToHub/entry.ts');
assert.equal(/fetch\s*\(/.test(syncCustomerSource + syncUserSource), false);
assert.equal(/HUB_API_URL|CUSTOMER_APP_SYNC_SECRET/.test(syncCustomerSource + syncUserSource), false);
results.push('retired_bridge_handlers_have_no_hub_url_secret_or_fetch_dependency');

console.log(JSON.stringify({
  success: true,
  suite: 'g94-customer-hub-bridge-retirement',
  cases: results.length,
  results,
  writes_performed: false,
  provider_calls_performed: false,
  customer_notifications_sent: false,
  hub_calls_performed: false,
}, null, 2));
