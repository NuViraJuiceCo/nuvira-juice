#!/usr/bin/env node
// Read-only structural evidence. This does not certify browser layout or providers.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { isDeepStrictEqual } from 'node:util';
import { execFileSync } from 'node:child_process';
import { parse } from '@babel/parser';
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';
import { transformSync } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PUBLIC_PRODUCT_FALLBACKS } from '../../src/lib/public-product-catalog.js';
import {
  REPO_ROOT, PREVIEW_LABEL, PREVIEW_CSP, LOCAL_CATALOG,
  parseArguments, safeRequestPath, apiReply, injectPreviewBadge, createPreviewHandler,
} from '../qa/serve-desktop-preview.mjs';

const DEFAULT_BASE = 'b0127bdca0c1de2127b41966e2203571346eeecf';
// Separately reviewed website dependency maintenance, not a UI-baseline reset or
// an audit waiver. Native projects and every other protected file stay byte-frozen.
const REVIEWED_DEPENDENCY_SHA256 = Object.freeze({
  'package.json': '464005fa07ded3b212da3da9a49a24e9e395fb10de44c481b2190786485ca445',
  'package-lock.json': '760a20d87988101e0fd6c904a958eb7589857d60623218792e897d36a62ffd2b',
});
const REVIEWED_LOCK_UPDATES = Object.freeze({
  '@capacitor/android': {
    version: '8.4.3',
    resolved: 'https://registry.npmjs.org/@capacitor/android/-/android-8.4.3.tgz',
    integrity: 'sha512-VICd1+E2u5uPvCb5hseoZr84u7/wi334BqayKyXvSLeqURn/iw7nCFEWK29RQNW2rxiW5l1vTVHQ2K6tAJkpTQ==',
    peerDependencies: { '@capacitor/core': '^8.4.0' },
  },
  '@capacitor/core': {
    version: '8.4.3',
    resolved: 'https://registry.npmjs.org/@capacitor/core/-/core-8.4.3.tgz',
    integrity: 'sha512-5S04bZa2I9RabRaqhmwynR54Xkj9x/cKW8R6nXT5ZYg/3JkuOzyIEijIrb18Jra5bMT+f6HX7KonCyvNob6+0g==',
  },
  '@capacitor/ios': {
    version: '8.4.3',
    resolved: 'https://registry.npmjs.org/@capacitor/ios/-/ios-8.4.3.tgz',
    integrity: 'sha512-ziFt4WskFjUFgwCcudhxklcCFMCPNTUk1yVuwutw6xxCvUZzmiOJjVLjDrZ+3A1G02nV+oizUiGPff97htPRIg==',
    peerDependencies: { '@capacitor/core': '^8.4.0' },
  },
  'postcss-selector-parser': {
    version: '7.1.6',
    resolved: 'https://registry.npmjs.org/postcss-selector-parser/-/postcss-selector-parser-7.1.6.tgz',
    integrity: 'sha512-7qASPzhKF2l2KLboRZux8CCTRMdGiV08vWmyKzPz22qZ7ZjQBOeY7rNzNoCLSUiftJ7HUq0GERHmxw/t0dCdMw==',
  },
  'source-map-js': {
    version: '1.2.2',
    resolved: 'https://registry.npmjs.org/source-map-js/-/source-map-js-1.2.2.tgz',
    integrity: 'sha512-KGj/8Y43x35aZVDtt+J4mK1hoLGHULMYfSkODJNQjNDC3oW1PqPoxMwo0pLUsWM/UEGzON/NxeHywEfNXNP3Vw==',
  },
});
const args = process.argv.slice(2);
let base = DEFAULT_BASE;
let dist;
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === '--help' || arg === '-h') {
    console.log('Usage: node scripts/migration/run-desktop-layout-tests.mjs [--base COMMIT] [--dist /absolute/built/dist]\nNo browsers, network requests, servers, or writes. --dist also exercises the preview HTTP handler in memory.');
    process.exit(0);
  }
  assert.ok(['--base', '--dist'].includes(arg) && args[index + 1] && !args[index + 1].startsWith('-'), `Unknown/incomplete argument: ${arg}`);
  if (arg === '--base') base = args[++index];
  else dist = path.resolve(args[++index]);
}

