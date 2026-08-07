#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const results = [];

function read(file) {
  return fs.readFileSync(path.join(repoRoot, file), 'utf8');
}

function assert(name, condition, detail = {}) {
  results.push({ name, ok: Boolean(condition), detail });
}

function pageHasVisibilityGate(source) {
  return source.includes("import { usePageVisibility } from '@/lib/usePageVisibility';") &&
    source.includes('const isPageVisible = usePageVisibility();') &&
    /enabled:\s*isAdminUser\(user\)\s*&&\s*isPageVisible/.test(source) &&
    /refetchOnWindowFocus:\s*true/.test(source);
}

const complianceFn = read('base44/functions/getAdminComplianceOpsSummary/entry.ts');
const productionQueue = read('src/pages/admin/ProductionQueueSummary.jsx');
const productionPlanning = read('src/pages/admin/ProductionPlanning.jsx');
const calendar = read('src/pages/admin/Calendar.jsx');
const reviewQueue = read('src/pages/admin/ReviewQueue.jsx');
const opsAlerts = read('src/pages/admin/OpsAlerts.jsx');
const complianceOps = read('src/pages/admin/ComplianceOps.jsx');
const deliveryQueue = read('src/pages/admin/DeliveryQueue.jsx');
const adminEvents = read('src/pages/admin/AdminEvents.jsx');
const routeOps = read('src/pages/admin/RouteOps.jsx');
const adminOrders = read('src/pages/AdminOrders.jsx');
const posOrders = read('src/pages/admin/POSOrders.jsx');
const shopifyDashboard = read('src/pages/admin/ShopifyDashboard.jsx');
const operations = read('src/pages/admin/Operations.jsx');
const runtimeCheck = read('scripts/migration/run-g52-live-readiness-runtime-check.js');
const criticalCi = read('scripts/ci/run-critical-regressions.mjs');

assert('Compliance summary exposes top-level native_available in internal-test response.', /source:\s*'customer_app_native_internal_test'[\s\S]*native_available:\s*nativeComplianceReady\(native\)/.test(complianceFn), {});
assert('Compliance summary exposes top-level native_available in Hub fallback response.', /function withNativeFallback[\s\S]*native_available:\s*nativeComplianceReady\(native\)/.test(complianceFn), {});
assert('Compliance summary exposes top-level native_available in Hub-success response.', /\.\.\.hub,[\s\S]*native,[\s\S]*native_available:\s*nativeComplianceReady\(native\)/.test(complianceFn), {});
assert('Compliance native_available is derived from sanitized read-only native summary.', complianceFn.includes('function nativeComplianceReady(native)') && complianceFn.includes('native?.read_only === true'), {});
assert('Compliance summary computes internal-test records from explicit G53 markers.', complianceFn.includes('function isInternalTestRecord(row)') && complianceFn.includes('BATCH-G53-TEST') && complianceFn.includes('customer_app_internal_validation') && complianceFn.includes('held_internal_test'), {});
assert('Compliance summary excludes computed internal-test batches from default operational totals.', /const batchModeMatches = row => testRecordMode === 'only' \? isInternalTestBatch\(row\) : !isInternalTestBatch\(row\)/.test(complianceFn), {});
assert('Compliance summary sanitizes batches with computed internal-test status.', complianceFn.includes('is_test_batch: isInternalTestBatch(batch)'), {});

assert('Production Queue query reads are visibility-gated.', pageHasVisibilityGate(productionQueue), {});
assert('Production Queue gates both queue and planning handoff reads.', (productionQueue.match(/enabled:\s*isAdminUser\(user\)\s*&&\s*isPageVisible\s*&&\s*!rangeInvalid/g) || []).length >= 2, {});
assert('Production Planning query reads are visibility-gated.', pageHasVisibilityGate(productionPlanning), {});
assert('Calendar query reads are visibility-gated.', pageHasVisibilityGate(calendar), {});
assert('Review Queue query reads are visibility-gated.', pageHasVisibilityGate(reviewQueue), {});
assert('Ops Alerts query reads are visibility-gated.', pageHasVisibilityGate(opsAlerts), {});
assert('Compliance Ops query reads are visibility-gated.', pageHasVisibilityGate(complianceOps), {});
assert('Compliance Ops gates both summary and production lifecycle read-model reads.', (complianceOps.match(/enabled:\s*isAdminUser\(user\)\s*&&\s*isPageVisible/g) || []).length >= 2, {});
assert('Delivery Queue surfaces stale native task reconciliation context.', deliveryQueue.includes('suppressed_stale_delivery_tasks') && deliveryQueue.includes('Historical native task context') && deliveryQueue.includes('stale_native_delivery_task_detected'), {});
assert('Route Ops surfaces stale native task reconciliation context.', routeOps.includes('suppressed_stale_delivery_tasks') && routeOps.includes('Historical native task context') && routeOps.includes('stale_native_delivery_task_detected'), {});

assert('Runtime readiness script reports compliance native_available from API metadata.', runtimeCheck.includes('native_available: calls.compliance.data?.native_available === true'), {});
assert('Critical regressions include admin visibility/compliance readiness guard.', criticalCi.includes('scripts/migration/run-g53-admin-visibility-refresh-and-compliance-readiness-tests.mjs'), {});

assert('Visibility refresh changes introduce no provider calls.', !/Stripe\.|stripe\.|Shopify\.|shopify\.|provider_call_impact:\s*true/.test([
  productionQueue,
  productionPlanning,
  calendar,
  reviewQueue,
  opsAlerts,
  complianceOps,
  deliveryQueue,
  routeOps,
].join('\n')), {});
assert('Visibility refresh changes introduce no notification sends.', !/CustomerMessageDeliveryLog\.create|Notification\.create|notifications_sent:\s*true/.test([
  productionQueue,
  productionPlanning,
  calendar,
  reviewQueue,
  opsAlerts,
  complianceOps,
  deliveryQueue,
  routeOps,
].join('\n')), {});

