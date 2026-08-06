#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const functionPath = path.join(repoRoot, 'base44/functions/verifyAdminBagReturn/entry.ts');

function loadHandler() {
  let source = fs.readFileSync(functionPath, 'utf8').replace(/^import .*$/gm, '');
  source = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const context = vm.createContext({
    console,
    Date,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Set,
    Map,
    RegExp,
    JSON,
    Error,
    Response,
    Promise,
    createClientFromRequest: req => req.__base44,
    Deno: { serve: handler => { context.globalThis.__handler = handler; } },
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: functionPath });
  return context.globalThis.__handler;
}

function makeStore({ role = 'admin', bagReturn = {}, creditAccounts = [] } = {}) {
  const rows = {
    BagReturn: [{
      id: 'return_1',
      order_id: 'order_1',
      customer_email: 'customer@example.test',
      small_bags_requested: 1,
      tote_bags_requested: 0,
      verification_status: 'requested',
      credit_issued: 0,
      credit_applied: false,
      ...bagReturn,
    }],
    NuViraCredit: [...creditAccounts],
    CommandLog: [],
  };
  const writes = [];
  const api = name => ({
    get: async id => rows[name].find(row => row.id === id) || null,
    filter: async filter => rows[name].filter(row => Object.entries(filter).every(([key, value]) => row[key] === value)),
    create: async payload => {
      const row = { id: `${name.toLowerCase()}_${rows[name].length + 1}`, ...payload };
      rows[name].push(row);
      writes.push({ entity: name, action: 'create', payload });
      return row;
    },
    update: async (id, patch) => {
      const row = rows[name].find(item => item.id === id);
      if (!row) throw new Error(`${name} row missing`);
      Object.assign(row, patch);
      writes.push({ entity: name, action: 'update', id, patch });
      return row;
    },
  });
  return {
    rows,
    writes,
    base44: {
      auth: { me: async () => ({ role, email: 'admin@example.test' }) },
      asServiceRole: { entities: { BagReturn: api('BagReturn'), NuViraCredit: api('NuViraCredit'), CommandLog: api('CommandLog') } },
    },
  };
}

async function invoke(store, body) {
  const response = await loadHandler()({
    method: 'POST',
    __base44: store.base44,
    json: async () => body,
  });
  return { status: response.status, payload: await response.json() };
}

{
  const store = makeStore();
  const first = await invoke(store, {
    bag_return_id: 'return_1',
    small_bag_status: 'accepted',
    small_bags_accepted: 1,
    request_id: 'return_1_verify',
  });
  assert.equal(first.status, 200);
  assert.equal(first.payload.success, true);
  assert.equal(first.payload.verification_status, 'verified');
  assert.equal(first.payload.credit_issued, 1);
  assert.equal(store.rows.BagReturn[0].credit_applied, true);
  assert.equal(store.rows.NuViraCredit.length, 1);
  assert.equal(store.rows.NuViraCredit[0].balance, 1);
  assert.equal(store.rows.NuViraCredit[0].history[0].order_id, 'bag_return:return_1');

  const writesBeforeRetry = store.writes.length;
  const retry = await invoke(store, {
    bag_return_id: 'return_1',
    small_bag_status: 'accepted',
    small_bags_accepted: 1,
    request_id: 'return_1_verify',
  });
  assert.equal(retry.status, 200);
  assert.equal(retry.payload.idempotent, true);
  assert.equal(store.rows.NuViraCredit.length, 1);
  assert.equal(store.rows.NuViraCredit[0].balance, 1);
  assert.equal(store.writes.length, writesBeforeRetry);
}

{
  const store = makeStore({ bagReturn: { small_bags_requested: 0, tote_bags_requested: 1 } });
  const result = await invoke(store, {
    bag_return_id: 'return_1',
    tote_bag_status: 'not_found',
    tote_bags_accepted: 0,
  });
  assert.equal(result.status, 200);
  assert.equal(result.payload.verification_status, 'not_found');
  assert.equal(result.payload.credit_issued, 0);
  assert.equal(store.rows.NuViraCredit.length, 0);
}

{
  const store = makeStore();
  const result = await invoke(store, {
    bag_return_id: 'return_1',
    small_bag_status: 'accepted',
    small_bags_accepted: 2,
  });
  assert.equal(result.status, 400);
  assert.equal(result.payload.error_code, 'accepted_count_out_of_range');
  assert.equal(store.writes.length, 0);
}

{
  const store = makeStore({ role: 'user' });
  const result = await invoke(store, { bag_return_id: 'return_1' });
  assert.equal(result.status, 403);
  assert.equal(store.writes.length, 0);
}

const adminSource = fs.readFileSync(path.join(repoRoot, 'src/pages/admin/BagReturnAdmin.jsx'), 'utf8');
const checkoutSource = fs.readFileSync(path.join(repoRoot, 'src/pages/Checkout.jsx'), 'utf8');
const intentSource = fs.readFileSync(path.join(repoRoot, 'base44/functions/createPaymentIntent/entry.ts'), 'utf8');
const webhookSource = fs.readFileSync(path.join(repoRoot, 'base44/functions/stripeWebhook/entry.ts'), 'utf8');
assert.equal(adminSource.includes('verificationLocked'), false);
assert.equal(adminSource.includes('badge="Read-only"'), false);
assert.ok(adminSource.includes("functions.invoke('verifyAdminBagReturn'"));
assert.ok(adminSource.includes('Verify Return & Apply Credit'));
assert.ok(checkoutSource.includes('bag_return_request_id: pendingBagReturnId'));
assert.ok(intentSource.includes('bag_return_request_id:      String(bag_return_request_id'));
assert.ok(intentSource.includes('bag_return_request_id: bag_return_request_id || null'));
assert.ok(webhookSource.includes('linkPendingBagReturn'));

console.log(JSON.stringify({
  ok: true,
  suite: 'g71-bag-return-activation',
  cases: 16,
  live_calls_performed: false,
  customer_notifications_sent: false,
}, null, 2));