const git = (...gitArgs) => execFileSync('git', gitArgs, { cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024 });
base = git('rev-parse', '--verify', `${base}^{commit}`).toString().trim();
const read = file => fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
const original = file => git('show', `${base}:${file}`).toString();
const checks = [];
const failures = [];
const receipts = {};
function check(label, run) {
  try {
    run();
    checks.push(label);
  } catch (error) {
    failures.push({ check: label, error: error.message.slice(0, 6000) });
  }
}
const ast = source => parse(source, { sourceType: 'module', plugins: ['jsx'], attachComment: false }).program;
const ignored = new Set(['start', 'end', 'loc', 'extra', 'comments', 'leadingComments', 'trailingComments', 'innerComments']);
function clean(value) {
  if (Array.isArray(value)) return value.map(clean);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !ignored.has(key)).map(([key, child]) => [key, clean(child)]));
}
function visit(node, callback) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach(child => visit(child, callback)); return; }
  callback(node);
  for (const [key, value] of Object.entries(node)) if (!ignored.has(key)) visit(value, callback);
}
function classValues(tree) {
  const values = [];
  visit(tree, node => {
    if (node.type === 'JSXOpeningElement') values.push(node.attributes.find(attr => attr.type === 'JSXAttribute' && attr.name.name === 'className')?.value || null);
  });
  return values;
}
const semantic = token => /^(nv-|nuvira-|storefront-)[a-z0-9-]+$/.test(token);
const tokens = value => value.trim().split(/\s+/).filter(Boolean);
function validateLiteral(before, after, label) {
  const oldTokens = tokens(before);
  const newTokens = tokens(after);
  let cursor = 0;
  for (const token of newTokens) {
    if (token === oldTokens[cursor]) cursor += 1;
    else assert.ok(semantic(token), `${label}: only inert nv-/nuvira-/storefront- semantic classes may be added (${token})`);
  }
  assert.equal(cursor, oldTokens.length, `${label}: existing utility classes and order must be preserved`);
}
function validateClasses(before, after, label) {
  if (!before) {
    if (!after) return;
    assert.equal(after.type, 'StringLiteral', `${label}: a new className must be static`);
    validateLiteral('', after.value, label);
    return;
  }
  assert.ok(after, `${label}: className removed`);
  assert.equal(before.type, after.type, `${label}: className expression type changed`);
  if (before.type === 'StringLiteral') return validateLiteral(before.value, after.value, label);
  const oldCopy = clean(before);
  const newCopy = clean(after);
  function compareStrings(left, right) {
    if (!left || typeof left !== 'object') return;
    assert.ok(right && typeof right === 'object', `${label}: className expression changed`);
    if (left.type === 'StringLiteral') {
      validateLiteral(left.value, right.value, label);
      left.value = right.value = '<classes>';
    } else if (left.type === 'TemplateElement') {
      validateLiteral(left.value.cooked || '', right.value.cooked || '', label);
      left.value = right.value = { raw: '<classes>', cooked: '<classes>' };
    }
    for (const [key, child] of Object.entries(left)) {
      if (Array.isArray(child)) child.forEach((item, index) => compareStrings(item, right[key]?.[index]));
      else if (child && typeof child === 'object') compareStrings(child, right[key]);
    }
  }
  compareStrings(oldCopy, newCopy);
  assert.deepEqual(newCopy, oldCopy, `${label}: dynamic class logic must be unchanged`);
}
function stripClassAttributes(tree) {
  visit(tree, node => {
    if (node.type === 'JSXOpeningElement') node.attributes = node.attributes.filter(attr => !(attr.type === 'JSXAttribute' && attr.name.name === 'className'));
  });
  return clean(tree);
}

function stripApprovedProductRowVariable(tree) {
  const expected = ast('<div style={{ "--desktop-product-columns": Math.min(products.length, 4) }} />;')
    .body[0].expression.openingElement.attributes[0];
  let count = 0;
  visit(tree, node => {
    if (node.type !== 'JSXOpeningElement') return;
    node.attributes = node.attributes.filter(attr => {
      const properties = attr.value?.expression?.properties;
      if (attr.type !== 'JSXAttribute' || attr.name.name !== 'style' ||
        !properties?.some(property => property.key?.value === '--desktop-product-columns')) return true;
      assert.deepEqual(clean(attr), clean(expected), 'ProductRow exception must be exactly the approved presentational property/expression');
      count += 1;
      return false;
    });
  });
  assert.equal(count, 1, 'ProductRow must have exactly one approved custom-property exception');
}

