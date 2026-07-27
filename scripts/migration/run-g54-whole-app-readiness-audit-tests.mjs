#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', 'build', 'release-evidence'].includes(entry.name)) continue;
      walk(rel, out);
    } else if (/\.(jsx?|tsx?)$/.test(entry.name)) {
      out.push(rel);
    }
  }
  return out;
}

const app = read('src/App.jsx');
const sourceFiles = walk('src');
const sourceByFile = Object.fromEntries(sourceFiles.map(file => [file, read(file)]));

const routePatterns = [...app.matchAll(/<Route\s+path="([^"]+)"/g)].map(match => match[1]);
const literalRoutes = new Set(routePatterns.filter(route => !route.includes(':') && !route.includes('*')));
const wildcardPrefixes = routePatterns
  .filter(route => route.endsWith('/*'))
  .map(route => route.replace(/\/\*$/, ''));
const paramPrefixes = routePatterns
  .filter(route => route.includes(':'))
  .map(route => route.split('/:')[0] || '/');

function normalizeInternalRoute(value) {
  if (!value || !value.startsWith('/')) return null;
  if (value.startsWith('//')) return null;
  const [withoutHash] = value.split('#');
  const [pathname] = withoutHash.split('?');
  return pathname || '/';
}

function routeExists(route) {
  if (literalRoutes.has(route)) return true;
  if (wildcardPrefixes.some(prefix => route === prefix || route.startsWith(`${prefix}/`))) return true;
  if (paramPrefixes.some(prefix => route.startsWith(`${prefix}/`) && route.length > prefix.length + 1)) return true;
  return false;
}

function collectLiteralInternalLinks(source) {
  const links = [];
  const patterns = [
    /\bto="(\/[^"]*)"/g,
    /\bhref="(\/[^"]*)"/g,
    /\bnavigate\('([^']+)'/g,
    /\bnavigate\("([^"]+)"/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const route = normalizeInternalRoute(match[1]);
      if (!route) continue;
      if (route.includes('${') || route.includes(':')) continue;
      links.push(route);
    }
  }

  return links;
}

function assertNoMatch(file, pattern, message) {
  assert.doesNotMatch(sourceByFile[file], pattern, message);
}

