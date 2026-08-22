#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';

const read = path => fs.readFileSync(path, 'utf8');
const config = JSON.parse(read('base44/functions/getAdminOperationsDashboardSummary/function.jsonc'));
const gateway = read('base44/functions/getAdminOperationsDashboardSummary/entry.ts');
const handler = read('base44/functions/getAdminOperationsDashboardSummary/handlers/notifyAdminNewMember/entry.ts');
const push = read('base44/functions/sendCustomerPushNotification/entry.ts');
const diagnostics = read('base44/functions/getAdminOperationsDashboardSummary/handlers/getAdminPushDiagnostics/entry.ts');
const adminUi = read('src/pages/admin/NotificationCampaigns.jsx');

const automation = config.automations.find(item => item.entity_name === 'UserProfile');
assert.ok(automation, 'UserProfile create automation must exist');
assert.equal(automation.is_active, true);
assert.deepEqual(automation.event_types, ['create']);
assert.equal(automation.function_args, null);

assert.match(gateway, /isNewMemberAutomation/);
assert.match(gateway, /entityName === 'UserProfile' && eventType === 'create'/);
assert.match(gateway, /"notifyAdminNewMember": handler65/);
assert.match(handler, /authoritativeProfile\(base44, profileId\)/);
assert.match(handler, /sample_profile_excluded/);
assert.match(handler, /priorProfileForEmail\(base44, profile, profileEmail\)/);
assert.match(handler, /existing_member_profile/);
assert.match(handler, /admin_profile_excluded/);
assert.match(handler, /ENABLE_ADMIN_NEW_MEMBER_PUSH/);
assert.match(handler, /admin_new_member_\$\{profileId\}_\$\{recipient\.email\}/);
assert.match(handler, /existingNotification\(base44, idempotencyKey\)/);
assert.match(handler, /duplicate_idempotency_key/);
assert.match(handler, /notification_subtype: NOTIFICATION_SUBTYPE/);
assert.match(handler, /deep_link: DEEP_LINK/);
assert.match(handler, /sendCustomerPushNotification/);
assert.match(handler, /New NuVira Member/);
assert.match(push, /notificationSubtype === 'admin_new_member'/);
assert.match(push, /admin_new_member_push_disabled/);
assert.match(diagnostics, /admin_new_member_push_enabled/);
assert.match(adminUi, /Admin Activity Alerts/);
assert.match(adminUi, /paid-order and new-member alerts/);

assert.doesNotMatch(handler, /MarketingConsent|promotional_email_eligible|sendResendEvent/);

const executableSource = handler
  .replace(/^import .*?;\s*/m, '')
  .replace('export default async (req: Request) => {', 'globalThis.__handler = async (req: Request) => {');
const compiled = await transform(executableSource, { loader: 'ts', format: 'cjs', target: 'es2022' });
const notifications = [];
let pushInvocations = 0;
const profileRows = [
  {
    id: 'profile-1',
    customer_email: 'new.member@example.com',
    first_name: 'Avery',
    last_name: 'Member',
    signup_source: 'google',
    created_date: '2026-08-22T12:00:00.000Z',
  },
  {
    id: 'profile-duplicate',
    customer_email: 'new.member@example.com',
    first_name: 'Avery',
    last_name: 'Member',
    created_date: '2026-08-22T12:05:00.000Z',
  },
  {
    id: 'profile-sample',
    customer_email: 'sample@example.com',
    first_name: 'Sample',
    last_name: 'Member',
    created_date: '2026-08-22T12:10:00.000Z',
    is_sample: true,
  },
];
const base44 = {
  auth: { me: async () => ({ role: 'admin', email: 'admin@nuvirajuice.com' }) },
  asServiceRole: {
    entities: {
      UserProfile: {
        filter: async (query) => {
          if (query.id) return profileRows.filter(row => row.id === query.id);
          if (query.customer_email) return profileRows.filter(row => row.customer_email === query.customer_email);
          return [];
        },
      },
      User: {
        filter: async (query) => {
          if (query.role === 'admin') return [{ role: 'admin', email: 'admin@nuvirajuice.com' }];
          if (query.role === 'owner') return [];
          if (query.email === 'new.member@example.com') return [];
          return [];
        },
      },
      Notification: {
        filter: async ({ idempotency_key }) => notifications.filter(row => row.idempotency_key === idempotency_key),
        create: async payload => {
          const row = { id: `notification-${notifications.length + 1}`, ...payload };
          notifications.push(row);
          return row;
        },
      },
    },
    functions: {
      invoke: async (name, payload) => {
        assert.equal(name, 'sendCustomerPushNotification');
        assert.equal(payload.notification_subtype, 'admin_new_member');
        pushInvocations += 1;
        return { data: { push_attempted: true, push_sent: true, sent_count: 1, token_count: 1 } };
      },
    },
  },
};
const context = vm.createContext({
  console,
  Request,
  Response,
  Headers,
  URL,
  Set,
  Deno: {
    env: {
      get: name => ({
        ENABLE_ADMIN_PUSH_NOTIFICATIONS: 'true',
        ENABLE_ADMIN_NEW_MEMBER_PUSH: 'true',
      })[name],
    },
  },
  createClientFromRequest: () => base44,
});
vm.runInContext(compiled.code, context);
const automationRequest = (profileId = 'profile-1') => new Request('https://example.test/functions/getAdminOperationsDashboardSummary', {
  method: 'POST',
  body: JSON.stringify({
    event: { type: 'create', entity_name: 'UserProfile', entity_id: profileId },
    data: { id: profileId, first_name: 'Untrusted name' },
  }),
});
const firstResponse = await context.__handler(automationRequest());
const firstResult = await firstResponse.json();
assert.equal(firstResult.success, true);
assert.equal(firstResult.notification_created_count, 1);
assert.equal(firstResult.push_sent, true);
assert.equal(notifications.length, 1);
assert.equal(notifications[0].message, 'Avery Member created a profile through Google sign-in.');
assert.equal(notifications[0].deep_link, '/admin/loyalty-members');
assert.equal(pushInvocations, 1);

const replayResponse = await context.__handler(automationRequest());
const replayResult = await replayResponse.json();
assert.equal(replayResult.skipped, true);
assert.equal(replayResult.reason, 'duplicate_idempotency_key');
assert.equal(notifications.length, 1);
assert.equal(pushInvocations, 1);

const duplicateProfileResponse = await context.__handler(automationRequest('profile-duplicate'));
const duplicateProfileResult = await duplicateProfileResponse.json();
assert.equal(duplicateProfileResult.skipped, true);
assert.equal(duplicateProfileResult.reason, 'existing_member_profile');
assert.equal(notifications.length, 1);
assert.equal(pushInvocations, 1);

const sampleProfileResponse = await context.__handler(automationRequest('profile-sample'));
const sampleProfileResult = await sampleProfileResponse.json();
assert.equal(sampleProfileResult.skipped, true);
assert.equal(sampleProfileResult.reason, 'sample_profile_excluded');
assert.equal(notifications.length, 1);
assert.equal(pushInvocations, 1);

console.log(JSON.stringify({
  success: true,
  suite: 'g124-admin-new-member-push',
  entity_create_trigger: true,
  authoritative_profile_read: true,
  duplicate_safe: true,
  duplicate_replay_simulated: true,
  sample_profiles_excluded: true,
  duplicate_member_profiles_excluded: true,
  admin_identity_excluded: true,
  customer_marketing_consent_impact: false,
  provider_calls_performed: false,
  writes_performed: false,
}, null, 2));