const coreAdminSurface = [
  adminOrders,
  posOrders,
  operations,
  productionQueue,
  productionPlanning,
  complianceOps,
  deliveryQueue,
  routeOps,
].join('\n');

assert('Core admin readiness panels no longer expose stale controlled-action language.', !/Controlled action|Controlled actions|Controlled writes|controlled actions|controlled operational actions|remain controlled|are controlled|stays controlled/.test(coreAdminSurface), {});
assert('Obsolete shared launch-readiness panel has been retired.', !fs.existsSync(path.join(repoRoot, 'src/components/admin/May30ReadinessPanel.jsx')), {});
assert('Operations dashboard card map presents live workflow labels for active work surfaces.', operations.includes("badges: ['Live workflow', 'Batch-linked', 'Live source']") && operations.includes("badges: ['Live forms', 'Batch-linked', 'Native']") && operations.includes("badges: ['Live campaigns', 'Native']"), {});
assert('Active operator pages no longer carry redundant shared mini-readiness panels.', ![
  adminOrders,
  posOrders,
  productionQueue,
  productionPlanning,
  complianceOps,
  deliveryQueue,
].join('\n').includes('May30ReadinessPanel'), {});
assert('Admin Orders opens into the order workflow without the duplicate customer-context mini dashboard.', !adminOrders.includes('LiveCustomerContextPanel') && !adminOrders.includes('Live Customer Context'), {});
assert('Admin Orders keeps source diagnostics exception-only.', adminOrders.includes('showOrderSourceDiagnostics') && adminOrders.includes('orderSourceDiagnosticErrors.length > 0') && adminOrders.includes('{showOrderSourceDiagnostics &&'), {});
assert('Admin Orders no longer exposes the dead route-review panel.', !adminOrders.includes('Zone3ReviewPanel') && !adminOrders.includes('showZone3') && adminOrders.includes('to="/admin/route-ops"'), {});
assert('Admin Orders routes lifecycle changes through live queues instead of disabled direct status buttons.', !adminOrders.includes('ORDER_DIRECT_STATUS_MUTATIONS_LOCKED') && !adminOrders.includes('admin_order_workflow_controls_disabled') && adminOrders.includes('Operational Workflow') && adminOrders.includes('to="/admin/production-queue"') && adminOrders.includes("'/admin/delivery-queue'") && adminOrders.includes("'/admin/route-ops'"), {});
assert('Shopify bridge order detail no longer renders disabled legacy workflow buttons.', !shopifyDashboard.includes('SHOPIFY_DIRECT_WORKFLOW_MUTATIONS_LOCKED') && !shopifyDashboard.includes('Mark as "') && !shopifyDashboard.includes('Mark as Fulfilled') && !shopifyDashboard.includes('Save Notes (Locked)') && shopifyDashboard.includes('Workflow Handoff') && shopifyDashboard.includes('to="/admin/production-queue"') && shopifyDashboard.includes("'/admin/delivery-queue'"), {});
assert('POS Orders keeps customer profile preview optional instead of loading another mini dashboard by default.', posOrders.includes('showProfilePreview') && posOrders.includes('enabled: isAdminUser(user) && showProfilePreview') && !posOrders.includes('Customer profile readiness'), {});
assert('POS Orders normalizes dated legacy source-note wording for the operator UI.', posOrders.includes('displaySourceNoteSummary') && posOrders.includes('legacy POS import'), {});
assert('Compliance Ops avoids readiness wording that looks like a stale launch gate.', !complianceOps.includes('Audit Readiness'), {});
assert('Admin Events uses the source-backed calendar read model.', adminEvents.includes("base44.functions.invoke('getAdminCalendarEventsSummary'") && adminEvents.includes("preset: 'next_30_days'") && adminEvents.includes("type: 'event'"), {});
assert('Admin Events presents compact operational handoff instead of a mobile stat-card grid.', adminEvents.includes('Event calendar, POS context, and production handoff') && adminEvents.includes('Event records') && !adminEvents.includes('Read-only event records') && !adminEvents.includes('function StatCard'), {});
assert('Production Queue primary presets exclude stale historical one-off shortcuts.', !productionQueue.includes('Jun 5 Catch-up') && !productionQueue.includes('Jun 19 Completed') && !productionQueue.includes('Jul 10 Event') && productionQueue.includes('Need an older date?'), {});
assert('Production Queue handoff title distinguishes covered demand from unbatched demand.', productionQueue.includes('Demand is covered by scheduled batches') && productionQueue.includes('Demand exists before a production batch is scheduled'), {});
assert('Production Planning and Route Ops are labeled as active operator surfaces, not frozen read-only gates.', productionPlanning.includes('badge="Planning"') && productionPlanning.includes('Ingredient demand, batch coverage, and procurement context') && routeOps.includes('badge="Route Review"') && !routeOps.includes('badge="Read-only"'), {});

const failures = results.filter(result => !result.ok);
const output = {
  success: failures.length === 0,
  classification: failures.length === 0
    ? 'admin_visibility_refresh_and_compliance_readiness_ready'
    : 'admin_visibility_refresh_or_compliance_readiness_regression',
  case_count: results.length,
  failures,
  results,
  writes_performed: false,
  provider_call_impact: false,
  notifications_sent: false,
};

console.log(JSON.stringify(output, null, 2));
if (failures.length > 0) process.exit(1);
