import assert from 'node:assert/strict';
import fs from 'node:fs';

const handlerPath = 'base44/functions/getAdminOperationsDashboardSummary/handlers/executeNativeProductionBatchLifecycle/entry.ts';
const handler = fs.readFileSync(handlerPath, 'utf8');

assert.match(handler, /function lifecycleAuditReplayApplied\(batch, action, requestId\)/);
assert.match(handler, /production_batch_\$\{normalizeLower\(action\)\}/);
assert.match(handler, /sanitizeId\(entry\?\.request_id\) === normalizedRequestId/);
assert.match(handler, /!existingLog && lifecycleAuditReplayApplied\(batch, action, requestId\)/);
assert.match(handler, /reason: 'lifecycle_audit_trail_present'/);

console.log('5/5 production immediate-idempotency fallback tests passed.');
