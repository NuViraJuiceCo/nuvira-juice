import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function normalizeStoreHost(raw) {
  const trimmed = String(raw || '').trim();
  const withoutProtocol = trimmed.replace(/^https?:\/\//i, '');
  const withoutTrailingSlash = withoutProtocol.replace(/\/+$/, '');

  if (!withoutTrailingSlash) {
    return { ok: false, host: '', reason: 'missing_store_url' };
  }

  if (withoutTrailingSlash.includes('/')) {
    return { ok: false, host: withoutTrailingSlash, reason: 'store_url_contains_path' };
  }

  return { ok: true, host: withoutTrailingSlash, reason: null };
}

function summarizeShopifyError(status, bodyText) {
  const trimmed = String(bodyText || '').slice(0, 500);
  try {
    const parsed = JSON.parse(trimmed);
    return parsed.errors || parsed.error || parsed.message || 'json_error_response';
  } catch {
    return trimmed || `HTTP ${status}`;
  }
}

async function probeShopify({ version, token, host }) {
  const response = await fetch(`https://${host}/admin/api/${version}/shop.json`, {
    method: 'GET',
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
    },
  });

  const bodyText = await response.text();
  let shop = null;

  if (response.ok) {
    try {
      shop = JSON.parse(bodyText).shop || null;
    } catch {
      shop = null;
    }
  }

  return {
    api_version: version,
    normalized_host: host,
    authenticated: response.ok,
    status: response.status,
    shop: shop ? {
      name: shop.name || null,
      domain: shop.domain || null,
      myshopify_domain: shop.myshopify_domain || null,
    } : null,
    error_summary: response.ok ? null : summarizeShopifyError(response.status, bodyText),
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Admin only' }, { status: 403 });
    }

    const token = Deno.env.get('SHOPIFY_API_TOKEN');
    const storeUrl = Deno.env.get('SHOPIFY_STORE_URL');
    const normalized = normalizeStoreHost(storeUrl);

    if (!token || !storeUrl || !normalized.ok) {
      return Response.json({
        probe: 'shopify_auth_only',
        read_only: true,
        creates_draft_order: false,
        pushes_order: false,
        results: [
          {
            api_version: '2024-01',
            normalized_host: normalized.host || null,
            authenticated: false,
            status: null,
            error_summary: !token ? 'missing_SHOPIFY_API_TOKEN' : normalized.reason,
          },
          {
            api_version: '2026-01',
            normalized_host: normalized.host || null,
            authenticated: false,
            status: null,
            error_summary: !token ? 'missing_SHOPIFY_API_TOKEN' : normalized.reason,
          },
        ],
      });
    }

    const results = [];
    for (const version of ['2024-01', '2026-01']) {
      try {
        results.push(await probeShopify({ version, token, host: normalized.host }));
      } catch (error) {
        results.push({
          api_version: version,
          normalized_host: normalized.host,
          authenticated: false,
          status: null,
          error_summary: error.message,
        });
      }
    }

    return Response.json({
      probe: 'shopify_auth_only',
      read_only: true,
      creates_draft_order: false,
      pushes_order: false,
      results,
    });
  } catch (error) {
    console.error('[verifyShopifyAuth] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
