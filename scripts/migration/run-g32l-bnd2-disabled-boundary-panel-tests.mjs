#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sourcePath = new URL('../../src/pages/admin/SyncHealth.jsx', import.meta.url);
const source = fs.readFileSync(sourcePath, 'utf8');

assert.match(source, /Historical Backfill Disabled-Gate Check/, 'SyncHealth should include the G32L-BND2 disabled-gate panel');
assert.match(source, /Run Disabled-Gate Check/, 'panel should expose only a diagnostic check button');
assert.match(source, /backfillHistoricalHubFulfilledNativeShopifyOrderForCustomerApp/, 'panel should call the historical backfill command');
assert.match(source, /g32l_bnd2_disabled_historical_backfill_1052_\$\{timestampForRequestId\(\)\}/, 'request id must use the G32L-BND2 disabled-boundary prefix');

const requiredRequestFields = [
  "mode: 'live'",
  "hub_order_number: '1052'",
  "correction_mode: 'HISTORICAL_HUB_FULFILLED_BACKFILL_NO_NOTIFICATION'",
  "notification_policy: 'NO_NOTIFICATION'",
  "proof_drop_policy: 'HELD_NOT_REQUIRED_FOR_RECONCILIATION'",
  "customer_app_order_backfill: 'HELD'",
  "native_fulfillment_task_backfill: 'HELD'",
  "confirmation: 'backfill_historical_hub_fulfilled_native_shopify_order_no_notification'",
];
for (const field of requiredRequestFields) {
  assert.ok(source.includes(field), `missing fixed diagnostic request field: ${field}`);
}

const safeDisplayLabels = [
  'HTTP / Function Status',
  'Success',
  'Skipped',
  'Error Code',
  'Writes Performed',
];
for (const label of safeDisplayLabels) {
  assert.ok(source.includes(label), `missing safe display label: ${label}`);
}

assert.doesNotMatch(source, /document\.cookie|localStorage|sessionStorage|Authorization|Bearer\s+|auth_header|api_key/i, 'panel must not inspect or expose browser storage, auth headers, or secrets');
assert.doesNotMatch(source, /ENABLE_HISTORICAL_HUB_FULFILLED_NATIVE_SHOPIFY_ORDER_BACKFILL|HISTORICAL_HUB_FULFILLED_NATIVE_SHOPIFY_ORDER_BACKFILL_KILL_SWITCH/, 'panel must not reference or modify gate environment variables');
assert.doesNotMatch(source, /JSON\.stringify\(result|JSON\.stringify\(res|raw payload|raw_response|raw_request/i, 'panel must not render raw request/response payloads');
assert.doesNotMatch(source, /ShopifyOrder\.create|Order\.create|FulfillmentTask\.create|Notification\.create|MessageLog\.create|fetch\(|XMLHttpRequest|sendBeacon/i, 'panel should use existing Base44 function invocation only and must not create records or use raw network APIs');

console.log('G32L-BND2 disabled-boundary panel tests passed');
