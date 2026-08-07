#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const read = relativePath => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
const exists = relativePath => fs.existsSync(path.join(repoRoot, relativePath));

const activeRoots = ['src', 'base44/functions', 'config'];
const activeFiles = [];
for (const root of activeRoots) {
  const visit = current => {
    for (const entry of fs.readdirSync(path.join(repoRoot, current), { withFileTypes: true })) {
      const relativePath = path.join(current, entry.name);
      if (entry.isDirectory()) visit(relativePath);
      else if (/\.(?:js|jsx|ts|tsx|json|jsonc)$/.test(entry.name)) activeFiles.push(relativePath);
    }
  };
  visit(root);
}

const legacyEventPattern = /may[ _-]?30|may 30|event\/may30|\bm30[a-z0-9_-]*\b/i;
const legacyReferences = activeFiles.filter(relativePath => legacyEventPattern.test(read(relativePath)));
assert.deepEqual(legacyReferences, [], `active runtime still contains legacy event references: ${legacyReferences.join(', ')}`);

for (const functionName of [
  'getAdminLaunchReadOnlySummary',
  'previewAdminMay30POSProfileCandidates',
  'processMay30NativeOrderOps',
]) {
  assert.equal(exists(`base44/functions/${functionName}`), false, `${functionName} must remain retired`);
}

for (const functionName of [
  'getAdminResourcesSummary',
  'getAdminPOSOrdersSummary',
  'syncOrderToHub',
]) {
  assert.equal(exists(`base44/functions/${functionName}/entry.ts`), true, `${functionName} must remain canonical`);
}

const nativeOrderOps = read('base44/functions/syncOrderToHub/nativeOrderOps.ts');
assert.match(nativeOrderOps, /ENABLE_NATIVE_ORDER_OPS/);
assert.match(nativeOrderOps, /NATIVE_ORDER_OPS_SECRET/);
assert.match(nativeOrderOps, /native_order_ops/);
assert.match(nativeOrderOps, /native_ops_ready/);
assert.match(read('base44/functions/syncOrderToHub/entry.ts'), /handleNativeOrderOpsRequest/);
assert.match(read('base44/functions/getAdminPOSOrdersSummary/entry.ts'), /handlePOSCustomerClaims/);
assert.match(read('base44/functions/getAdminResourcesSummary/entry.ts'), /handleAdminDataSummary/);

const readiness = read('base44/functions/previewNativeOrderCutoverReadiness/entry.ts');
assert.match(readiness, /native_order_ops/);
assert.match(readiness, /ENABLE_NATIVE_ORDER_OPS/);

const pushClient = read('src/lib/pushNotifications.js');
assert.match(pushClient, /nuvira_native_push_target_v2/);
assert.match(pushClient, /installNativePushListeners/);
assert.equal(exists('src/lib/eventPushNotifications.js'), false);

console.log(JSON.stringify({
  ok: true,
  suite: 'g72-legacy-event-runtime-retirement',
  active_files_scanned: activeFiles.length,
  canonical_consolidations: 3,
  writes_performed: false,
  provider_calls_performed: false,
  customer_notifications_sent: false,
}, null, 2));
