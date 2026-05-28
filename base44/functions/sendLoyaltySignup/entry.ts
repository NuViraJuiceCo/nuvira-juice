import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const ADMIN_APP_URL = Deno.env.get('ADMIN_APP_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

function legacyLoyaltyEventBridgeEnabled() {
  return Deno.env.get('ENABLE_LEGACY_LOYALTY_EVENT_BRIDGE_SYNC') === 'true';
}

// Pre-order bonus: 250 pts for signing up April 23–30
const PREORDER_BONUS_POINTS = 250;
const PREORDER_START = new Date('2026-04-23T00:00:00');
const PREORDER_END   = new Date('2026-04-30T23:59:59');

function isPreorderWindow() {
  const now = new Date();
  return now >= PREORDER_START && now <= PREORDER_END;
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

async function requireOwnerOrAdmin(base44, email) {
  const user = await base44.auth.me().catch(() => null);
  if (!user) return { response: Response.json({ error: 'unauthorized' }, { status: 401 }) };
  const targetEmail = normalizeEmail(email);
  const requesterEmail = normalizeEmail(user.email);
  if (user.role !== 'admin' && requesterEmail !== targetEmail) {
    return { response: Response.json({ error: 'forbidden' }, { status: 403 }) };
  }
  return { user };
}

/**
 * Sends a loyalty member signup to the admin hub app.
 * Called after customer completes checkout/signup on rewards page.
 * Payload: { email, full_name, phone, signup_date }
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) {
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    }

    if (!legacyLoyaltyEventBridgeEnabled()) {
      return Response.json({
        success: true,
        skipped: true,
        reason: 'legacy_loyalty_event_bridge_sync_disabled',
        message: 'Legacy loyalty/event bridge sync is disabled for the May 30 launch freeze.',
      }, { status: 409 });
    }

    const body = await req.json();
    const { email, full_name, phone, signup_date } = body;

    if (!email || !full_name) {
      console.error('sendLoyaltySignup: missing required fields');
      return Response.json({ error: 'Missing email or full_name' }, { status: 400 });
    }

    const auth = await requireOwnerOrAdmin(base44, email);
    if (auth.response) return auth.response;

    if (!ADMIN_APP_URL) {
      console.log('sendLoyaltySignup: ADMIN_APP_URL not set, skipping');
      return Response.json({ success: true, skipped: true });
    }

    const payload = {
      email,
      full_name,
      phone: phone || null,
      signup_date: signup_date || new Date().toISOString().split('T')[0],
    };

    console.log(`sendLoyaltySignup: posting signup for ${email}`);

    // POST to admin hub's receiveLoyaltySignup function endpoint
    const baseUrl = ADMIN_APP_URL.endsWith('/') ? ADMIN_APP_URL.slice(0, -1) : ADMIN_APP_URL;
    const url = `${baseUrl}/functions/receiveLoyaltySignup`;
    const requestHeaders = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${CUSTOMER_APP_SYNC_SECRET}`,
    };

    console.log(`sendLoyaltySignup: POST ${url} for ${email}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(payload),
    });
    
    console.log(`sendLoyaltySignup: Response status ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`sendLoyaltySignup: admin returned ${response.status}:`, errorText);
      return Response.json({ error: `Admin returned ${response.status}`, details: errorText }, { status: response.status });
    }

    const result = await response.json();
    console.log(`sendLoyaltySignup: success`, result);

    // Award pre-order bonus points if signing up during the pre-order window
    if (isPreorderWindow()) {
      const existing = await base44.asServiceRole.entities.UserPoints.filter({ customer_email: email });
      const bonusEntry = {
        amount: PREORDER_BONUS_POINTS,
        type: 'bonus',
        description: 'Pre-order launch bonus — thanks for being an early supporter! 🎉',
        timestamp: new Date().toISOString(),
      };

      if (existing.length > 0) {
        const rec = existing[0];
        const history = rec.points_history || [];
        history.push(bonusEntry);
        await base44.asServiceRole.entities.UserPoints.update(rec.id, {
          total_points: (rec.total_points || 0) + PREORDER_BONUS_POINTS,
          lifetime_points: (rec.lifetime_points || 0) + PREORDER_BONUS_POINTS,
          points_history: history,
        });
      } else {
        await base44.asServiceRole.entities.UserPoints.create({
          customer_email: email,
          total_points: PREORDER_BONUS_POINTS,
          lifetime_points: PREORDER_BONUS_POINTS,
          redeemed_points: 0,
          points_history: [bonusEntry],
        });
      }
      console.log(`sendLoyaltySignup: awarded ${PREORDER_BONUS_POINTS} pre-order bonus points to ${email}`);
    }

    return Response.json({ success: true, admin_response: result, preorder_bonus: isPreorderWindow() ? PREORDER_BONUS_POINTS : 0 });
  } catch (error) {
    console.error('sendLoyaltySignup error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
