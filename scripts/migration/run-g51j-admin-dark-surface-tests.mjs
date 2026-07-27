#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const appLayoutPath = 'src/components/layout/AppLayout.jsx';
const cssPath = 'src/index.css';
const adminNavPath = 'src/components/layout/adminNavItems.js';
const operationsPath = 'src/pages/admin/Operations.jsx';
const deliveryQueuePath = 'src/pages/admin/DeliveryQueue.jsx';
const routeOpsPath = 'src/pages/admin/RouteOps.jsx';
const adminOrdersPath = 'src/pages/AdminOrders.jsx';
const appPath = 'src/App.jsx';
const appLayoutSource = fs.readFileSync(appLayoutPath, 'utf8');
const cssSource = fs.readFileSync(cssPath, 'utf8');
const adminNavSource = fs.readFileSync(adminNavPath, 'utf8');
const operationsSource = fs.readFileSync(operationsPath, 'utf8');
const deliveryQueueSource = fs.readFileSync(deliveryQueuePath, 'utf8');
const routeOpsSource = fs.readFileSync(routeOpsPath, 'utf8');
const adminOrdersSource = fs.readFileSync(adminOrdersPath, 'utf8');
const appSource = fs.readFileSync(appPath, 'utf8');

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test('1. App layout marks admin routes with a scoped admin shell attribute', () => {
  assert.match(appLayoutSource, /const adminShell = location\.pathname\.startsWith\('\/admin'\)/);
  assert.match(appLayoutSource, /data-admin-shell=\{adminShell \? 'true' : undefined\}/);
});

test('2. App layout gives admin routes their own shell width and bottom padding', () => {
  assert.match(appLayoutSource, /const mainClassName = adminShell/);
  assert.match(appLayoutSource, /max-w-none mx-auto overflow-x-hidden w-full/);
  assert.match(appLayoutSource, /pb-\[calc\(5rem\+env\(safe-area-inset-bottom\)\)\] md:pb-0/);
});

test('3. Admin desktop navigation exposes all routed operational surfaces', () => {
  for (const route of [
    '/admin/operations',
    '/admin/production-queue',
    '/admin/delivery-queue',
    '/admin/route-ops',
    '/admin/compliance-ops',
    '/admin/orders',
    '/admin/pos-orders',
    '/admin/shopify',
    '/admin/live-monitor',
    '/admin/bag-returns',
    '/admin/production-planning',
    '/admin/inventory-status',
    '/admin/purchase-orders',
    '/admin/suppliers',
    '/admin/calendar',
    '/admin/events',
    '/admin/products',
    '/admin/notifications',
    '/admin/loyalty-members',
    '/admin/resources',
    '/admin/ops-alerts',
    '/admin/review-queue',
    '/admin/reporting',
    '/admin/audit-trail',
    '/admin/sync-health',
    '/admin/sync-status',
  ]) {
    assert.match(adminNavSource, new RegExp(`path: '${route}'`));
  }
});

test('4. Operations page does not double-count large mobile bottom padding', () => {
  assert.doesNotMatch(operationsSource, /pb-\[calc\(9rem\+env\(safe-area-inset-bottom\)\)\]/);
  assert.match(operationsSource, /min-h-screen bg-background pb-6 md:pb-10/);
});

test('5. Admin dark-mode layer is scoped and does not target customer pages globally', () => {
  assert.match(cssSource, /\.dark \[data-admin-shell="true"\]/);
  assert.doesNotMatch(cssSource, /\.dark \.bg-white\s*\{/);
});

test('6. Admin dark-mode layer covers common light surface leftovers', () => {
  for (const token of ['bg-white', 'bg-red-50', 'bg-green-50', 'bg-blue-50', 'bg-amber-50']) {
    assert.match(cssSource, new RegExp(`\\[class\\*="${token}"\\]`));
  }
});

test('7. Admin dark-mode layer covers common light text and border leftovers', () => {
  for (const token of ['text-red-', 'text-green-', 'text-blue-', 'border-red-', 'border-green-', 'border-blue-']) {
    assert.match(cssSource, new RegExp(`\\[class\\*="${token}"\\]`));
  }
});

test('8. Dialog-specific dark-mode guard remains in place for real modals', () => {
  assert.match(cssSource, /\.dark \[role="dialog"\]/);
  assert.match(cssSource, /\[role="dialog"\] input/);
});

test('9. Legacy admin delivery paths redirect to the live Delivery Queue', () => {
  assert.match(appSource, /path="\/admin\/delivery" element=\{<AdminRedirect to="\/admin\/delivery-queue" user=\{user\} \/>\}/);
  assert.match(appSource, /path="\/admin\/delivery\/\*" element=\{<AdminRedirect to="\/admin\/delivery-queue" user=\{user\} \/>\}/);
});

test('10. Hub parity admin routes are first-class customer app admin pages or safe redirects', () => {
  for (const route of [
    '/admin/route-ops',
    '/admin/events',
    '/admin/purchase-orders',
    '/admin/suppliers',
    '/admin/reporting',
    '/admin/review-queue',
    '/admin/audit-trail',
  ]) {
    assert.match(appSource, new RegExp(`path="${route}"`));
  }
  assert.match(appSource, /path="\/admin\/route-optimizer" element=\{<AdminRedirect to="\/admin\/route-ops" user=\{user\} \/>\}/);
  assert.match(appSource, /path="\/admin\/delivery-route-reviews" element=\{<AdminRedirect to="\/admin\/route-ops" user=\{user\} \/>\}/);
  assert.match(appSource, /path="\/admin\/refund-reconciliation" element=\{<AdminRedirect to="\/admin\/review-queue" user=\{user\} \/>\}/);
  assert.match(appSource, /path="\/admin\/audit-logs" element=\{<AdminRedirect to="\/admin\/audit-trail" user=\{user\} \/>\}/);
});

test('11. Delivery and route surfaces deep-link into order detail context without adding writes', () => {
  assert.match(deliveryQueueSource, /import \{ Link, useSearchParams \} from 'react-router-dom';/);
  assert.match(deliveryQueueSource, /ArrowRight/);
  assert.match(deliveryQueueSource, /to=\{`\/admin\/orders\?order=\$\{encodeURIComponent\(orderRef\)\}`\}/);
  assert.match(routeOpsSource, /to=\{`\/admin\/orders\?order=\$\{encodeURIComponent\(orderRef\)\}`\}/);
});

test('12. Order Management accepts query-driven focus for route and delivery handoffs', () => {
  assert.match(adminOrdersSource, /useSearchParams/);
  assert.match(adminOrdersSource, /searchParams\.get\('order'\)/);
  assert.match(adminOrdersSource, /setFocusedOrderKey\(orderKey\(match\)\)/);
  assert.match(adminOrdersSource, /admin-orders-detail-list/);
});

for (const item of tests) {
  item.fn();
}

console.log(JSON.stringify({
  success: true,
  suite: 'g51j-admin-dark-surface',
  cases: tests.length,
  writes_performed: false,
  provider_calls_performed: false,
}, null, 2));