const changed = git('diff', '--name-only', base, '--', 'src').toString().trim().split('\n').filter(Boolean);
const protectedFiles = git('ls-tree', '-r', '--name-only', base).toString().trim().split('\n').filter(file =>
  /^(src\/(lib|api|components\/checkout)\/|base44\/|functions\/|ios\/|android\/|shopify\/|patches\/)/.test(file) ||
  /^(package(-lock)?\.json|capacitor\.config\.[^/]+|vite\.config\.[^/]+|src\/App\.jsx|index\.html)$/.test(file));
check('Business rules, prices, catalog, auth/API, checkout, backend, native and providers preserve baseline bytes; dependencies match the exact reviewed security receipt', () => {
  for (const file of protectedFiles) {
    const baselineHash = crypto.createHash('sha256').update(git('show', `${base}:${file}`)).digest('hex');
    const currentHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(REPO_ROOT, file))).digest('hex');
    const expectedHash = REVIEWED_DEPENDENCY_SHA256[file] || baselineHash;
    assert.equal(currentHash, expectedHash, `Protected source changed outside its exact reviewed bytes: ${file}`);
    receipts[file] = currentHash;
  }
});
check('Dependency maintenance has only three exact Capacitor pins and two overrides; exactly five lock packages change and none are added or removed', () => {
  // Always compare dependency scope with the fixed pre-desktop source, even if a
  // caller uses --base for an additional UI comparison.
  const beforeManifest = JSON.parse(git('show', `${DEFAULT_BASE}:package.json`).toString());
  const beforeLock = JSON.parse(git('show', `${DEFAULT_BASE}:package-lock.json`).toString());
  const afterManifest = JSON.parse(read('package.json'));
  const afterLock = JSON.parse(read('package-lock.json'));
  const expectedManifest = structuredClone(beforeManifest);
  const expectedLock = structuredClone(beforeLock);
  for (const name of ['@capacitor/android', '@capacitor/core', '@capacitor/ios']) {
    expectedManifest.dependencies[name] = '8.4.3';
    expectedLock.packages[''].dependencies[name] = '8.4.3';
  }
  assert.equal(beforeManifest.overrides, undefined, 'Dependency review requires the original override-free manifest');
  expectedManifest.overrides = { 'postcss-selector-parser': '7.1.6', 'source-map-js': '1.2.2' };
  assert.deepEqual(afterManifest, expectedManifest, 'Manifest changed beyond the three reviewed exact pins and two overrides');
  assert.deepEqual(Object.keys(afterLock.packages).sort(), Object.keys(beforeLock.packages).sort(), 'Lock packages were added or removed');
  const changedPackages = Object.keys(beforeLock.packages).filter(name => name &&
    !isDeepStrictEqual(beforeLock.packages[name], afterLock.packages[name])).sort();
  assert.deepEqual(changedPackages, Object.keys(REVIEWED_LOCK_UPDATES).map(name => `node_modules/${name}`).sort(),
    'Exactly the five reviewed lock package entries must change');
  for (const [name, update] of Object.entries(REVIEWED_LOCK_UPDATES)) {
    Object.assign(expectedLock.packages[`node_modules/${name}`], update);
  }
  assert.deepEqual(afterLock, expectedLock, 'Lock metadata or package contents changed beyond the exact reviewed update');
});

const classOnlyFiles = changed.filter(file => file.endsWith('.jsx') && !['src/main.jsx', 'src/components/layout/AppLayout.jsx'].includes(file));
check('ProductRow has only the exact approved --desktop-product-columns: Math.min(products.length, 4) presentational exception', () => {
  stripApprovedProductRowVariable(ast(read('src/components/home/ProductRow.jsx')));
});
check('Changed JSX outside the shell has only added semantic classes and the approved ProductRow CSS variable; original utilities, handlers, markup and business logic are unchanged', () => {
  assert.ok(classOnlyFiles.length > 0, 'Expected desktop semantic class hooks');
  for (const file of classOnlyFiles) {
    const before = ast(original(file));
    const after = ast(read(file));
    if (file === 'src/components/home/ProductRow.jsx') stripApprovedProductRowVariable(after);
    const oldClasses = classValues(before);
    const newClasses = classValues(after);
    assert.equal(newClasses.length, oldClasses.length, `${file}: JSX structure changed`);
    oldClasses.forEach((value, index) => validateClasses(value, newClasses[index], `${file} element ${index}`));
    assert.deepEqual(stripClassAttributes(after), stripClassAttributes(before), `${file}: change outside semantic className additions`);
  }
});

