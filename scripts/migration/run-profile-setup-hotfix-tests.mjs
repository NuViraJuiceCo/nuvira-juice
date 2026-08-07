#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const sourcePath = 'base44/functions/completeAccountSetup/entry.ts';
const source = fs.readFileSync(sourcePath, 'utf8');
const accountSetupSource = fs.readFileSync('src/pages/AccountSetup.jsx', 'utf8');
let handler;

const sandbox = {
  Request,
  Response,
  URL,
  console,
  createClientFromRequest: request => request.__base44,
  Deno: { serve: candidate => { handler = candidate; } },
};
vm.createContext(sandbox);
const runnable = source
  .replace("import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';", '')
  .replace(/: unknown/g, '')
  .replace(/: number/g, '')
  .replace(/: Request/g, '');
vm.runInContext(runnable, sandbox, { filename: sourcePath });
assert.equal(typeof handler, 'function');

function makeRequest(body, base44) {
  const request = new Request('https://example.test/functions/completeAccountSetup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  request.__base44 = base44;
  return request;
}

function makeBase44({
  user = { email: 'member@example.test', role: 'user' },
  profiles = [],
  members = [],
  enrollmentResult = { data: { success: true } },
  enrollmentError = null,
} = {}) {
  const calls = { updateMe: [], profileCreate: [], profileUpdate: [], loyaltyInvoke: [] };
  const base44 = {
    auth: {
      me: async () => user,
      updateMe: async payload => { calls.updateMe.push(payload); },
    },
    asServiceRole: {
      entities: {
        UserProfile: {
          filter: async () => profiles,
          create: async payload => { calls.profileCreate.push(payload); return { id: 'profile-new' }; },
          update: async (id, payload) => { calls.profileUpdate.push({ id, payload }); },
        },
        LoyaltyMember: { filter: async () => members },
      },
    },
    functions: {
      invoke: async (name, payload) => {
        calls.loyaltyInvoke.push({ name, payload });
        if (enrollmentError) throw enrollmentError;
        return enrollmentResult;
      },
    },
  };
  return { base44, calls };
}

const validBody = {
  email: 'member@example.test',
  first_name: 'Sample',
  last_name: 'Member',
  phone: '555-0100',
  birthday: '1990-01-02',
  address: '1 Test Way, Test City, MO, 60000',
};

{
  const { base44, calls } = makeBase44();
  const response = await handler(makeRequest(validBody, base44));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true,
    loyalty_status: 'active',
    message: 'Account setup complete',
  });
  assert.equal(calls.profileCreate.length, 1);
  assert.equal(calls.loyaltyInvoke.length, 1);
  assert.equal(calls.loyaltyInvoke[0].name, 'createLoyaltyMember');
}

{
  const { base44, calls } = makeBase44();
  const response = await handler(makeRequest({
    email: validBody.email,
    first_name: validBody.first_name,
    last_name: validBody.last_name,
    phone: validBody.phone,
  }, base44));
  assert.equal(response.status, 200);
  assert.equal(calls.profileCreate[0].birthday, undefined);
  assert.equal(calls.profileCreate[0].address, undefined);
}

{
  const { base44, calls } = makeBase44({ profiles: [{ id: 'profile-existing' }], members: [{ id: 'member-existing' }] });
  const response = await handler(makeRequest(validBody, base44));
  assert.equal(response.status, 200);
  assert.equal(calls.profileCreate.length, 0);
  assert.equal(calls.profileUpdate.length, 1);
  assert.equal(calls.loyaltyInvoke.length, 0);
}

{
  const { base44 } = makeBase44({ user: null });
  const response = await handler(makeRequest(validBody, base44));
  assert.equal(response.status, 401);
}

{
  const { base44, calls } = makeBase44();
  const response = await handler(makeRequest({ ...validBody, email: 'other@example.test' }, base44));
  assert.equal(response.status, 403);
  assert.equal(calls.profileCreate.length, 0);
}

{
  const { base44 } = makeBase44();
  const malformed = await handler(makeRequest('{', base44));
  assert.equal(malformed.status, 400);
  const missing = await handler(makeRequest({ email: validBody.email }, base44));
  assert.equal(missing.status, 400);
  const badBirthday = await handler(makeRequest({ ...validBody, birthday: '01/02/1990' }, base44));
  assert.equal(badBirthday.status, 400);
}

{
  const { base44, calls } = makeBase44({
    user: { email: 'relay@privaterelay.appleid.com', role: 'user' },
  });
  const missingContact = await handler(makeRequest({ ...validBody, email: 'relay@privaterelay.appleid.com' }, base44));
  assert.equal(missingContact.status, 400);
  const success = await handler(makeRequest({
    ...validBody,
    email: 'relay@privaterelay.appleid.com',
    contact_email: 'contact@example.test',
  }, base44));
  assert.equal(success.status, 200);
  assert.equal(calls.loyaltyInvoke[0].payload.email, 'contact@example.test');
  assert.equal(calls.loyaltyInvoke[0].payload.auth_email, 'relay@privaterelay.appleid.com');
}

for (const enrollmentResult of [{ success: true }, { data: { success: true } }]) {
  const { base44 } = makeBase44({ enrollmentResult });
  const response = await handler(makeRequest(validBody, base44));
  assert.equal((await response.json()).loyalty_status, 'active');
}

{
  const { base44, calls } = makeBase44({ enrollmentError: new Error('synthetic provider failure') });
  const response = await handler(makeRequest(validBody, base44));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).loyalty_status, 'pending_retry');
  assert.equal(calls.profileCreate.length, 1);
}

assert.doesNotMatch(source, /console\.(?:log|warn|error)\(`[^`]*\$\{authenticatedEmail\}/);
assert.doesNotMatch(source, /return Response\.json\(\{\s*success:\s*true,\s*email:/s);
assert.match(source, /enrollmentResponse\?\.data \|\| enrollmentResponse/);
assert.match(source, /loyaltyStatus = 'pending_retry'/);
assert.match(accountSetupSource, /base44\.functions\.fetch\('completeAccountSetup'/);
assert.match(accountSetupSource, /method:\s*'POST'/);
assert.match(accountSetupSource, /body:\s*JSON\.stringify\(setupPayload\)/);
assert.doesNotMatch(accountSetupSource, /base44\.functions\.invoke\('completeAccountSetup'/);

console.log(JSON.stringify({
  ok: true,
  suite: 'profile-setup-hotfix',
  cases: 15,
  writes_performed: false,
  external_calls_performed: false,
}, null, 2));
