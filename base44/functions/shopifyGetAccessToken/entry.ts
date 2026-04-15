import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * One-time helper: exchanges the OAuth code for a permanent access token.
 * Call this from the Shopify OAuth callback URL, or manually with a code.
 * 
 * Also provides a way to generate the OAuth install URL.
 */

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  const CLIENT_ID = Deno.env.get('SHOPIFY_CLIENT_ID');
  const CLIENT_SECRET = Deno.env.get('SHOPIFY_API_TOKEN'); // the "Secret" from dev dashboard
  const STORE_URL = Deno.env.get('SHOPIFY_STORE_URL');

  if (!CLIENT_ID || !CLIENT_SECRET || !STORE_URL) {
    return Response.json({ error: 'Missing credentials' }, { status: 500 });
  }

  const storeHost = STORE_URL.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const body = await req.json().catch(() => ({}));
  const { code } = body;

  // If no code provided, return the install/authorize URL so they can get one
  if (!code) {
    const scopes = 'read_products,write_products,read_orders,write_orders,read_draft_orders,write_draft_orders,read_inventory';
    const redirectUri = 'https://nuvira-juice-company.myshopify.com'; // placeholder
    const installUrl = `https://${storeHost}/admin/oauth/authorize?client_id=${CLIENT_ID}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}`;
    return Response.json({ 
      message: 'Provide a "code" in the request body, or use the install_url to get one',
      install_url: installUrl,
      store: storeHost,
    });
  }

  // Exchange the code for a permanent access token
  console.log('Exchanging OAuth code for access token...');
  const tokenRes = await fetch(`https://${storeHost}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
    }),
  });

  const tokenData = await tokenRes.json();
  console.log('Token exchange response:', JSON.stringify(tokenData));

  if (!tokenRes.ok || !tokenData.access_token) {
    return Response.json({ error: 'Token exchange failed', details: tokenData }, { status: 400 });
  }

  return Response.json({
    success: true,
    access_token: tokenData.access_token,
    scope: tokenData.scope,
    instructions: 'Copy the access_token above and save it as SHOPIFY_API_TOKEN in your Base44 secrets (replacing the current secret value)',
  });
});