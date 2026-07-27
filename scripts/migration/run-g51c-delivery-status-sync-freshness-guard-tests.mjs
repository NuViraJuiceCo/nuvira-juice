#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const repo = process.cwd();
const results = [];

function read(file) {
  return fs.readFileSync(path.join(repo, file), 'utf8');
}

function pass(name, detail = {}) {
  results.push({ name, ok: true, detail });
}

function fail(name, detail = {}) {
  results.push({ name, ok: false, detail });
}

function assert(name, condition, detail = {}) {
  condition ? pass(name, detail) : fail(name, detail);
}

const syncSource = read('base44/functions/syncHubDeliveryStatuses/entry.ts');
const verifierSource = read('base44/functions/verifyOutForDeliveryNotification/entry.ts');
const statusNotificationSource = read('base44/functions/sendOrderStatusNotification/entry.ts');
const criticalCi = read('scripts/ci/run-critical-regressions.mjs');

const dryRunIndex = syncSource.indexOf('if (dryRun)');
const orderUpdateIndex = syncSource.indexOf('entities.Order.update');

assert('Delivery status sync has a no-write dry-run mode.', syncSource.includes("body.mode === 'dry_run'") && syncSource.includes('wouldUpdateOrders'), {});
assert('Dry-run branch executes before Customer App Order update.', dryRunIndex >= 0 && orderUpdateIndex >= 0 && dryRunIndex < orderUpdateIndex, { dryRunIndex, orderUpdateIndex });
assert('Scheduled sync gate no longer references launch freeze copy.', !syncSource.includes('May 30 launch freeze') && syncSource.includes('current controlled-sync gate'), {});
assert('Verifier run-sync gate no longer references launch freeze copy.', !verifierSource.includes('May 30 launch freeze') && verifierSource.includes('current controlled-sync gate'), {});
assert('Delivery date fields are explicitly considered before status sync.', syncSource.includes('DELIVERY_DATE_FIELDS') && syncSource.includes('assigned_delivery_date') && syncSource.includes('requested_delivery_date'), {});
assert('Delivery status sync has bounded freshness controls.', syncSource.includes('HUB_DELIVERY_STATUS_SYNC_LOOKBACK_DAYS') && syncSource.includes('HUB_DELIVERY_STATUS_SYNC_LOOKAHEAD_DAYS'), {});
assert('Out-of-window active orders are reported instead of mutated.', syncSource.includes('skippedByDeliveryWindow') && syncSource.includes('delivery_date_before_sync_window'), {});
assert('Dry-run exposes proof/drop projection without writing.', syncSource.includes('would_pull_delivery_photo_url') && syncSource.includes('would_pull_delivery_drop_location'), {});
assert('Dry-run exposes stale native fulfillment-task delivery reconciliation.', syncSource.includes('wouldUpdateFulfillmentTasks') && syncSource.includes('would_update_fulfillment_tasks'), {});
assert('Delivered sync reconciles native FulfillmentTask rows without touching ShopifyOrder.', syncSource.includes('stageDeliveredTaskReconciliation') && syncSource.includes('entities.FulfillmentTask.update') && !syncSource.includes('entities.ShopifyOrder.update'), {});
assert('Sync function still relies on entity automation, not direct notification sends.', !/functions\.invoke\(\s*['"]send(Customer|OrderStatus)|entities\.(CustomerMessageDeliveryLog|Notification)\.create|CustomerMessageDeliveryLog\.create|Notification\.create/.test(syncSource), {});
assert('Delivered notification emails are logged with an idempotent message log key.', statusNotificationSource.includes('recordDeliveredEmailLog') && statusNotificationSource.includes('CustomerMessageDeliveryLog.create') && statusNotificationSource.includes('order_status_email_'), {});
assert('Delivered email retry is guarded by sent-log lookup, not only notification existence.', statusNotificationSource.includes('deliveredEmailAlreadySent') && statusNotificationSource.includes('delivered_email_already_sent'), {});
assert('Critical regressions include the delivery status sync freshness guard.', criticalCi.includes('scripts/migration/run-g51c-delivery-status-sync-freshness-guard-tests.mjs'), {});

const failures = results.filter(result => !result.ok);
console.log(JSON.stringify({
  success: failures.length === 0,
  classification: failures.length === 0 ? 'delivery_status_sync_freshness_guard_ready' : 'delivery_status_sync_freshness_guard_regression',
  case_count: results.length,
  results,
}, null, 2));

if (failures.length) process.exit(1);
