#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const results = [];

const app = read('src/App.jsx');
const adminRouteLines = app.split('\n').filter(line => line.includes('path="/admin/'));
assert.ok(adminRouteLines.length > 20);
assert.equal(adminRouteLines.some(line => line.includes('<ProtectedRoute')), false);
assert.ok(app.includes('const AdminProtectedRoute'));
assert.ok(app.includes('isAdminUser(user) ? element : <AdminAccessDenied />'));
results.push('all_admin_routes_enforce_admin_before_page_mount');

const shopify = read('src/pages/admin/ShopifyDashboard.jsx');
assert.ok(shopify.includes('const canRead = isAdminUser(user)'));
assert.ok(shopify.includes('enabled: canRead && isPageVisible'));
results.push('shopify_provider_summary_waits_for_admin_authorization');

const { retryRead } = await import('../../src/lib/query-client.js');
assert.equal(retryRead(0, { response: { status: 401 } }), false);
assert.equal(retryRead(0, { response: { status: 409 } }), false);
assert.equal(retryRead(0, { response: { status: 503 } }), true);
assert.equal(retryRead(1, new Error('network')), true);
assert.equal(retryRead(2, new Error('network')), false);
results.push('global_reads_retry_transient_failures_but_never_repeat_4xx');

const commandLog = JSON.parse(read('base44/entities/CommandLog.jsonc'));
assert.equal(commandLog.rls.update, false);
assert.equal(commandLog.rls.delete, false);
results.push('command_log_is_client_immutable');

const delivery = read('base44/functions/getAdminOperationsDashboardSummary/handlers/getAdminDeliveryRouteSummary/entry.ts');
assert.ok(delivery.includes('source_available: sourceAvailable'));
assert.ok(delivery.includes('native_read_failure_count: readFailureCount'));
assert.equal(delivery.includes('source_available: allStops.length > 0'), false);
results.push('empty_delivery_days_remain_available_read_models');

const production = read('base44/functions/getAdminOperationsDashboardSummary/handlers/getAdminProductionQueueSummary/entry.ts');
assert.ok(production.includes("return { available: true, rows: sorted, error: null }"));
assert.ok(production.includes('if (!nativeSourceAvailable)'));
assert.equal(production.includes('if (nativeBatches.length === 0)'), false);
results.push('empty_production_days_are_not_treated_as_source_outages');

const { buildLoyaltyIntegrityReport } = await import('../../base44/functions/auditCustomerAppLoyaltyAfterPhase2/loyaltyIntegrity.js');
const loyaltyReport = buildLoyaltyIntegrityReport({
  members: [{ id: 'member_1', email: 'member@example.org', full_name: 'Member One' }],
  pointsAccounts: [{ id: 'points_1', customer_email: 'member@example.org', total_points: 0, lifetime_points: 0, redeemed_points: 0, points_history: [] }],
});
assert.equal(loyaltyReport.summary.warning_counts.incomplete_profiles, 0);
assert.equal(loyaltyReport.summary.informational_counts.phone_not_provided, 1);
assert.equal(loyaltyReport.exceptions.phone_not_provided.length, 1);
results.push('unsupplied_phone_is_truthful_information_not_a_repair_warning');

const loyaltyAdmin = read('base44/functions/auditCustomerAppLoyaltyAfterPhase2/loyaltyAdmin.ts');
assert.ok(loyaltyAdmin.includes("phoneNotProvided ? 'phone_not_provided'"));
assert.ok(loyaltyAdmin.includes("nameConflict ? 'name_conflict'"));
assert.ok(loyaltyAdmin.includes('verified_name_or_phone_required'));
assert.equal(loyaltyAdmin.includes('complete_name_and_valid_phone_required'), false);
results.push('loyalty_admin_distinguishes_missing_source_data_and_allows_verified_partial_repairs');

const nav = read('src/components/layout/adminNavItems.js');
const primaryNav = nav.slice(0, nav.indexOf('export const adminMobileNavItems'));
const primaryPathCount = [...primaryNav.matchAll(/\{ path: '\/admin\//g)].length;
assert.equal(primaryPathCount, 8);
assert.ok(nav.includes("label: 'Inventory & Purchasing'"));
assert.ok(nav.includes("label: 'Customers & Growth'"));
assert.ok(nav.includes("label: 'Compliance & Audit'"));
assert.ok(nav.includes("label: 'Team & Equipment'"));
assert.equal(nav.includes("label: 'System Health'"), false);
assert.ok(app.includes('path="/admin/sync-health"'));
assert.ok(app.includes('<Navigate to="/admin/operations" replace />'));
assert.ok(nav.includes('(item.matches || []).some'));
results.push('desktop_navigation_is_consolidated_to_eight_operating_areas_and_saved_system_health_links_redirect');

const operations = read('src/pages/admin/Operations.jsx');
assert.ok(operations.includes("badges: ['Live ledger', 'Audited edits']"));
assert.ok(operations.includes('audited acknowledge, resolve, and dismiss controls'));
results.push('operations_catalog_describes_live_controls_accurately');

const operationsSummary = read('base44/functions/getAdminOperationsDashboardSummary/handlers/getAdminOperationsDashboardSummary/entry.ts');
assert.ok(operationsSummary.includes('supersededNotificationCampaignFailureIds'));
assert.ok(operationsSummary.includes("['cancelled', 'sent'].includes"));
assert.ok(operationsSummary.includes('numberOrZero(campaign?.sent_count) === 0'));
results.push('superseded_zero-send_campaign_failures_do_not_remain_permanent_active_warnings');

const campaignsPage = read('src/pages/admin/NotificationCampaigns.jsx');
const campaignCommand = read('base44/functions/getAdminOperationsDashboardSummary/handlers/sendNotificationCampaign/entry.ts');
assert.equal(campaignsPage.includes('base44.entities.NotificationCampaign.create'), false);
assert.ok(campaignsPage.includes("action: 'create_and_send'"));
assert.ok(campaignCommand.includes('notification_campaign_create_and_send'));
assert.ok(campaignCommand.includes('idempotent_replay'));
assert.ok(campaignCommand.includes('deep_link_must_be_a_local_app_path'));
results.push('campaign_creation_and_send_use_one_idempotent_server_command');

const discountPage = read('src/pages/admin/DiscountCodes.jsx');
const discountCommand = read('base44/functions/getAdminOperationsDashboardSummary/handlers/manageAdminDiscountCode/entry.ts');
assert.equal(discountPage.includes('base44.entities.DiscountCode.create'), false);
assert.equal(discountPage.includes('base44.entities.DiscountCode.update'), false);
assert.ok(discountPage.includes("functions.invoke('manageAdminDiscountCode'"));
assert.ok(discountCommand.includes("const VALID_ACTIONS = new Set(['list', 'upsert', 'toggle_active'])"));
assert.ok(discountCommand.includes('idempotency_key: idempotencyKey'));
assert.equal(discountCommand.includes("'delete'"), false);
results.push('discount_codes_use_validated_audited_server_commands_without_delete');

console.log(JSON.stringify({
  success: true,
  suite: 'g73-operations-trust-and-navigation',
  cases: results.length,
  results,
  writes_performed: false,
  provider_calls_performed: false,
}, null, 2));
