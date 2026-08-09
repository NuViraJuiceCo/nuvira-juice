#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const root = process.cwd();
const read = relativePath => fs.readFileSync(`${root}/${relativePath}`, 'utf8');
const fixedNow = '2026-08-08T18:00:00.000Z';

function loadHandler(relativePath, base44) {
  let source = read(relativePath)
    .replace(/^import .*$/gm, '')
    .replace('export default async', 'globalThis.__handler = async');
  source = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const logs = [];
  const context = vm.createContext({
    Response,
    Request,
    Headers,
    URL,
    URLSearchParams,
    JSON,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Set,
    Map,
    RegExp,
    Error,
    Promise,
    Math,
    Intl,
    Date: class extends Date {
      constructor(value) { super(value === undefined ? fixedNow : value); }
      static now() { return new Date(fixedNow).getTime(); }
    },
    Deno: { env: { get: () => undefined } },
    fetch: async () => { throw new Error('unexpected_network_request'); },
    console: {
      log: (...args) => logs.push(['log', ...args]),
      warn: (...args) => logs.push(['warn', ...args]),
      error: (...args) => logs.push(['error', ...args]),
    },
    createClientFromRequest: () => base44,
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: relativePath });
  return { handler: context.globalThis.__handler, logs };
}

function request(body, headers = {}) {
  return new Request('https://example.test', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function saveClient({ role = 'admin', duplicates = [], existing = { id: 'doc_existing' } } = {}) {
  const calls = { created: [], updated: [], filtered: [], providers: 0, notifications: 0 };
  const complianceDoc = {
    create: async payload => {
      calls.created.push(structuredClone(payload));
      return { id: 'doc_created', ...payload };
    },
    update: async (id, payload) => {
      calls.updated.push([id, structuredClone(payload)]);
      return { id, ...payload };
    },
    get: async () => existing,
    filter: async filter => {
      calls.filtered.push(structuredClone(filter));
      return duplicates;
    },
  };
  return {
    calls,
    client: {
      auth: { me: async () => role ? ({ role, email: 'operator@example.test' }) : null },
      asServiceRole: {
        entities: { ComplianceDoc: complianceDoc },
        functions: { invoke: async () => { calls.providers += 1; throw new Error('unexpected_provider_call'); } },
      },
    },
  };
}

const savePath = 'base44/functions/getAdminOperationsDashboardSummary/handlers/saveAdminComplianceRecord/entry.ts';
const summaryPath = 'base44/functions/getAdminOperationsDashboardSummary/handlers/getAdminComplianceOpsSummary/entry.ts';

const unauthorizedFixture = saveClient({ role: null });
const unauthorized = loadHandler(savePath, unauthorizedFixture.client);
assert.equal((await unauthorized.handler(request({ record_type: 'compliance_document', data: {} }))).status, 401);

const forbiddenFixture = saveClient({ role: 'user' });
const forbidden = loadHandler(savePath, forbiddenFixture.client);
assert.equal((await forbidden.handler(request({ record_type: 'compliance_document', data: {} }))).status, 403);

const validFixture = saveClient();
const validHandler = loadHandler(savePath, validFixture.client);
const validResponse = await validHandler.handler(request({
  record_type: 'compliance_document',
  data: {
    name: 'Synthetic Missouri Permit',
    type: 'Permit',
    issued_date: '2026-08-01',
    expiry_date: '2027-08-01',
    reminder_days: 45,
    file_url: 'https://example.test/permit',
  },
}));
const validResult = await validResponse.json();
assert.equal(validResponse.status, 200);
assert.equal(validResult.success, true);
assert.equal(validResult.record_id, 'doc_created');
assert.equal(validResult.customer_notification_sent, false);
assert.equal(validResult.provider_calls, false);
assert.equal(validFixture.calls.created[0].status, 'Valid');
assert.equal(validFixture.calls.providers, 0);

const statusFixture = saveClient();
const statusHandler = loadHandler(savePath, statusFixture.client);
await statusHandler.handler(request({
  record_type: 'compliance_document',
  data: { name: 'Due Soon License', type: 'License', expiry_date: '2026-08-20', reminder_days: 30 },
}));
await statusHandler.handler(request({
  record_type: 'compliance_document',
  data: { name: 'No Expiry Inspection', type: 'Inspection' },
}));
assert.equal(statusFixture.calls.created[0].status, 'Due Soon');
assert.equal(statusFixture.calls.created[1].status, 'Pending');

const invalidDates = saveClient();
const invalidDateHandler = loadHandler(savePath, invalidDates.client);
const impossibleDate = await invalidDateHandler.handler(request({
  record_type: 'compliance_document',
  data: { name: 'Invalid Date', type: 'Audit', expiry_date: '2026-02-31' },
}));
assert.equal(impossibleDate.status, 400);
assert.equal((await impossibleDate.json()).error, 'compliance_document_date_invalid');
const reversedDates = await invalidDateHandler.handler(request({
  record_type: 'compliance_document',
  data: { name: 'Reversed Dates', type: 'Review', issued_date: '2026-09-01', expiry_date: '2026-08-01' },
}));
assert.equal((await reversedDates.json()).error, 'compliance_document_dates_out_of_order');
const unsafeUrl = await invalidDateHandler.handler(request({
  record_type: 'compliance_document',
  data: { name: 'Unsafe URL', type: 'Log', file_url: 'javascript:alert(1)' },
}));
assert.equal((await unsafeUrl.json()).error, 'compliance_document_url_invalid');
assert.equal(invalidDates.calls.created.length, 0);

const duplicateFixture = saveClient({ duplicates: [{ id: 'doc_duplicate' }] });
const duplicateHandler = loadHandler(savePath, duplicateFixture.client);
const duplicateResponse = await duplicateHandler.handler(request({
  record_type: 'compliance_document',
  data: { name: 'Duplicate Permit', type: 'Permit', expiry_date: '2027-08-01' },
}));
const duplicateResult = await duplicateResponse.json();
assert.equal(duplicateResponse.status, 409);
assert.equal(duplicateResult.error, 'duplicate_compliance_document');
assert.equal(duplicateResult.writes_performed, false);
assert.equal(duplicateFixture.calls.created.length, 0);

const updateFixture = saveClient();
const updateHandler = loadHandler(savePath, updateFixture.client);
const updateResponse = await updateHandler.handler(request({
  record_type: 'compliance_document',
  existing_id: 'doc_existing',
  data: {
    name: 'Updated Permit',
    type: 'Permit',
    expiry_date: '2026-08-30',
    reminder_days: 30,
    owner: '',
    file_url: '',
  },
}));
const updateResult = await updateResponse.json();
assert.equal(updateResult.success, true);
assert.equal(updateResult.action, 'updated');
assert.equal(updateFixture.calls.updated.length, 1);
assert.equal(updateFixture.calls.updated[0][0], 'doc_existing');
assert.equal(updateFixture.calls.updated[0][1].status, 'Due Soon');
assert.equal(updateFixture.calls.updated[0][1].owner, null);
assert.equal(updateFixture.calls.updated[0][1].file_url, null);

const missingFixture = saveClient({ existing: null });
const missingHandler = loadHandler(savePath, missingFixture.client);
const missingResponse = await missingHandler.handler(request({
  record_type: 'compliance_document',
  existing_id: 'missing_doc',
  data: { name: 'Missing Document', type: 'Permit' },
}));
assert.equal(missingResponse.status, 404);
assert.equal(missingFixture.calls.updated.length, 0);

const complianceRows = [{
  id: 'doc_stale_status',
  name: 'Synthetic Expired Permit',
  type: 'Permit',
  expiry_date: '2026-08-01',
  reminder_days: 30,
  status: 'Valid',
}];
const summaryEntities = new Proxy({}, {
  get: (_target, name) => ({ list: async () => name === 'ComplianceDoc' ? complianceRows : [] }),
});
const summary = loadHandler(summaryPath, {
  auth: { me: async () => ({ role: 'admin', email: 'operator@example.test' }) },
  asServiceRole: { entities: summaryEntities },
});
const summaryResponse = await summary.handler(request({ date_from: '2026-08-02', date_to: '2026-08-08' }));
const summaryResult = await summaryResponse.json();
assert.equal(summaryResponse.status, 200);
assert.equal(summaryResult.source, 'customer_app_native_compliance_authoritative');
assert.equal(summaryResult.native.records.compliance_documents[0].status, 'Expired');
assert.equal(summaryResult.hub_operational_dependency, false);
assert.equal(summaryResult.writes_performed, false);
assert.equal(summaryResult.provider_calls_performed, false);
assert.equal(summaryResult.customer_notifications_sent, false);

const component = read('src/components/compliance/ComplianceDocumentsTab.jsx');
const page = read('src/pages/admin/ComplianceOps.jsx');
const gateway = read('base44/functions/getAdminOperationsDashboardSummary/entry.ts');
assert.match(component, /record_type: 'compliance_document'/);
assert.match(component, /existing_id: editing\?\.id \|\| null/);
assert.match(component, /result\?\.success !== true \|\| !result\?\.record_id/);
assert.match(component, /onSaved\?\.\(\)/);
assert.match(component, /Destructive document changes remain controlled/);
assert.doesNotMatch(component, /\.delete\(/);
assert.match(page, /onSaved=\{refetchComplianceSummary\}/);
assert.match(gateway, /g98-native-compliance-document-management-20260808/);
assert.equal(fs.existsSync(`${root}/base44/functions/saveAdminComplianceRecord`), false);

console.log(JSON.stringify({
  success: true,
  suite: 'g98-native-compliance-document-management',
  cases: 12,
  writes_performed: false,
  provider_calls_performed: false,
  customer_notifications_sent: false,
  hub_operational_dependency: false,
}, null, 2));
