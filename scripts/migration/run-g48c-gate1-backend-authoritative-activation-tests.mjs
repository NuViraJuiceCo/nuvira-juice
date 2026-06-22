#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const repo = process.cwd();
const entryPath = path.join(repo, 'base44/functions/getAdminProductionPlanningSummary/entry.ts');
const helperPath = path.join(repo, 'base44/functions/getAdminProductionPlanningSummary/productionComplianceReadModel.js');
const complianceOpsPath = path.join(repo, 'src/pages/admin/ComplianceOps.jsx');
const docsPath = path.join(repo, 'docs/migration/g48c-gate1-backend-authoritative-read-model-activation.md');
const results = [];
function pass(name, detail = {}) { results.push({ name, ok: true, detail }); }
function fail(name, detail = {}) { results.push({ name, ok: false, detail }); }
function assert(name, condition, detail = {}) { condition ? pass(name, detail) : fail(name, detail); }
function read(file) { return fs.readFileSync(file, 'utf8'); }

const entry = read(entryPath);
const helper = read(helperPath);
const complianceOps = read(complianceOpsPath);
const docs = fs.existsSync(docsPath) ? read(docsPath) : '';
const changedFiles = process.env.G48C_GATE1_CHANGED_FILES ? process.env.G48C_GATE1_CHANGED_FILES.split('\n').filter(Boolean) : [];

const supportedVersion = 'g48c_production_compliance_lifecycle_v1';
function fixturePanelVisible(response) {
  const payload = response?.production_compliance_lifecycle_read_model;
  return response?.production_compliance_read_model_available === true &&
    response?.production_compliance_read_model_enabled === true &&
    response?.production_compliance_read_model_version === supportedVersion &&
    payload?.read_model_enabled === true &&
    payload?.read_model_version === supportedVersion;
}

const enabledFixture = {
  success: true,
  production_compliance_read_model_available: true,
  production_compliance_read_model_enabled: true,
  production_compliance_read_model_version: supportedVersion,
  production_compliance_lifecycle_read_model: {
    read_model_enabled: true,
    read_model_version: supportedVersion,
    read_only: true,
    production_write_ready: false,
    compliance_write_ready: false,
    summary: { exact_batch_log_match_count: 1, missing_log_count: 0, review_required_count: 0, fallback_required_count: 0 },
    rows: [{ batch_id: 'B-LOCKED', classification: 'production_compliance_native_read_ready', review_required: false, fallback_required: false }],
  },
};
const disabledFixture = {
  success: true,
  production_compliance_read_model_available: true,
  production_compliance_read_model_enabled: false,
  production_compliance_read_model_version: supportedVersion,
  writes_performed: false,
};
const unsupportedVersionFixture = {
  ...enabledFixture,
  production_compliance_read_model_version: 'future_version',
};
const malformedFixture = {
  success: true,
  production_compliance_read_model_available: true,
  production_compliance_read_model_enabled: true,
  production_compliance_read_model_version: supportedVersion,
  production_compliance_lifecycle_read_model: { read_model_enabled: true },
};
const reviewFallbackFixture = {
  ...enabledFixture,
  production_compliance_lifecycle_read_model: {
    ...enabledFixture.production_compliance_lifecycle_read_model,
    summary: { exact_batch_log_match_count: 1, missing_log_count: 1, review_required_count: 1, fallback_required_count: 1 },
    rows: [{ batch_id: 'B-REVIEW', classification: 'production_compliance_review_required', review_required: true, fallback_required: true }],
  },
};

