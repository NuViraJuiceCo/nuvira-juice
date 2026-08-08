#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const appParamsPath = path.join(repoRoot, 'src/lib/app-params.js');
const source = fs.readFileSync(appParamsPath, 'utf8');

function executeAppParams({ hostname, href, native, storedFunctionsVersion, search = '' }) {
  const values = new Map();
  if (storedFunctionsVersion) values.set('base44_functions_version', storedFunctionsVersion);
  const removals = [];
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => {
      removals.push(key);
      values.delete(key);
    },
  };
  const window = {
    localStorage: storage,
    location: {
      hostname,
      href,
      pathname: '/',
      search,
      hash: '',
    },
    history: { replaceState() {} },
  };
  const executable = source
    .replace(/^import .*$/gm, '')
    .replace(/import\.meta\.env\.VITE_BASE44_[A-Z_]+/g, 'undefined')
    .replace(/export const appParams\s*=/, 'globalThis.appParams =');
  const context = vm.createContext({
    window,
    document: { title: 'NuVira' },
    URLSearchParams,
    Map,
    Capacitor: { isNativePlatform: () => native },
  });
  vm.runInContext(executable, context, { filename: appParamsPath });
  return { appParams: context.appParams, values, removals };
}

const nativeResult = executeAppParams({
  hostname: 'localhost',
  href: 'capacitor://localhost/',
  native: true,
  storedFunctionsVersion: 'stale-native-snapshot',
  search: '?functions_version=also-stale',
});
assert.equal(nativeResult.appParams.functionsVersion, undefined);
assert.equal(nativeResult.values.has('base44_functions_version'), false);
assert.deepEqual(nativeResult.removals, ['base44_functions_version']);

const productionWebResult = executeAppParams({
  hostname: 'nuvirajuice.com',
  href: 'https://nuvirajuice.com/',
  native: false,
  storedFunctionsVersion: 'stale-production-snapshot',
});
assert.equal(productionWebResult.appParams.functionsVersion, undefined);
assert.equal(productionWebResult.values.has('base44_functions_version'), false);

const previewResult = executeAppParams({
  hostname: 'preview.base44.app',
  href: 'https://preview.base44.app/',
  native: false,
  storedFunctionsVersion: 'intentional-preview-snapshot',
});
assert.equal(previewResult.appParams.functionsVersion, 'intentional-preview-snapshot');
assert.equal(previewResult.values.get('base44_functions_version'), 'intentional-preview-snapshot');

assert.match(source, /Capacitor\.isNativePlatform\(\)/);
assert.match(source, /shouldUseCurrentFunctions/);

console.log(JSON.stringify({
  suite: 'g85-native-function-version-unpin',
  passed: 8,
  failed: 0,
  native_functions_version: nativeResult.appParams.functionsVersion ?? null,
  production_functions_version: productionWebResult.appParams.functionsVersion ?? null,
  preview_functions_version: previewResult.appParams.functionsVersion,
}));
