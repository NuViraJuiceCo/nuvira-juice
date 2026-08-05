import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Scheduled fallback: polls Shopify for recent orders on a bounded interval
 * to catch any missed webhooks. The default three-hour lookback safely covers
 * the current two-hour automation cadence with overlap for delayed runs.
 */

function normalizeStoreHost(value: string | undefined): string {
  return String(value || '').trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
}

function shopifyClientSecrets() {
  const names = [
    'SHOPIFY_CLIENT_SECRET',
    'SHOPIFY_API_SECRET_KEY',
    'SHOPIFY_API_SECRET',
    'SHOPIFY_APP_SECRET',
    'SHOPIFY_SHARED_SECRET',
  ];
  const seen = new Set<string>();
  return names.flatMap((name) => {
    const value = Deno.env.get(name) || '';
    if (!value || seen.has(value)) return [];
    seen.add(value);
    return [{ name, value }];
  });
}

async function shopifyAccessToken(storeHost: string) {
  const clientId = Deno.env.get('SHOPIFY_CLIENT_ID') || '';
  const clientSecrets = shopifyClientSecrets();
  if (clientId && clientSecrets.length > 0) {
    let lastStatus = 400;
    for (const candidate of clientSecrets) {
      const response = await fetch(`https://${storeHost}/admin/oauth/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: candidate.value,
          grant_type: 'client_credentials',
        }),
      });
      lastStatus = response.status;
      if (!response.ok) continue;
      const payload = await response.json().catch(() => ({}));
      if (!payload?.access_token) continue;
      return {
        ok: true,
        token: String(payload.access_token),
        authFlow: 'client_credentials',
        credentialSource: candidate.name,
      } as const;
    }
    return { ok: false, status: lastStatus, error: 'shopify_client_credentials_exchange_failed' } as const;
  }

  const staticToken = Deno.env.get('SHOPIFY_API_TOKEN') || '';
  if (staticToken) return { ok: true, token: staticToken, authFlow: 'legacy_static_token', credentialSource: null } as const;
  return { ok: false, status: 500, error: 'shopify_credentials_not_configured' } as const;
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const caller = await base44.auth.me().catch(() => null);
  if (!caller) return Response.json({ error: 'unauthorized' }, { status: 401 });
  if (caller.role !== 'admin' && caller.role !== 'owner') return Response.json({ error: 'forbidden' }, { status: 403 });

  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
  const storeHost = normalizeStoreHost(Deno.env.get('SHOPIFY_STORE_URL'));
  const configuredApiVersion = Deno.env.get('SHOPIFY_ADMIN_API_VERSION') || '2026-07';
  const shopifyApiVersion = /^\d{4}-\d{2}$/.test(configuredApiVersion) ? configuredApiVersion : '2026-07';

  if (body?.action === 'connection_preview') {
    if (!storeHost) return Response.json({ success: false, error: 'shopify_store_not_configured' }, { status: 500 });
    const credential = await shopifyAccessToken(storeHost);
    if (!credential.ok) {
      return Response.json({ success: false, error: credential.error, provider_status: credential.status }, { status: 502 });
    }
    const [shopResponse, ordersResponse] = await Promise.all([
      fetch(`https://${storeHost}/admin/api/${shopifyApiVersion}/shop.json`, {
        headers: { 'X-Shopify-Access-Token': credential.token },
      }),
      fetch(`https://${storeHost}/admin/api/${shopifyApiVersion}/orders.json?status=any&limit=1`, {
        headers: { 'X-Shopify-Access-Token': credential.token },
      }),
    ]);
    return Response.json({
      success: shopResponse.ok && ordersResponse.ok,
      preview: true,
      writes_performed: false,
      ingestion_performed: false,
      auth_flow: credential.authFlow,
      credential_source: credential.credentialSource || null,
      api_version: shopifyApiVersion,
      shop_status: shopResponse.status,
      orders_status: ordersResponse.status,
    }, { status: shopResponse.ok && ordersResponse.ok ? 200 : 502 });
  }

  if (Deno.env.get('SHOPIFY_POLL_FALLBACK_KILL_SWITCH') === 'true') {
    return Response.json({
      ok: true,
      skipped: true,
      polled: 0,
      new_created: 0,
      gate: 'SHOPIFY_POLL_FALLBACK_KILL_SWITCH',
      reason: 'shopify_poll_fallback_killed',
      message: 'Shopify poll fallback is stopped by the emergency kill switch.',
    });
  }

  if (!storeHost) {
    console.warn('Shopify credentials not set — skipping poll');
    return Response.json({ skipped: true });
  }
  const credential = await shopifyAccessToken(storeHost);
  if (!credential.ok) {
    console.error('Shopify credential exchange failed:', credential.status);
    return Response.json({ error: credential.error, status: credential.status }, { status: 502 });
  }

  const configuredLookback = Number(Deno.env.get('SHOPIFY_POLL_LOOKBACK_MINUTES') || 180);
  const lookbackMinutes = Number.isFinite(configuredLookback)
    ? Math.min(1440, Math.max(30, Math.round(configuredLookback)))
    : 180;
  const since = new Date(Date.now() - lookbackMinutes * 60 * 1000).toISOString();
  const url = `https://${storeHost}/admin/api/${shopifyApiVersion}/orders.json?status=any&limit=50&updated_at_min=${encodeURIComponent(since)}`;

  let orders = [];
  const shopifyRes = await fetch(url, {
    headers: { 'X-Shopify-Access-Token': credential.token },
  });
  if (!shopifyRes.ok) {
    console.error('Shopify poll error:', shopifyRes.status);
    return Response.json({ error: 'Shopify API error', status: shopifyRes.status });
  }
  const data = await shopifyRes.json();
  orders = data.orders || [];
  console.log(`Poll found ${orders.length} recently updated orders`);

  let synced = 0;
  let refreshed = 0;
  let failed = 0;
  for (const order of orders) {
    const shopifyOrderId = String(order.id);
    const existing = await base44.asServiceRole.entities.ShopifyOrder.filter({ shopify_order_id: shopifyOrderId }, '-created_date', 1);
    try {
      const response = await base44.asServiceRole.functions.invoke('shopifyWebhookReceiver', {
        internal_topic: 'orders/create',
        source: 'shopify_poll_fallback',
        data: order,
      }, { headers: { 'x-internal-secret': Deno.env.get('CUSTOMER_APP_SYNC_SECRET') || Deno.env.get('HUB_SYNC_SECRET') || '' } });
      const result = response?.data || response;
      if (result?.ok !== true) throw new Error(result?.error || 'canonical_ingestion_failed');
      if (existing.length === 0) {
        synced++;
        console.log(`Poll recovered missed order through canonical ingestion: #${order.order_number}`);
      } else {
        refreshed++;
      }
    } catch (error) {
      failed++;
      console.error(`Poll canonical ingestion failed for Shopify order ${shopifyOrderId}:`, error?.message || error);
    }
  }

  // Only log when something was actually synced — avoid writing 96 empty records/day
  if (synced > 0 || failed > 0) {
    await base44.asServiceRole.entities.ShopifySyncLog.create({
      sync_type: 'orders', status: failed > 0 ? 'partial' : 'success',
      records_synced: synced + refreshed, records_failed: failed,
      started_at: new Date().toISOString(), completed_at: new Date().toISOString(),
      triggered_by: 'cron',
    });
  }

  return Response.json({ ok: failed === 0, auth_flow: credential.authFlow, api_version: shopifyApiVersion, lookback_minutes: lookbackMinutes, polled: orders.length, new_created: synced, refreshed, failed });
});
