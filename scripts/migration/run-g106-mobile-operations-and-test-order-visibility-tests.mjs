#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const operations = read('src/pages/admin/Operations.jsx');
const customerDashboard = read('base44/functions/getCustomerAccountDashboardData/handlers/getCustomerAccountDashboardData/entry.ts');
const critical = read('scripts/ci/run-critical-regressions.mjs');
const testMarkerHelper = customerDashboard.slice(
  customerDashboard.indexOf('function isExplicitInternalTestOrder'),
  customerDashboard.indexOf('function authoritativeCustomerOrderStatus'),
);
const cases = [];

function check(name, condition) {
  assert.ok(condition, name);
  cases.push(name);
}

check('operations_uses_shared_mobile_breakpoint', operations.includes("import { useIsMobile } from '@/hooks/use-mobile';"));
check('mobile_snapshot_defaults_to_compact_mode', operations.includes('if (isMobile && !mobileExpanded)'));
check('mobile_snapshot_exposes_four_direct_work_links', [
  'label="Produce"',
  'label="Deliver"',
  'label="Orders"',
  'label="Watch"',
].every(marker => operations.includes(marker)));
check('mobile_snapshot_has_explicit_expand_and_collapse_controls', operations.includes('Full snapshot') && operations.includes('Collapse snapshot'));
check('mobile_snapshot_uses_stable_four_column_dimensions', operations.includes('grid grid-cols-4 gap-1.5') && operations.includes('min-h-[64px]'));
check('mobile_snapshot_values_fit_narrow_tiles', operations.includes('value={loadingValue || formatNumber(production.planned_units)}')
  && operations.includes('value={loadingValue || formatNumber(delivery.today_stops)}'));
check('desktop_snapshot_preserves_date_range_and_detailed_counts', operations.includes('Custom Range') && operations.includes('Detailed dashboard counts'));
check('mobile_intro_hides_redundant_status_legend', operations.includes('className="mt-2 hidden md:flex"'));
check('dashboard_refresh_stays_usage_scoped', operations.includes('refetchIntervalInBackground: false') && operations.includes('enabled: isAdminUser(user) && isPageVisible'));

check('customer_history_recognizes_explicit_internal_test_markers', customerDashboard.includes('function isExplicitInternalTestOrder(row)')
  && customerDashboard.includes("tags.includes('internal_test')")
  && customerDashboard.includes("['internal_test', 'archived_test'].includes(visibility)"));
check('authoritative_history_excludes_explicit_internal_tests', customerDashboard.includes('&& !isExplicitInternalTestOrder(row)'));
check('test_order_filter_does_not_change_payment_or_lifecycle_state', !/\.update\(|\.create\(|refund|notification/.test(testMarkerHelper));
check('critical_suite_includes_g106_guard', critical.includes('run-g106-mobile-operations-and-test-order-visibility-tests.mjs'));

console.log(JSON.stringify({
  success: true,
  suite: 'g106-mobile-operations-and-test-order-visibility',
  case_count: cases.length,
  cases,
  writes_performed: false,
  provider_calls_performed: false,
  notifications_sent: false,
}, null, 2));