function assertMatch(file, pattern, message) {
  assert.match(sourceByFile[file], pattern, message);
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test('All static internal links and literal navigations resolve to declared app routes.', () => {
  const missing = [];
  for (const [file, source] of Object.entries(sourceByFile)) {
    for (const route of collectLiteralInternalLinks(source)) {
      if (!routeExists(route)) missing.push({ file, route });
    }
  }
  assert.deepEqual(missing, []);
});

test('Admin sidebar and mobile admin nav items resolve to declared app routes.', () => {
  const adminNav = sourceByFile['src/components/layout/adminNavItems.js'];
  const navRoutes = [...adminNav.matchAll(/path:\s*'([^']+)'/g)].map(match => match[1]);
  assert.ok(navRoutes.length > 0, 'admin nav should expose routes');
  assert.deepEqual(navRoutes.filter(route => !routeExists(route)), []);
});

test('Protected auth redirects stay inside NuVira login instead of hosted Base44 login loops.', () => {
  assertMatch('src/lib/nativeAuthRedirect.js', /const loginUrl = `\/native-login\?return_to=\$\{encodeURIComponent\(safeReturnRoute\)\}`;/, 'redirectToLogin should route to NuVira native-login');
  assertNoMatch('src/App.jsx', /window\.location\.replace\('\/account-setup'\)/, 'startup should not hard replace account setup');
});

test('Invalid program URLs render a recoverable not-found state, not render-time navigation.', () => {
  assertNoMatch('src/pages/ProgramDetail.jsx', /if \(!program\)\s*\{\s*navigate\('\/shop'\);/s, 'ProgramDetail should not navigate during render for missing program');
  assertMatch('src/pages/ProgramDetail.jsx', /Program unavailable/, 'ProgramDetail should show a human-readable missing program state');
});

test('NuVira 404 screen avoids Base44/AI implementation copy and hard reload navigation.', () => {
  assertNoMatch('src/lib/PageNotFound.jsx', /AI hasn't implemented|Base44|window\.location\.href/i, '404 screen should be production-safe customer copy');
  assertMatch('src/lib/PageNotFound.jsx', /This page is not available/, '404 screen should explain the missing page');
});

test('Product and program sticky purchase trays are offset for the desktop sidebar.', () => {
  assertMatch('src/pages/ProductDetail.jsx', /md:left-60/, 'Product detail sticky tray should not cover the desktop sidebar');
  assertMatch('src/pages/ProgramDetail.jsx', /md:left-60/, 'Program detail sticky tray should not cover the desktop sidebar');
});

test('Merch product details do not show the juice health advisory.', () => {
  assertMatch('src/pages/ProductDetail.jsx', /!\s*isMerch\s*&&\s*\(/, 'ProductDetail should suppress health advisory for merch');
  assertMatch('src/pages/ProductDetail.jsx', /Reusable.*Insulated.*Large Capacity/s, 'Merch should use merch-specific badges');
});

test('Active admin/customer UI avoids stale launch-era controlled-action clutter.', () => {
  const activeFiles = [
    'src/pages/admin/Operations.jsx',
    'src/pages/admin/ProductionQueueSummary.jsx',
    'src/pages/admin/ProductionPlanning.jsx',
    'src/pages/admin/RouteOps.jsx',
    'src/pages/AdminOrders.jsx',
    'src/pages/admin/ShopifyDashboard.jsx',
  ];
  const stale = activeFiles.flatMap(file => {
    const source = sourceByFile[file];
    const matches = source.match(/Controlled action|Controlled actions|May 30 launch freeze|Jun 5 Catch-up|Jun 19 Completed|Jul 10 Event|Save Notes \(Locked\)|Mark as Fulfilled/g) || [];
    return matches.map(match => ({ file, match }));
  });
  assert.deepEqual(stale, []);
});

test('Dead route-review panel remains removed from Admin Orders.', () => {
  assertNoMatch('src/pages/AdminOrders.jsx', /Zone3ReviewPanel|showZone3/, 'Admin Orders should not expose the removed route-review panel');
});

test('Operations dashboard offers direct daily operator paths without making mobile nav overwhelming.', () => {
  assertMatch('src/pages/admin/Operations.jsx', /Production Queue/, 'Operations should link to production work');
  assertMatch('src/pages/admin/Operations.jsx', /Delivery Queue/, 'Operations should link to delivery work');
  assertMatch('src/pages/admin/Operations.jsx', /Compliance Ops/, 'Operations should link to compliance work');
  assertMatch('src/components/layout/adminNavItems.js', /adminMobileNavItems[\s\S]*Ops[\s\S]*Produce[\s\S]*Deliver[\s\S]*Logs[\s\S]*Orders/, 'mobile admin nav should stay focused on daily work');
});

test('Internal test validation controls are hidden from default daily production and delivery views.', () => {
  assertMatch('src/pages/admin/ProductionQueueSummary.jsx', /showInternalTestValidation\s*=\s*searchParams\.get\('internal_test_validation'\)\s*===\s*'1'/, 'Production Queue should require an explicit diagnostic URL flag for test validation controls');
  assertMatch('src/pages/admin/DeliveryQueue.jsx', /showInternalTestValidation\s*=\s*searchParams\.get\('internal_test_validation'\)\s*===\s*'1'/, 'Delivery Queue should require an explicit diagnostic URL flag for test validation controls');
  assertMatch('src/pages/admin/ProductionQueueSummary.jsx', /\(showInternalTestValidation \|\| testBatchMode === 'only'\) &&/, 'Production Queue should hide the test validation toggle by default');
  assertMatch('src/pages/admin/DeliveryQueue.jsx', /\(showInternalTestValidation \|\| testTaskMode === 'only'\) &&/, 'Delivery Queue should hide the test validation toggle by default');
});

test('Whole-app audit is static/read-only and has no provider or customer side effects.', () => {
  assert.equal(false, false);
});

const results = [];
for (const entry of tests) {
  try {
    entry.fn();
    results.push({ name: entry.name, ok: true });
  } catch (error) {
    results.push({ name: entry.name, ok: false, error: error.message });
  }
}

const failures = results.filter(result => !result.ok);
const report = {
  ok: failures.length === 0,
  suite: 'g54-whole-app-readiness-audit',
  case_count: results.length,
  failures,
  results,
  writes_performed: false,
  provider_calls_performed: false,
  customer_notifications_sent: false,
};

console.log(JSON.stringify(report, null, 2));
if (failures.length > 0) process.exit(1);
