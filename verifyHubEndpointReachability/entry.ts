import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Verify Hub receiveCustomerAppEvent endpoint is publicly reachable.
 * Tests the endpoint with minimal payload to confirm exposure without side effects.
 * Admin-only diagnostic tool.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin only' }, { status: 403 });
    }

    const hubBaseUrl = (Deno.env.get('HUB_API_URL') || '').trim();
    const secret = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

    if (!hubBaseUrl || !secret) {
      return Response.json({
        error: 'Missing HUB_API_URL or CUSTOMER_APP_SYNC_SECRET',
      }, { status: 500 });
    }

    // Build URL as syncCustomerToHub does
    const hubUrl = hubBaseUrl.endsWith('/')
      ? `${hubBaseUrl}api/functions/receiveCustomerAppEvent`
      : `${hubBaseUrl}/api/functions/receiveCustomerAppEvent`;

    console.log(`[verifyHubEndpoint] Testing endpoint reachability`);
    console.log(`[verifyHubEndpoint] URL: ${hubUrl}`);
    console.log(`[verifyHubEndpoint] Method: POST`);
    console.log(`[verifyHubEndpoint] Auth: Bearer token`);

    // Minimal test payload
    const testPayload = {
      event: 'customer.test_endpoint_verification',
      source: 'customer_app',
      customer_email: 'test@internal.local',
      data: { test: true },
      synced_at: new Date().toISOString(),
    };

    const response = await fetch(hubUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${secret}`,
      },
      body: JSON.stringify(testPayload),
    });

    const responseText = await response.text();
    let responseBody = null;
    try {
      responseBody = JSON.parse(responseText);
    } catch {
      responseBody = { raw: responseText };
    }

    console.log(`[verifyHubEndpoint] Response status: ${response.status}`);
    console.log(`[verifyHubEndpoint] Response: ${JSON.stringify(responseBody)}`);

    const isReachable = response.status < 500; // 2xx, 3xx, 4xx are reachable; 5xx server error
    const isAuthenticated = response.status !== 401;
    const isEndpointFound = response.status !== 404;

    return Response.json({
      endpoint_url: hubUrl,
      method: 'POST',
      auth_scheme: 'Bearer CUSTOMER_APP_SYNC_SECRET',
      is_reachable: isReachable,
      is_endpoint_found: isEndpointFound,
      is_authenticated: isAuthenticated,
      response_status: response.status,
      response_body: responseBody,
      diagnostics: {
        status_2xx: response.status >= 200 && response.status < 300 ? '✅ Accepted' : '❌',
        status_4xx: response.status >= 400 && response.status < 500 ? `⚠️ ${response.status}` : '✅ OK',
        status_5xx: response.status >= 500 ? '❌ Hub server error' : '✅ OK',
        message: isEndpointFound
          ? isAuthenticated
            ? response.status < 300
              ? '✅ Endpoint is reachable and authenticated'
              : `⚠️ Endpoint reachable but returned ${response.status}. May need auth review.`
            : '❌ Authentication failed (401). Check CUSTOMER_APP_SYNC_SECRET'
          : '❌ Endpoint not found (404). Check HUB_API_URL and endpoint path.',
      },
    });

  } catch (error) {
    console.error('[verifyHubEndpoint] Error:', error.message);
    return Response.json({ error: error.message, error_type: error.constructor.name }, { status: 500 });
  }
});