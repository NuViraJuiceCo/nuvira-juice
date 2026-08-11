#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const handlerPath = 'base44/functions/getCustomerAccountDashboardData/handlers/getCustomerNotifications/entry.ts';
const directHandlerPath = 'base44/functions/getCustomerNotifications/entry.ts';
const notificationsPath = 'src/pages/Notifications.jsx';
const accountPath = 'src/pages/Account.jsx';
const entityPath = 'base44/entities/Notification.jsonc';

const handlerSource = fs.readFileSync(handlerPath, 'utf8');
const directHandlerSource = fs.readFileSync(directHandlerPath, 'utf8');
const notificationsSource = fs.readFileSync(notificationsPath, 'utf8');
const accountSource = fs.readFileSync(accountPath, 'utf8');
const notificationEntity = fs.readFileSync(entityPath, 'utf8');
const criticalSource = fs.readFileSync('scripts/ci/run-critical-regressions.mjs', 'utf8');

const runnable = handlerSource
  .replace("import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';", '')
  .replace('export default async function handler(req: Request)', 'async function handler(req)')
  .concat('\nglobalThis.__handler = handler;');

const sandbox = {
  Response,
  Date,
  Set,
  String,
  Array,
  console: { log() {}, warn() {}, error() {} },
  createClientFromRequest: (request) => request.__base44,
};
vm.createContext(sandbox);
vm.runInContext(runnable, sandbox, { filename: handlerPath });
const handler = sandbox.__handler;

function buildFixture({ authenticated = true, throwOnUpdate = false } = {}) {
  const notifications = [
    { id: 'own-unread', customer_email: 'member@example.com', title: 'Order received', message: 'We have your order.', is_read: false, created_date: '2026-08-10T18:00:00.000Z' },
    { id: 'own-read', customer_email: 'member@example.com', title: 'Delivered', message: 'Your delivery is complete.', is_read: true, created_date: '2026-08-10T17:00:00.000Z' },
    { id: 'alias-unread', customer_email: 'Relay@Example.com', title: 'Program ready', message: 'Your guide is ready.', is_read: false, created_date: '2026-08-10T16:00:00.000Z' },
    { id: 'own-dismissed', customer_email: 'member@example.com', title: 'Old update', message: 'Archived.', is_read: true, dismissed_at: '2026-08-09T12:00:00.000Z', created_date: '2026-08-09T11:00:00.000Z' },
    { id: 'other-unread', customer_email: 'other@example.com', title: 'Private', message: 'Not owned.', is_read: false, created_date: '2026-08-10T19:00:00.000Z' },
  ];
  const writes = [];
  let deleteCount = 0;

  const base44 = {
    auth: {
      me: async () => {
        if (!authenticated) throw new Error('not authenticated');
        return { email: 'member@example.com' };
      },
    },
    asServiceRole: {
      entities: {
        Notification: {
          filter: async (query) => {
            if (query.id) return notifications.filter((notification) => notification.id === query.id);
            if (query.customer_email) return notifications.filter((notification) => notification.customer_email === query.customer_email);
            return [];
          },
          update: async (id, patch) => {
            if (throwOnUpdate) throw new Error('synthetic provider detail');
            const notification = notifications.find((item) => item.id === id);
            if (!notification) throw new Error('missing fixture notification');
            Object.assign(notification, patch);
            writes.push({ id, patch: { ...patch } });
            return notification;
          },
          delete: async () => { deleteCount += 1; },
        },
        UserProfile: {
          filter: async (query) => {
            if (query.customer_email === 'member@example.com') {
              return [{ customer_email: 'member@example.com', contact_email: 'Relay@Example.com' }];
            }
            if (query.contact_email === 'member@example.com') return [];
            return [];
          },
        },
      },
    },
  };

  return { base44, notifications, writes, getDeleteCount: () => deleteCount };
}

function request(base44, body = {}, method = 'POST') {
  return {
    __base44: base44,
    method,
    json: async () => body,
  };
}

async function json(response) {
  return { status: response.status, body: await response.json() };
}

const results = [];
async function test(name, fn) {
  await fn();
  results.push({ name, ok: true });
}

await test('unauthenticated requests fail closed without writes', async () => {
  const fixture = buildFixture({ authenticated: false });
  const response = await json(await handler(request(fixture.base44, { action: 'list' })));
  assert.equal(response.status, 401);
  assert.equal(fixture.writes.length, 0);
});

await test('list merges resolved identities and excludes dismissed and foreign rows', async () => {
  const fixture = buildFixture();
  const response = await json(await handler(request(fixture.base44, { action: 'list' })));
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.notifications.map((notification) => notification.id), ['own-unread', 'own-read', 'alias-unread']);
});

await test('legacy mark_read_id remains compatible and ownership checked', async () => {
  const fixture = buildFixture();
  const response = await json(await handler(request(fixture.base44, { mark_read_id: 'own-unread' })));
  assert.equal(response.status, 200);
  assert.equal(response.body.marked_read, 'own-unread');
  assert.equal(fixture.notifications.find((item) => item.id === 'own-unread').is_read, true);
});

await test('resolved identity comparison is case insensitive', async () => {
  const fixture = buildFixture();
  const response = await json(await handler(request(fixture.base44, { action: 'mark_read', notification_id: 'alias-unread' })));
  assert.equal(response.status, 200);
});

await test('foreign notification mutation is forbidden', async () => {
  const fixture = buildFixture();
  const response = await json(await handler(request(fixture.base44, { action: 'dismiss', notification_id: 'other-unread' })));
  assert.equal(response.status, 403);
  assert.equal(fixture.writes.length, 0);
});

