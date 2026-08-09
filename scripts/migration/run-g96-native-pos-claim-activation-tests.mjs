#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const sourcePath = 'base44/functions/getAdminPOSOrdersSummary/claimManager.ts';
const source = fs.readFileSync(sourcePath, 'utf8')
  .replace(/^import .*$/gm, '')
  .replace('export async function handlePOSCustomerClaims', 'globalThis.__handlePOSCustomerClaims = async function handlePOSCustomerClaims');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.None,
  },
}).outputText;

const networkRequests = [];
const ledgerCalls = [];
const claimUpdates = [];
const profileWrites = [];
const consentWrites = [];
const preferenceWrites = [];
let claim = {
  id: 'claim_synthetic_1',
  customer_email: 'member@example.test',
  first_name: 'Synthetic',
  last_name: 'Member',
  phone: '+13145550123',
  status: 'unclaimed',
  eligible_order_count: 2,
  eligible_spend: 9,
  pending_points: 90,
  source_order_numbers: ['POS-TEST-1', 'POS-TEST-2'],
};
let points = null;
let member = null;

const service = {
  entities: {
    POSCustomerClaim: {
      filter: async ({ customer_email }) => customer_email === claim.customer_email ? [claim] : [],
      update: async (id, payload) => {
        assert.equal(id, claim.id);
        claim = { ...claim, ...payload };
        claimUpdates.push(payload);
        return claim;
      },
    },
    UserProfile: {
      filter: async () => [],
      create: async payload => { profileWrites.push(payload); return { id: 'profile_synthetic_1', ...payload }; },
      update: async (_id, payload) => { profileWrites.push(payload); return payload; },
    },
    UserPoints: {
      filter: async () => points ? [points] : [],
    },
    LoyaltyMember: {
      filter: async () => member ? [member] : [],
    },
    MarketingConsent: {
      filter: async () => [],
      create: async payload => { consentWrites.push(payload); return payload; },
      update: async (_id, payload) => { consentWrites.push(payload); return payload; },
    },
    NotificationPreference: {
      filter: async () => [],
      create: async payload => { preferenceWrites.push(payload); return payload; },
      update: async (_id, payload) => { preferenceWrites.push(payload); return payload; },
    },
  },
  functions: {
    invoke: async (name, payload) => {
      assert.equal(name, 'enrollNewCustomerInLoyalty');
      ledgerCalls.push(payload);
      const prior = Number(points?.total_points || 0);
      points = {
        id: 'points_synthetic_1',
        total_points: prior + Number(payload.amount || 0),
        lifetime_points: Number(points?.lifetime_points || 0) + Number(payload.amount || 0),
        redeemed_points: 0,
      };
      member = { ...points, id: 'member_synthetic_1' };
      return { data: { success: true, idempotent: false } };
    },
  },
};

const base44 = {
  auth: {
    me: async () => ({ email: 'member@example.test', role: 'user' }),
    updateMe: async () => ({ success: true }),
  },
  asServiceRole: service,
};

const context = vm.createContext({
  console,
  Response,
  Request,
  Headers,
  URL,
  AbortController,
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
  Promise,
  Intl,
  setTimeout,
  clearTimeout,
  fetch: async (...args) => {
    networkRequests.push(args);
    throw new Error('unexpected_network_request');
  },
  Deno: {
    env: {
      get: name => ({
        CUSTOMER_APP_SYNC_SECRET: 'synthetic-internal-secret',
        LOYALTY_LEDGER_SECRET: 'synthetic-ledger-secret',
      })[name] || '',
    },
  },
  createClientFromRequest: () => base44,
  globalThis: {},
});
vm.runInContext(compiled, context, { filename: sourcePath });
const handler = context.globalThis.__handlePOSCustomerClaims;
assert.equal(typeof handler, 'function');

function request(body) {
  return {
    method: 'POST',
    json: async () => body,
  };
}

const activationResponse = await handler(request({
  action: 'activate_claim',
  first_name: 'Synthetic',
  last_name: 'Member',
  phone: '+13145550123',
  email_marketing_opt_in: false,
  sms_marketing_opt_in: false,
}));
const activation = await activationResponse.json();
assert.equal(activationResponse.status, 200);
assert.equal(activation.success, true);
assert.equal(activation.available_points, 340);
assert.equal(activation.lifetime_points, 340);
assert.equal(activation.redeemed_points, 0);
assert.equal(activation.notifications_sent, 0);
assert.equal(activation.emails_sent, 0);
assert.equal(ledgerCalls.length, 2);
assert.equal(ledgerCalls[0].idempotency_key, 'loyalty_signup:member@example.test');
assert.equal(ledgerCalls[0].amount, 250);
assert.equal(ledgerCalls[0].transaction_type, 'bonus');
assert.equal(ledgerCalls[1].idempotency_key, 'pos_claim:claim_synthetic_1:purchase_history');
assert.equal(ledgerCalls[1].amount, 90);
assert.equal(ledgerCalls[1].transaction_type, 'earned');
assert.equal(ledgerCalls[0].internal_secret, 'synthetic-ledger-secret');
assert.equal(ledgerCalls[1].internal_secret, 'synthetic-ledger-secret');
assert.equal(claim.status, 'claimed');
assert.equal(claim.pending_points, 0);
assert.equal(claim.operations_member_id, 'member_synthetic_1');
assert.equal(profileWrites.length, 1);
assert.equal(consentWrites.length, 1);
assert.equal(preferenceWrites.length, 1);
assert.equal(networkRequests.length, 0);

const replayResponse = await handler(request({ action: 'activate_claim' }));
const replay = await replayResponse.json();
assert.equal(replayResponse.status, 200);
assert.equal(replay.success, true);
assert.equal(replay.idempotent, true);
assert.equal(replay.available_points, 340);
assert.equal(ledgerCalls.length, 2);
assert.equal(claimUpdates.length, 1);
assert.equal(networkRequests.length, 0);

console.log(JSON.stringify({
  ok: true,
  suite: 'g96-native-pos-claim-activation',
  cases: 2,
  ledger_calls: ledgerCalls.length,
  writes_performed: false,
  provider_calls_performed: false,
  external_hub_calls_performed: false,
  customer_notifications_sent: false,
}, null, 2));
