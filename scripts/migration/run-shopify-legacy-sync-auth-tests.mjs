import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

let cases = 0;
for (const [name, gate, entity] of [
  ['pushProductToShopify', 'ENABLE_PRODUCT_SHOPIFY_AUTOMATION', 'Product'],
  ['pushMerchToShopify', 'ENABLE_MERCH_SHOPIFY_AUTOMATION', 'Merch'],
]) {
  const source = fs.readFileSync(`base44/functions/getAdminOperationsDashboardSummary/handlers/${name}/entry.ts`, 'utf8');
  const executable = ts.transpileModule(source.replace(/^import .*;\n/gm, '').replace('export default async', 'globalThis.handler = async'), {
    compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext},
  }).outputText.replace(/^export \{\};?\s*$/gm, '');
  const run = async ({role, enabled = true, throws = false, method = 'POST', linked = true} = {}) => {
    const effects = {sdk: 0, auth: 0, fetch: 0, update: 0};
    let providerRequest;
    const context = {
      Request, Response, console: {log() {}, error() {}},
      Deno: {env: {get: key => ({[gate]: enabled ? 'true' : 'false', SHOPIFY_API_TOKEN: 'synthetic-only', SHOPIFY_STORE_URL: 'https://shop.example.test'})[key]}},
      createClientFromRequest: () => {
        effects.sdk++;
        return {
          auth: {me: async () => {effects.auth++; if (throws) throw new Error('synthetic auth outage'); return role === undefined ? null : {role};}},
          asServiceRole: {entities: {[entity]: {update: async () => {effects.update++;}}}},
        };
      },
      fetch: async (url, options) => {effects.fetch++; providerRequest = {url, options}; return Response.json({product: {id: 123}});},
    };
    vm.runInNewContext(executable, context);
    const body = {event: {type: 'update', entity_id: 'synthetic-product'}, data: {id: 'synthetic-product', title: 'Synthetic product', name: 'Synthetic merchandise', price: 13, is_available: true, ...(linked ? {shopify_product_id: '123'} : {})}};
    const result = await context.handler(new Request('https://example.test/admin', {method, ...(method === 'POST' ? {body: JSON.stringify(body)} : {})}));
    return {status: result.status, data: await result.json(), effects, providerRequest};
  };
  for (const input of [{}, {throws: true}, {role: 'user'}, {role: 'staff'}, {role: 'production_manager'}, {role: ''}]) {
    const result = await run(input);
    assert.equal(result.status, input.role === undefined ? 401 : 403);
    assert.equal(result.data.error, 'admin_access_required');
    assert.equal(result.effects.fetch, 0);
    assert.equal(result.effects.update, 0);
    cases++;
  }
  for (const method of ['GET', 'PUT', 'DELETE', 'OPTIONS']) {
    const result = await run({method, role: 'admin'});
    assert.equal(result.status, 405);
    assert.deepEqual(result.effects, {sdk: 0, auth: 0, fetch: 0, update: 0});
    cases++;
  }
  const disabled = await run({enabled: false});
  assert.equal(disabled.status, 200);
  assert.equal(disabled.data.skipped, true);
  assert.deepEqual(disabled.effects, {sdk: 0, auth: 0, fetch: 0, update: 0});
  cases++;
  for (const role of ['admin', 'owner', ' Admin ']) {
    for (const linked of [true, false]) {
      const result = await run({role, linked});
      assert.equal(result.status, 200);
      assert.equal(result.data.ok, true);
      assert.equal(result.effects.auth, 1);
      assert.equal(result.effects.fetch, 1);
      assert.equal(result.effects.update, linked ? 0 : 1);
      assert.equal(result.providerRequest.options.method, linked ? 'PUT' : 'POST');
      assert.match(result.providerRequest.url, /^https:\/\/shop\.example\.test\/admin\/api\//);
      cases++;
    }
  }
}
console.log(`Legacy Shopify sync authorization: ${cases}/${cases} passed. Mocked transport only; no provider, data or automation changes.`);
