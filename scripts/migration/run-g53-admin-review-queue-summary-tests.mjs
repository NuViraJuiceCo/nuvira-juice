import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');

const functionPath = path.join(repoRoot, 'base44/functions/getAdminOpsAlertsSummary/entry.ts');
const pagePath = path.join(repoRoot, 'src/pages/admin/ReviewQueue.jsx');

const functionSource = fs.readFileSync(functionPath, 'utf8');
const pageSource = fs.readFileSync(pagePath, 'utf8');

const checks = [];
function check(name, fn) {
  try {
    fn();
    checks.push({ name, ok: true });
  } catch (error) {
    checks.push({ name, ok: false, error: error.message });
  }
}

check('Review queue summary uses service-role reads', () => {
  assert.match(functionSource, /base44\.asServiceRole\?\.entities\?\.OrderReviewQueue/);
});

check('Review queue-only branch is read-only', () => {
  const start = functionSource.indexOf('if (includeReviewQueueOnly)');
  const end = functionSource.indexOf('const reviewQueue = includeReviewQueue', start);
  assert.notEqual(start, -1, 'review-only branch missing');
  assert.notEqual(end, -1, 'review-only branch boundary missing');
  const reviewOnlyBranch = functionSource.slice(start, end);
  assert.doesNotMatch(functionSource, /\.create\s*\(/);
  assert.doesNotMatch(functionSource, /\.update\s*\(/);
  assert.doesNotMatch(functionSource, /\.delete\s*\(/);
  assert.doesNotMatch(reviewOnlyBranch, /fetch\s*\(/);
});

check('Review queue summary does not expose raw incoming payloads', () => {
  assert.doesNotMatch(functionSource, /incoming_payload\s*:/);
  assert.match(functionSource, /raw_payloads_included:\s*false/);
});

check('Review queue summary preserves side-effect safety markers', () => {
  assert.match(functionSource, /writes_performed:\s*false/);
  assert.match(functionSource, /provider_calls_performed:\s*false/);
  assert.match(functionSource, /notifications_sent:\s*false/);
  assert.match(functionSource, /hub_mutation_performed:\s*false/);
});

check('Review queue summary suppresses stale unlinked POS payment rejects by default', () => {
  assert.match(functionSource, /function isLegacyLaunchReviewQueueNoise/);
  assert.match(functionSource, /function isInternalTestReviewQueueItem/);
  assert.match(functionSource, /include_legacy_review_queue/);
  assert.match(functionSource, /include_internal_test_review_queue/);
  assert.match(functionSource, /legacy_launch_suppressed/);
  assert.match(functionSource, /internal_test_suppressed/);
  assert.match(functionSource, /manual_review_before_operational_processing/);
  assert.match(functionSource, /30 \* 24 \* 60 \* 60 \* 1000/);
});

check('Review Queue page uses the admin summary function', () => {
  assert.match(pageSource, /base44\.functions\.invoke\('getAdminOpsAlertsSummary'/);
  assert.match(pageSource, /include_review_queue_only:\s*true/);
  assert.doesNotMatch(pageSource, /OrderReviewQueue\.list/);
});

check('Review Queue page keeps read-only copy visible', () => {
  assert.match(pageSource, /intentionally read-only/);
  assert.match(pageSource, /does not resolve, repair, replay, refund, sync, notify, or mutate/);
});

const failed = checks.filter(result => !result.ok);
const output = {
  ok: failed.length === 0,
  suite: 'g53-admin-review-queue-summary',
  generated_at_utc: new Date().toISOString(),
  checks: checks.length,
  writes_performed: false,
  provider_calls_performed: false,
  customer_notifications_sent: false,
  results: checks,
};

console.log(JSON.stringify(output, null, 2));
if (failed.length > 0) process.exit(1);
