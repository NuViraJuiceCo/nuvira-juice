// @ts-nocheck
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const IOS_BUNDLE_ID = 'com.base69d48d0c39891f7945481152.app';
const ANDROID_APP_ID = 'com.nuvirajuice.app';
const ACTIONS = new Set(['register_capability', 'register_activity', 'end_activity', 'status']);

function normalizeSingleLine(value: unknown, maxLength = 180): string {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function normalizeEmail(value: unknown): string {
  return normalizeSingleLine(value, 160).toLowerCase();
}

function normalizeIdentifier(value: unknown, field: string, { required = true } = {}): string {
  const text = normalizeSingleLine(value, 180);
  if (!text && !required) return '';
  if (!text || !/^[A-Za-z0-9._:@/-]+$/.test(text)) throw new Error(`${field} is invalid`);
  return text;
}

function normalizePlatform(value: unknown): 'ios' | 'android' {
  const platform = normalizeSingleLine(value, 20).toLowerCase();
  if (platform !== 'ios' && platform !== 'android') throw new Error('platform must be ios or android');
  return platform;
}

function normalizeToken(value: unknown, field: string, { required = false } = {}): string {
  const token = normalizeSingleLine(value, 4096).toLowerCase();
  if (!token && !required) return '';
  if (!/^[a-f0-9]+$/.test(token) || token.length < 32 || token.length > 4096 || token.length % 2 !== 0) {
    throw new Error(`${field} is invalid`);
  }
  return token;
}

function normalizeEnvironment(value: unknown): 'unknown' | 'sandbox' | 'production' {
  const environment = normalizeSingleLine(value, 20).toLowerCase();
  return environment === 'sandbox' || environment === 'production' ? environment : 'unknown';
}

async function readJsonBody(req: Request) {
  try {
    const body = await req.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

async function findOwnedOrder(base44: any, orderId: string, customerEmail: string) {
  const rows = await base44.asServiceRole.entities.Order.filter({ id: orderId }, undefined, 1);
  const order = rows[0] || null;
  return order && normalizeEmail(order.customer_email) === customerEmail ? order : null;
}

async function upsertRegistration(base44: any, filters: Record<string, any>, payload: Record<string, any>) {
  const rows = await base44.asServiceRole.entities.DeliveryLiveActivity.filter(filters, '-updated_date', 5);
  const current = rows.find((row: Record<string, any>) => row.state !== 'revoked') || rows[0];
  return current
    ? await base44.asServiceRole.entities.DeliveryLiveActivity.update(current.id, payload)
    : await base44.asServiceRole.entities.DeliveryLiveActivity.create(payload);
}

function safeRegistrationSummary(record: Record<string, any>) {
  return {
    registration_id: record.id || null,
    scope: record.scope,
    platform: record.platform,
    state: record.state,
    order_id: record.order_id || null,
    order_number: record.order_number || null,
    remote_start_ready: Boolean(record.push_to_start_token),
    remote_update_ready: record.platform === 'android' || Boolean(record.activity_push_token),
    last_updated_at: record.last_updated_at || null,
  };
}

export default async function handler(req: Request) {
  if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 });

  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user?.email) return Response.json({ error: 'authentication_required' }, { status: 401 });
    const customerEmail = normalizeEmail(user.email);

    const body = await readJsonBody(req);
    if (!body) return Response.json({ error: 'malformed_json' }, { status: 400 });
    const action = normalizeSingleLine(body.action, 40).toLowerCase();
    if (!ACTIONS.has(action)) return Response.json({ error: 'unsupported_live_activity_action' }, { status: 400 });

    if (action === 'status') {
      const rows = await base44.asServiceRole.entities.DeliveryLiveActivity.filter({ customer_email: customerEmail }, '-updated_date', 50);
      const active = rows.filter((row: Record<string, any>) => row.enabled !== false && row.state !== 'revoked');
      return Response.json({
        success: true,
        supported_schema_version: 1,
        registrations: active.map(safeRegistrationSummary),
      });
    }

    const platform = normalizePlatform(body.platform);
    const installationId = normalizeIdentifier(body.installation_id, 'installation_id');
    const bundleId = platform === 'ios' ? IOS_BUNDLE_ID : ANDROID_APP_ID;
    const suppliedBundleId = normalizeSingleLine(body.app_bundle_id, 180);
    if (suppliedBundleId && suppliedBundleId !== bundleId) {
      return Response.json({ error: 'app_bundle_id_not_allowed' }, { status: 400 });
    }
    const now = new Date().toISOString();

    if (action === 'register_capability') {
      const pushToStartToken = platform === 'ios'
        ? normalizeToken(body.push_to_start_token, 'push_to_start_token')
        : '';
      const record = await upsertRegistration(base44, {
        customer_email: customerEmail,
        scope: 'installation',
        platform,
        installation_id: installationId,
      }, {
        customer_email: customerEmail,
        scope: 'installation',
        platform,
        installation_id: installationId,
        push_to_start_token: pushToStartToken || null,
        activity_push_token: null,
        apns_environment: platform === 'ios' ? normalizeEnvironment(body.apns_environment) : 'unknown',
        app_bundle_id: bundleId,
        app_version: normalizeSingleLine(body.app_version, 80) || null,
        build_number: normalizeSingleLine(body.build_number, 40) || null,
        state: 'registered',
        enabled: body.enabled !== false,
        last_updated_at: now,
        ended_at: null,
        revoked_at: null,
      });
      return Response.json({ success: true, registration: safeRegistrationSummary(record) });
    }

    const orderId = normalizeIdentifier(body.order_id, 'order_id');
    const order = await findOwnedOrder(base44, orderId, customerEmail);
    if (!order) return Response.json({ error: 'order_not_found' }, { status: 404 });

    if (action === 'register_activity') {
      const activityId = normalizeIdentifier(body.activity_id, 'activity_id');
      const activityPushToken = platform === 'ios'
        ? normalizeToken(body.activity_push_token, 'activity_push_token')
        : '';
      const delivered = normalizeSingleLine(order.status, 40).toLowerCase() === 'delivered';
      const record = await upsertRegistration(base44, {
        customer_email: customerEmail,
        scope: 'activity',
        platform,
        installation_id: installationId,
        order_id: orderId,
      }, {
        customer_email: customerEmail,
        scope: 'activity',
        platform,
        installation_id: installationId,
        order_id: orderId,
        order_number: normalizeSingleLine(order.order_number, 80) || null,
        activity_id: activityId,
        activity_push_token: activityPushToken || null,
        apns_environment: platform === 'ios' ? normalizeEnvironment(body.apns_environment) : 'unknown',
        app_bundle_id: bundleId,
        app_version: normalizeSingleLine(body.app_version, 80) || null,
        build_number: normalizeSingleLine(body.build_number, 40) || null,
        state: 'active',
        enabled: true,
        started_at: now,
        last_updated_at: now,
        ended_at: null,
        revoked_at: null,
      });
      if (delivered && platform === 'ios' && activityPushToken) {
        await base44.asServiceRole.functions.invoke('sendCustomerPushNotification', {
          operation: 'refresh_delivery_live_activity',
          order_id: orderId,
          refresh_route: false,
          source: 'late_activity_token_registration',
        }).catch(() => null);
      }
      return Response.json({ success: true, registration: safeRegistrationSummary(record) });
    }

    const activityId = normalizeIdentifier(body.activity_id, 'activity_id', { required: false });
    const rows = await base44.asServiceRole.entities.DeliveryLiveActivity.filter({
      customer_email: customerEmail,
      scope: 'activity',
      platform,
      installation_id: installationId,
      order_id: orderId,
    }, '-updated_date', 20);
    const matches = rows.filter((row: Record<string, any>) => !activityId || row.activity_id === activityId);
    for (const row of matches) {
      await base44.asServiceRole.entities.DeliveryLiveActivity.update(row.id, {
        state: 'ended',
        enabled: false,
        ended_at: now,
        last_updated_at: now,
      });
    }
    return Response.json({ success: true, ended: matches.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to manage delivery live activity';
    const clientError = /invalid|must be|required|not allowed/i.test(message);
    console.warn(`[manageDeliveryLiveActivity] ${clientError ? 'invalid_request' : 'operation_failed'}`);
    return Response.json({ error: clientError ? message : 'delivery_live_activity_unavailable' }, { status: clientError ? 400 : 500 });
  }
}