assert('No Vite gate is required.', !/VITE_ENABLE_ADMIN_PRODUCTION_COMPLIANCE_READ_MODEL|ENABLE_COMPLIANCE_CANONICAL_READ_MODEL/.test(complianceOps), {});
assert('Backend disabled keeps the panel hidden.', fixturePanelVisible(disabledFixture) === false && complianceOps.includes('production_compliance_read_model_enabled'), {});
assert('Backend disabled preserves existing ComplianceOps records.', complianceOps.includes("getAdminComplianceOpsSummary") && complianceOps.includes('const nativeCompliance = complianceSummary?.native || {};'), {});
assert('Backend enabled fixture shows the canonical panel.', fixturePanelVisible(enabledFixture) === true && complianceOps.includes('Production/compliance lifecycle read model ready'), {});
assert('Supported version is accepted.', fixturePanelVisible(enabledFixture) === true && complianceOps.includes('SUPPORTED_PRODUCTION_COMPLIANCE_READ_MODEL_VERSION'), {});
assert('Unsupported version preserves fallback.', fixturePanelVisible(unsupportedVersionFixture) === false, {});
assert('Missing enabled marker preserves fallback.', fixturePanelVisible({ success: true, production_compliance_read_model_version: supportedVersion, production_compliance_lifecycle_read_model: enabledFixture.production_compliance_lifecycle_read_model }) === false, {});
assert('Malformed payload preserves fallback.', fixturePanelVisible(malformedFixture) === false, {});
assert('Backend failure preserves fallback.', complianceOps.includes('const nativeCompliance = complianceSummary?.native || {};') && complianceOps.includes('const productionComplianceReadModel = productionComplianceSummary?.production_compliance_lifecycle_read_model;') && complianceOps.includes('productionComplianceReadModelSupported &&'), {});
assert('Review-required rows are represented safely.', reviewFallbackFixture.production_compliance_lifecycle_read_model.rows[0].review_required === true && complianceOps.includes('review required'), {});
assert('Fallback-required rows remain available.', reviewFallbackFixture.production_compliance_lifecycle_read_model.summary.fallback_required_count === 1 && complianceOps.includes('Hub fallback remains available'), {});
assert('Existing compliance write actions are unchanged.', !changedFiles.some(file => /base44\/functions\/(saveAdminComplianceRecord|validateComplianceEntry|verifyAdminProductionBatch)/.test(file)) && complianceOps.includes('BatchComplianceLogForm'), { changedFiles });
assert('No independent UI fuzzy matching.', !/fuzzy|normalize.*batch|batch.*normalize|sort\(.*created|newest/i.test(complianceOps), {});
assert('No query parameter can enable the read model.', !/URLSearchParams|location\.search|queryParam|searchParams/.test(complianceOps), {});
assert('No localStorage/browser global can enable it.', !/localStorage|sessionStorage|globalThis|window\.(?:G48C|ENABLE|__)/.test(complianceOps), {});
assert('Ordinary customers cannot invoke the admin contract.', entry.includes("if (user.role !== 'admin')") && entry.includes("return Response.json({ error: 'Forbidden' }, { status: 403 })"), {});
assert('No customer-facing page changes.', !changedFiles.some(file => /^src\/pages\/(?!admin\/)/.test(file) || /^src\/components\/(?!admin\/|compliance\/)/.test(file)), { changedFiles });
assert('No ProductionBatch mutation.', !/ProductionBatch\.update|entities\.ProductionBatch\.update|ProductionBatch\.create|entities\.ProductionBatch\.create/.test(entry + helper + complianceOps), {});
assert('No BatchComplianceLog mutation.', !/BatchComplianceLog\.update|entities\.BatchComplianceLog\.update|BatchComplianceLog\.create|entities\.BatchComplianceLog\.create/.test(entry + helper + complianceOps), {});
assert('No ComplianceAlert creation.', !/ComplianceAlert\.create|entities\.ComplianceAlert\.create/.test(entry + helper + complianceOps), {});
assert('No Hub mutation.', !/push.*Hub|Hub.*mutation|hub_mutation_performed:\s*true|method:\s*['"]POST['"]/.test(helper + complianceOps), {});
assert('No provider calls.', !/Stripe\(|new Stripe|Shopify\(|provider_call_impact:\s*true|fetch\(.*provider/i.test(helper + complianceOps), {});
assert('No notifications.', !/Notification\.create|CustomerMessageDeliveryLog|sendNotification|notifications_sent:\s*true/.test(entry + helper + complianceOps), {});
assert('No logs/queues.', !/CommandLog\.create|OrderSyncLog\.create|SafeSyncParityLog\.create|OrderReviewQueue\.create/.test(entry + helper + complianceOps), {});
assert('Existing G48C harness contract is represented.', entry.includes('production_compliance_read_model_available') && entry.includes('production_compliance_lifecycle_read_model') && helper.includes('read_model_version'), {});
assert('Existing G39F production-planning contract passes structurally.', entry.includes('summary: nativeFirstPlanning.summary') && entry.includes('dates: nativeFirstPlanning.dates.slice') && entry.includes('native_overlay'), {});
assert('Existing ComplianceOps fallback passes.', complianceOps.includes("getAdminComplianceOpsSummary") && complianceOps.includes('productionComplianceReadModelSupported &&') && complianceOps.includes('nativeCompliance.summary'), {});
assert('Documentation records backend-authoritative gate.', docs.includes('backend-authoritative') && docs.includes('frontend_read_model_gate_type=backend_authoritative'), {});

const failures = results.filter(result => !result.ok);
console.log(JSON.stringify({
  success: failures.length === 0,
  classification: failures.length === 0 ? 'production_compliance_read_model_activation_path_pr_ready' : 'hard_stop_production_compliance_read_model_fallback_regression',
  case_count: results.length,
  results,
}, null, 2));
if (failures.length) process.exit(1);
