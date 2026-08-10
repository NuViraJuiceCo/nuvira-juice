#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const header = read('src/components/admin/AdminOpsHeader.jsx');
const monitor = read('src/components/compliance/ComplianceMonitor.jsx');
const production = read('src/pages/admin/ProductionQueueSummary.jsx');
const delivery = read('src/pages/admin/DeliveryQueue.jsx');
const compliance = read('src/pages/admin/ComplianceOps.jsx');
const critical = read('scripts/ci/run-critical-regressions.mjs');
const cases = [];

function check(name, condition) {
  assert.ok(condition, name);
  cases.push(name);
}

check('shared_admin_header_supports_opt_in_mobile_copy', header.includes('mobileTitle,')
  && header.includes('mobileSubtitle,')
  && header.includes('compactMobile = false'));
check('shared_header_defaults_remain_compatible', header.includes("compactMobile ? 'py-2.5 md:py-3' : 'py-3'")
  && header.includes("backTo = '/admin/operations'"));

check('production_mobile_header_is_operator_focused', production.includes('mobileTitle="Produce"')
  && production.includes('mobileSubtitle="Today\'s batches and next actions"'));
check('production_mobile_work_window_is_compact', production.includes('aria-label="Production work window"')
  && production.includes('Dates & filters')
  && production.includes('md:hidden'));
check('production_mobile_filters_preserve_date_category_and_status_controls', production.includes('setDateFromValue(event.target.value)')
  && production.includes('setDateToValue(event.target.value)')
  && production.includes('setCategoryFilter(event.target.value)')
  && production.includes('setStatusFilter(event.target.value)'));
check('production_mobile_views_use_stable_two_column_selector', production.includes('aria-label="Production queue views"')
  && production.includes('grid grid-cols-2 gap-1'));
check('production_desktop_detail_panels_are_preserved', production.includes('hidden rounded-xl border border-border/50 bg-card p-4 space-y-3 md:block')
  && production.includes('hidden md:block"><ProductionDemandHandoffPanel'));

check('delivery_mobile_header_is_operator_focused', delivery.includes('mobileTitle="Deliver"')
  && delivery.includes('mobileSubtitle="Today\'s stops, proof, and route work"'));
check('delivery_mobile_date_control_uses_icon_navigation', delivery.includes('aria-label="Previous delivery date"')
  && delivery.includes('aria-label="Next delivery date"')
  && delivery.includes('<ChevronLeft')
  && delivery.includes('<ChevronRight'));
check('delivery_mobile_summary_is_single_four_metric_strip', delivery.includes('aria-label="Delivery summary"')
  && delivery.includes('grid grid-cols-4 divide-x'));
check('delivery_mobile_refresh_is_explicit_and_usage_scoped', delivery.includes('aria-label="Refresh delivery queue"')
  && delivery.includes('onClick={() => refetch()}')
  && delivery.includes('refetchIntervalInBackground: false'));
check('delivery_desktop_date_and_route_context_remain_available', delivery.includes('hidden rounded-xl border border-border/50 bg-card p-4 space-y-3 md:block')
  && delivery.includes('Driver Portal route view'));

check('compliance_mobile_header_is_operator_focused', compliance.includes('mobileTitle="Logs"')
  && compliance.includes('mobileSubtitle="Batch records and audit tools"'));
check('compliance_mobile_quick_entry_preserves_core_forms', ['Temp Log', 'Sanitation', 'Checklist', 'Batch Log'].every(label => compliance.includes(label))
  && compliance.includes('grid grid-cols-2 gap-2 md:flex'));
check('compliance_mobile_uses_one_view_selector_instead_of_thirteen_tiles', compliance.includes('Open compliance view')
  && compliance.includes('value={activeTab}')
  && compliance.includes('complianceTabs.map(({ value, label })'));
check('compliance_desktop_tab_strip_is_preserved', compliance.includes('hidden h-auto w-full flex-wrap justify-start gap-1 bg-muted/70 p-1 md:flex'));
check('compliance_status_details_are_collapsible_on_mobile', compliance.includes('System status details'));
check('compliance_ai_control_has_icon_only_mobile_mode', monitor.includes('compact = false')
  && monitor.includes('aria-label="Ask Compliance AI"')
  && compliance.includes('<ComplianceMonitor compact />'));

check('mobile_workspace_changes_do_not_add_backend_mutation_calls', ![header, monitor].some(source => /\.entities\.[A-Za-z]+\.(create|update|delete)|functions\.invoke/.test(source)));
check('critical_suite_includes_g107_guard', critical.includes('run-g107-mobile-operator-workspace-tests.mjs'));

console.log(JSON.stringify({
  success: true,
  suite: 'g107-mobile-operator-workspace',
  case_count: cases.length,
  cases,
  writes_performed: false,
  provider_calls_performed: false,
  notifications_sent: false,
}, null, 2));
