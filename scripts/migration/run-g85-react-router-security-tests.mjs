#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const packageLock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
const appSource = fs.readFileSync('src/App.jsx', 'utf8');

function versionTuple(value) {
  const match = String(value || '').match(/^(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, `invalid semantic version: ${value}`);
  return match.slice(1).map(Number);
}

function isAtLeast(actual, minimum) {
  for (let index = 0; index < minimum.length; index += 1) {
    if (actual[index] > minimum[index]) return true;
    if (actual[index] < minimum[index]) return false;
  }
  return true;
}

const declaredRange = packageJson.dependencies?.['react-router-dom'];
const lockedDomVersion = packageLock.packages?.['node_modules/react-router-dom']?.version;
const lockedCoreVersion = packageLock.packages?.['node_modules/react-router']?.version;

assert.equal(declaredRange, '^7.18.2', 'React Router must remain on the reviewed patched v7 line');
assert.equal(lockedDomVersion, lockedCoreVersion, 'React Router DOM and core must resolve to the same version');
assert.ok(
  isAtLeast(versionTuple(lockedDomVersion), [7, 18, 2]),
  `React Router ${lockedDomVersion} does not include the reviewed security fixes`,
);
assert.match(appSource, /BrowserRouter as Router/);
assert.doesNotMatch(appSource, /createBrowserRouter|RouterProvider|hydrateRoot/);

const router = await import('react-router-dom');
for (const exportName of [
  'BrowserRouter',
  'Link',
  'Navigate',
  'Route',
  'Routes',
  'useLocation',
  'useNavigate',
  'useParams',
  'useSearchParams',
]) {
  assert.ok(router[exportName], `react-router-dom v7 must preserve ${exportName}`);
}

const productMatch = router.matchPath('/products/:handle', '/products/oasis');
assert.equal(productMatch?.params?.handle, 'oasis');
const adminSplatMatch = router.matchPath('/admin/delivery/*', '/admin/delivery/legacy-stop');
assert.equal(adminSplatMatch?.params?.['*'], 'legacy-stop');

console.log(JSON.stringify({
  ok: true,
  suite: 'g85-react-router-security',
  react_router_dom: lockedDomVersion,
  react_router: lockedCoreVersion,
  routing_mode: 'declarative',
  writes_performed: false,
  provider_calls_performed: false,
}, null, 2));