const CSS_FILES = ['src/styles/desktop-storefront.css', 'src/styles/desktop-home.css', 'src/styles/desktop-utility.css'];
check('No other source files or new business/native/backend files are introduced by the desktop patch', () => {
  const allowed = new Set([...classOnlyFiles, ...CSS_FILES, 'src/main.jsx', 'src/components/layout/AppLayout.jsx']);
  for (const file of changed) assert.ok(allowed.has(file), `Unexpected source change: ${file}`);
  const untrackedSource = git('ls-files', '--others', '--exclude-standard', '--', 'src').toString().trim().split('\n').filter(Boolean);
  for (const file of untrackedSource) assert.ok(CSS_FILES.includes(file), `Unexpected new source: ${file}`);
  const untrackedProtected = git('ls-files', '--others', '--exclude-standard', '--', 'base44', 'functions', 'ios', 'android', 'shopify', 'patches').toString().trim();
  assert.equal(untrackedProtected, '', 'New files in protected operational/native paths are out of scope');
});
check('Main entry changes only import the three desktop stylesheets; existing global CSS is untouched', () => {
  const before = ast(original('src/main.jsx'));
  const after = ast(read('src/main.jsx'));
  const imports = after.body.filter(node => node.type === 'ImportDeclaration' && CSS_FILES.includes(node.source.value.replace(/^@\//, 'src/')));
  assert.equal(imports.length, CSS_FILES.length);
  after.body = after.body.filter(node => !imports.includes(node));
  assert.deepEqual(clean(after), clean(before));
  assert.equal(read('src/index.css'), original('src/index.css'));
});

let desktopRuleCount = 0;
check('Every desktop CSS rule is scoped to the non-native storefront and a minimum viewport width of at least 1024px', () => {
  for (const file of CSS_FILES) {
    const css = postcss.parse(read(file), { from: file });
    css.walkAtRules(rule => assert.ok(['media', 'supports'].includes(rule.name), `${file}: unexpected global @${rule.name}`));
    css.walkRules(rule => {
      desktopRuleCount += 1;
      let parent = rule.parent;
      let desktopGuard = false;
      while (parent && parent.type !== 'root') {
        if (parent.type === 'atrule' && parent.name === 'media') {
          desktopGuard ||= parent.params.split(',').every(query => {
            const width = query.match(/\(\s*min-width\s*:\s*(\d+)px\s*\)/i);
            return width && Number(width[1]) >= 1024;
          });
        }
        parent = parent.parent;
      }
      assert.ok(desktopGuard, `${file}: rule lacks >=1024px guard: ${rule.selector}`);
      selectorParser(selectors => selectors.each(selector => {
        let scoped = false;
        selector.walkAttributes(attribute => {
          if (attribute.attribute !== 'data-desktop-storefront' || attribute.operator !== '=' || attribute.value !== 'true') return;
          // An attribute inside :not() or another selector function is not a scope boundary.
          if (attribute.parent === selector) scoped = true;
        });
        assert.ok(scoped, `${file}: selector lacks direct storefront scope: ${selector}`);
      })).processSync(rule.selector);
    });
    css.walkDecls(declaration => assert.equal(declaration.parent.type, 'rule', `${file}: declaration escapes a scoped rule`));
  }
  assert.ok(desktopRuleCount > 0);
});

check('AppLayout additions are only the native/admin exclusion, route data hook and inert class hooks', () => {
  const before = ast(original('src/components/layout/AppLayout.jsx'));
  const after = ast(read('src/components/layout/AppLayout.jsx'));
  const runtimeImports = after.body.filter(node => node.type === 'ImportDeclaration' && node.source.value === '@/lib/nativeRuntime');
  assert.equal(runtimeImports.length, 1);
  assert.deepEqual(runtimeImports[0].specifiers.map(node => node.imported?.name), ['isNativeAppRuntime']);
  after.body = after.body.filter(node => !runtimeImports.includes(node));
  const addedAttributes = [];
  visit(after, node => {
    if (node.type !== 'JSXOpeningElement') return;
    node.attributes = node.attributes.filter(attr => {
      if (attr.type === 'JSXAttribute' && ['data-desktop-storefront', 'data-storefront-page'].includes(attr.name.name)) {
        addedAttributes.push(attr.name.name);
        return false;
      }
      return true;
    });
  });
  assert.deepEqual(addedAttributes.sort(), ['data-desktop-storefront', 'data-storefront-page']);
  const oldClasses = classValues(before);
  const newClasses = classValues(after);
  assert.equal(newClasses.length, oldClasses.length);
  oldClasses.forEach((value, index) => validateClasses(value, newClasses[index], `AppLayout element ${index}`));
  assert.deepEqual(stripClassAttributes(after), stripClassAttributes(before));
});

check('Actual AppLayout renders desktop scope for browser customer routes, never for admin or native routes', () => {
  let pathname = '/';
  let native = false;
  const noContent = () => null;
  const imports = {
    react: React,
    'react-router-dom': { useLocation: () => ({ pathname }), Outlet: () => React.createElement('div', null, 'Page') },
    'framer-motion': { AnimatePresence: ({ children }) => children, motion: { div: ({ children }) => React.createElement('div', null, children) } },
    './MobileNav': { default: noContent }, './SideNav': { default: noContent },
    '@/lib/nativeRuntime': { isNativeAppRuntime: () => native },
  };
  const module = { exports: {} };
  const { code } = transformSync(read('src/components/layout/AppLayout.jsx'), { loader: 'jsx', format: 'cjs' });
  vm.runInNewContext(code, { module, exports: module.exports, require: name => {
    assert.ok(Object.hasOwn(imports, name), `Unexpected AppLayout dependency: ${name}`);
    return { __esModule: true, ...imports[name], ...(name === 'react' ? { default: React } : {}) };
  } });
  const AppLayout = module.exports.default;
  for (const route of ['/', '/shop', '/cart', '/product/oasis.html', '/program/radiance', '/about', '/contact', '/support', '/rewards', '/account', '/admin', '/admin/orders']) {
    pathname = route;
    for (native of [false, true]) {
      const html = renderToStaticMarkup(React.createElement(AppLayout));
      assert.equal(html.includes('data-desktop-storefront="true"'), !native && !route.startsWith('/admin'), `${route} native=${native}`);
      assert.equal(html.includes('data-admin-shell="true"'), route.startsWith('/admin'));
      assert.ok(html.includes(`data-storefront-page="${route}"`));
    }
  }
});

check('Preview uses unchanged historical public catalog values with only existing local photo paths', () => {
  assert.equal(LOCAL_CATALOG.length, PUBLIC_PRODUCT_FALLBACKS.length);
  for (let index = 0; index < LOCAL_CATALOG.length; index += 1) {
    const { image_url: localImage, ...localProduct } = LOCAL_CATALOG[index];
    const { image_url: _externalImage, ...originalProduct } = PUBLIC_PRODUCT_FALLBACKS[index];
    assert.deepEqual(localProduct, originalProduct);
    assert.ok(localImage.startsWith('/images/'));
    assert.ok(fs.statSync(path.join(REPO_ROOT, 'public', localImage)).isFile());
  }
});

check('Preview denies functions, protected/unknown API reads and invalid auth; only catalog and explicit public empty lists succeed', () => {
  const prefix = '/api/apps/69d48d0c39891f7945481152';
  const query = new URLSearchParams({ q: JSON.stringify({ category: 'juice', is_available: true }), limit: '2' });
  const result = apiReply(`${prefix}/entities/Product`, query);
  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(result.body), LOCAL_CATALOG.filter(product => product.category === 'juice').slice(0, 2));
  for (const name of ['Banner', 'SubscriptionBundle', 'DeliverySchedule', 'Event']) {
    assert.deepEqual(JSON.parse(apiReply(`${prefix}/entities/${name}`, new URLSearchParams()).body), []);
  }
  for (const route of [`${prefix}/entities/Order`, `${prefix}/entities/Notification`, `${prefix}/entities/UserProfile`, `${prefix}/functions/createOrder`, '/api/unknown', '/api/apps/wrong-app/entities/Product']) {
    assert.equal(apiReply(route, new URLSearchParams()).status, 403, route);
  }
  for (const route of ['/api/auth/me', `${prefix}/auth/me`, `${prefix}/entities/User/me`]) assert.equal(apiReply(route, new URLSearchParams()).status, 401);
  for (const badQuery of ['q=%7B', 'q=null', 'q=%5B%5D', 'limit=-1', 'skip=abc', 'q=%7B%22id%22%3A%7B%22%24ne%22%3Anull%7D%7D']) {
    assert.equal(apiReply(`${prefix}/entities/Product`, new URLSearchParams(badQuery)).status, 400);
  }
});

check('Preview is loopback-only, has no outbound client/proxy, blocks external CSP resources and injects the disclosure outside React', () => {
  assert.equal(parseArguments([]).dist, path.join(REPO_ROOT, 'dist'));
  assert.equal(parseArguments([]).port, 4196);
  assert.equal(parseArguments(['--dist', '/tmp/baseline/dist', '--port', '4197']).port, 4197);
  for (const raw of ['/../secret', '/%2e%2e/secret', '/assets/%2e%2e/secret', '/%2F..%2Fsecret', '/x\\..\\secret', '//example.test/x', '/%00', '/%zz']) assert.throws(() => safeRequestPath(raw));
  assert.equal(safeRequestPath('/product/oasis.html?q=test'), '/product/oasis.html');
  for (const directive of ["default-src 'none'", "connect-src 'self'", "img-src 'self' data:", "form-action 'none'", "frame-src 'none'", "frame-ancestors 'none'", "worker-src 'none'"]) assert.ok(PREVIEW_CSP.includes(directive));
  assert.doesNotMatch(PREVIEW_CSP, /https?:|\*|unsafe-eval|script-src[^;]*unsafe-inline/);
  const previewSource = read('scripts/qa/serve-desktop-preview.mjs');
  assert.match(previewSource, /server\.listen\(options\.port, '127\.0\.0\.1'/);
  assert.doesNotMatch(previewSource, /\bfetch\s*\(|\bhttps\b|http\.(?:request|get)\s*\(|\b(?:axios|undici|proxy)\s*\(/);
  const html = injectPreviewBadge('<html><body><div id="root"></div></body></html>');
  assert.ok(html.includes(PREVIEW_LABEL));
  assert.ok(html.indexOf('data-desktop-preview-badge') < html.indexOf('id="root"'));
});

if (dist) {
  const handler = await createPreviewHandler({ dist, port: 4196 });
  async function request(method, url, headers = {}) {
    const response = { statusCode: 200, headers: {}, setHeader(name, value) { this.headers[name] = value; }, end(body) { this.body = body; } };
    await handler({ method, url, headers: { host: '127.0.0.1:4196', ...headers } }, response);
    return response;
  }
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    for (const url of ['/', '/api/apps/69d48d0c39891f7945481152/entities/Product', '/api/apps/69d48d0c39891f7945481152/functions/createOrder']) {
      assert.equal((await request(method, url)).statusCode, 403, `${method} ${url}`);
    }
  }
  assert.equal((await request('GET', '/api/apps/69d48d0c39891f7945481152/functions/readSomething')).statusCode, 403);
  assert.equal((await request('GET', '/api/auth/me')).statusCode, 401);
  assert.equal((await request('GET', '/api/unrecognized')).statusCode, 403);
  assert.equal((await request('GET', '/unknown', { accept: 'application/json' })).statusCode, 403);
  assert.equal((await request('GET', '/%2e%2e/package.json')).statusCode, 400);
  assert.equal((await request('GET', '/missing.js')).statusCode, 404);
  assert.equal((await request('GET', '/', { host: 'outside.test' })).statusCode, 403);
  const page = await request('GET', '/shop');
  assert.equal(page.statusCode, 200);
  assert.ok(page.body.toString().includes(PREVIEW_LABEL));
  assert.equal(page.headers['Content-Security-Policy'], PREVIEW_CSP);
  const head = await request('HEAD', '/shop');
  assert.equal(head.statusCode, 200);
  assert.equal(head.body, undefined);
  assert.equal(head.headers['Content-Length'], page.headers['Content-Length']);
  checks.push('Built preview handler denies all mutation methods/functions/unknown reads/traversal; HEAD has no body; no server or network was started');
}

console.log(JSON.stringify({
  ok: failures.length === 0, baseline: base, checks, failures, desktop_css_rules: desktopRuleCount,
  markup_only_files: classOnlyFiles, protected_files_verified: protectedFiles.length,
  protected_sha256: receipts, built_preview_handler_checked: Boolean(dist),
  dependency_review: { baseline: DEFAULT_BASE, sha256: REVIEWED_DEPENDENCY_SHA256,
    changed_lock_packages: Object.keys(REVIEWED_LOCK_UPDATES), added_lock_packages: 0, removed_lock_packages: 0 },
  limitation: 'Structural and local-handler evidence only. Browser geometry, interaction, mobile visual parity, native devices, live auth/checkout/providers and analytics require separate verification.',
}, null, 2));
if (failures.length) process.exitCode = 1;