await test('invalid actions and identifiers fail without writes', async () => {
  const fixture = buildFixture();
  assert.equal((await json(await handler(request(fixture.base44, { action: 'delete_everything' })))).status, 400);
  assert.equal((await json(await handler(request(fixture.base44, { action: 'dismiss', notification_id: '' })))).status, 400);
  assert.equal(fixture.writes.length, 0);
});

await test('dismiss archives and marks read without deleting the idempotency record', async () => {
  const fixture = buildFixture();
  const response = await json(await handler(request(fixture.base44, { action: 'dismiss', notification_id: 'own-unread' })));
  assert.equal(response.status, 200);
  const row = fixture.notifications.find((item) => item.id === 'own-unread');
  assert.equal(row.is_read, true);
  assert.match(row.dismissed_at, /^2026-|^20\d{2}-/);
  assert.equal(fixture.getDeleteCount(), 0);
});

await test('mark_all_read changes only visible owned unread rows', async () => {
  const fixture = buildFixture();
  const response = await json(await handler(request(fixture.base44, { action: 'mark_all_read' })));
  assert.equal(response.status, 200);
  assert.equal(response.body.updated_count, 2);
  assert.equal(fixture.notifications.find((item) => item.id === 'other-unread').is_read, false);
  assert.equal(fixture.writes.some((write) => write.id === 'own-dismissed'), false);
});

await test('dismiss_read archives only visible owned read rows', async () => {
  const fixture = buildFixture();
  const response = await json(await handler(request(fixture.base44, { action: 'dismiss_read' })));
  assert.equal(response.status, 200);
  assert.equal(response.body.updated_count, 1);
  assert.ok(fixture.notifications.find((item) => item.id === 'own-read').dismissed_at);
  assert.equal(fixture.notifications.find((item) => item.id === 'own-unread').dismissed_at, undefined);
  assert.equal(fixture.getDeleteCount(), 0);
});

await test('server failures do not expose internal provider details', async () => {
  const fixture = buildFixture({ throwOnUpdate: true });
  const response = await json(await handler(request(fixture.base44, { action: 'mark_read', notification_id: 'own-unread' })));
  assert.equal(response.status, 500);
  assert.equal(JSON.stringify(response.body).includes('synthetic provider detail'), false);
});

await test('direct and gateway handlers expose the same bounded action contract', async () => {
  for (const source of [handlerSource, directHandlerSource]) {
    assert.match(source, /VALID_ACTIONS = new Set\(\['list', 'mark_read', 'mark_all_read', 'dismiss', 'dismiss_read'\]\)/);
    assert.match(source, /ownsNotification\(notification, identityEmails\)/);
    assert.match(source, /dismissed_at: new Date\(\)\.toISOString\(\)/);
    assert.doesNotMatch(source, /Notification\.delete|\.delete\(notificationId/);
  }
});

await test('notification entity preserves dismissal without granting customer delete', async () => {
  assert.match(notificationEntity, /"dismissed_at"/);
  assert.match(notificationEntity, /"delete"\s*:\s*\{\s*"user_condition"\s*:\s*\{\s*"role"\s*:\s*"admin"/s);
});

await test('Updates center has persistent bulk actions, swipe dismissal, rollback, and accessible fallbacks', async () => {
  assert.match(notificationsSource, /action: 'mark_all_read'/);
  assert.match(notificationsSource, /action: 'dismiss_read'/);
  assert.match(notificationsSource, /action: 'dismiss', notification_id: notification\.id/);
  assert.match(notificationsSource, /drag="x"/);
  assert.match(notificationsSource, /shouldDismissFromSwipe\(info\.offset\.x, info\.velocity\.x, rowWidth\)/);
  assert.match(notificationsSource, /rowWidth \* 0\.34/);
  assert.match(notificationsSource, /await animate\(rowX, -rowWidth - 24/);
  assert.match(notificationsSource, /stiffness: 520/);
  assert.match(notificationsSource, /if \(onDismiss\(notification\) === false\) springRowBack\(\)/);
  assert.match(notificationsSource, /if \(updateNotifications\.isPending\) return false/);
  assert.doesNotMatch(notificationsSource, /dragSnapToOrigin/);
  assert.match(notificationsSource, /border-primary\/25 bg-card shadow-/);
  assert.match(notificationsSource, /aria-label=\{`Clear \$\{notification\.title/);
  assert.match(notificationsSource, /queryClient\.setQueryData\(queryKey, context\?\.previous/);
  assert.match(notificationsSource, /Updates could not load/);
  assert.match(notificationsSource, /pb-\[calc\(env\(safe-area-inset-bottom\)\+6rem\)\]/);
  assert.match(notificationsSource, /mx-auto w-full max-w-3xl/);
});

await test('Account member cards use a layout gap that works with links', async () => {
  assert.match(accountSource, /Member program and referral actions[\s\S]*className="grid gap-3"/);
  assert.match(accountSource, /<Link to="\/referral" className="block">/);
  assert.match(accountSource, /label: 'Updates', path: '\/notifications'/);
  assert.doesNotMatch(accountSource, /Member program and referral actions[\s\S]{0,200}className="space-y-3"/);
});

await test('G109 regression is included in the critical gate', async () => {
  assert.match(criticalSource, /run-g109-account-spacing-and-notification-center-tests\.mjs/);
});

console.log(JSON.stringify({
  ok: true,
  suite: 'g109-account-spacing-and-notification-center',
  checks: results.length,
  writes_performed: false,
  provider_calls_performed: false,
  results,
}, null, 2));
