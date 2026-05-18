import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Verifies whether Stripe keys are configured in live mode.
 * Checks the prefix of the secret key and webhook secret.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Check auth
    const user = await base44.auth.me().catch(() => null);
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const secretKey = Deno.env.get('STRIPE_SECRET_KEY') || '';
    const publishableKey = Deno.env.get('STRIPE_PUBLISHABLE_KEY') || '';
    const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET') || '';

    // Stripe key prefixes
    // Live: sk_live_, pk_live_, whsec_live_
    // Test: sk_test_, pk_test_, whsec_test_

    const secretKeyMode = secretKey.startsWith('sk_live_') ? 'LIVE' : secretKey.startsWith('sk_test_') ? 'TEST' : 'INVALID';
    const publishableKeyMode = publishableKey.startsWith('pk_live_') ? 'LIVE' : publishableKey.startsWith('pk_test_') ? 'TEST' : 'INVALID';
    const webhookSecretMode = webhookSecret.startsWith('whsec_live_') ? 'LIVE' : webhookSecret.startsWith('whsec_test_') ? 'TEST' : 'INVALID';

    const allLive = secretKeyMode === 'LIVE' && publishableKeyMode === 'LIVE' && webhookSecretMode === 'LIVE';

    return Response.json({
      summary: allLive ? '✅ ALL LIVE MODE' : '❌ NOT ALL LIVE MODE',
      details: {
        STRIPE_SECRET_KEY: secretKeyMode,
        STRIPE_PUBLISHABLE_KEY: publishableKeyMode,
        STRIPE_WEBHOOK_SECRET: webhookSecretMode,
      },
      allLive,
      keyPrefixes: {
        secretKey: secretKey.substring(0, 20) + '***',
        publishableKey: publishableKey.substring(0, 20) + '***',
        webhookSecret: webhookSecret.substring(0, 20) + '***',
      }
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});