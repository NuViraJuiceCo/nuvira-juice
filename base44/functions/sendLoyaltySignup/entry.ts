import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const ADMIN_APP_URL = Deno.env.get('ADMIN_APP_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

/**
 * Sends a loyalty member signup to the admin hub app.
 * Called after customer completes checkout/signup on rewards page.
 * Payload: { email, full_name, phone, signup_date }
 */
Deno.serve(async (req) => {
  try {
    const body = await req.json();
    const { email, full_name, phone, signup_date } = body;

    if (!email || !full_name) {
      console.error('sendLoyaltySignup: missing required fields');
      return Response.json({ error: 'Missing email or full_name' }, { status: 400 });
    }

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
    const url = `${ADMIN_APP_URL}/functions/receiveLoyaltySignup`;
    const requestHeaders = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${CUSTOMER_APP_SYNC_SECRET}`,
    };

    console.log(`sendLoyaltySignup: HTTP Request Details`);
    console.log(`  Method: POST`);
    console.log(`  URL: ${url}`);
    console.log(`  Headers:`, JSON.stringify(requestHeaders));
    console.log(`  Body:`, JSON.stringify(payload));

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
    return Response.json({ success: true, admin_response: result });
  } catch (error) {
    console.error('sendLoyaltySignup error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});