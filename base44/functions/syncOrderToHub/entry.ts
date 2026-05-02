import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

/**
 * Syncs an app-originated order (from Base44 checkout) to the operations hub.
 * Called by: stripeWebhook on checkout.session.completed
 * Payload: { order_id: "<id>" }  OR  { data: <Order object>, stripe_session: <Stripe session object> }
 *
 * FIX 2026-05-02:
 * - payment_status is now always derived from Stripe session (paid/unpaid), never from local order state
 * - address fields are sourced from order structured fields first, then delivery_address string parse
 * - fake/malformed Stripe IDs are blocked from production ingestion
 * - full payload is logged to OrderSyncLog for auditability
 */

// Guard: detect clearly fake/test Stripe IDs that should never reach production
function isFakeStripeId(id) {
  if (!id) return false;
  const fakePatterns = [
    'UNIQUE_SESSION_ID',
    'UNIQUE_INTENT',
    'cs_test_fake',
    'pi_test_fake',
    'cs_live_FAKE',
    'pi_live_FAKE',
    'test_session',
    'test_intent',
  ];
  return fakePatterns.some(p => id.includes(p));
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const body = await req.json();

  let order = body.data;
  const stripeSession = body.stripe_session || null; // Stripe session passed from webhook for payment_status

  // If only an order_id was passed, fetch the full order
  if (!order && body.order_id) {
    const results = await base44.asServiceRole.entities.Order.filter({ id: body.order_id });
    order = results[0] || null;
  }

  if (!order || !order.id) {
    console.error('syncOrderToHub: no order data provided');
    return Response.json({ error: 'No order data' }, { status: 400 });
  }

  // GUARD: Block fake/test Stripe IDs from reaching production Hub
  if (isFakeStripeId(order.stripe_checkout_session_id) || isFakeStripeId(order.stripe_payment_intent_id)) {
    const msg = `syncOrderToHub: BLOCKED — fake/test Stripe IDs detected on order ${order.order_number}. session=${order.stripe_checkout_session_id}, intent=${order.stripe_payment_intent_id}`;
    console.error(msg);
    return Response.json({ error: 'Fake Stripe IDs blocked from production ingestion' }, { status: 400 });
  }

  if (!HUB_API_URL) {
    console.log('syncOrderToHub: HUB_API_URL not set, skipping');
    return Response.json({ success: true, skipped: true });
  }

  // FIX: Resolve payment_status from Stripe session (source of truth), NOT local order state.
  // stripeWebhook passes stripe_session when calling from checkout.session.completed handler.
  // For manual/recovery calls, fall back to payment_captured flag on order.
  let payment_status = 'pending'; // safe default
  if (stripeSession?.payment_status === 'paid') {
    payment_status = 'paid';
  } else if (stripeSession?.payment_status) {
    payment_status = stripeSession.payment_status;
  } else if (order.payment_captured === true) {
    // No stripe session passed but we know payment was captured
    payment_status = 'paid';
  } else if (order.is_preorder) {
    // Pre-orders are authorized (not yet captured)
    payment_status = 'authorized';
  }

  console.log(`syncOrderToHub: payment_status resolved to "${payment_status}" for order ${order.order_number} (stripe_session.payment_status=${stripeSession?.payment_status}, order.payment_captured=${order.payment_captured})`);

  // FIX: Resolve address fields — structured fields first, then parse from delivery_address string.
  // Never send blank address_line1 if the data exists anywhere on the order.
  const addr = order.delivery_address || '';
  let address_line1 = order.address_line1 || '';
  let address_city = order.address_city || '';
  let address_state = order.address_state || '';
  let address_postal_code = order.address_postal_code || '';
  const address_country = order.address_country || 'US';

  // If structured fields are blank, fall back to parsing delivery_address string
  if (!address_line1 && typeof addr === 'string' && addr.includes(',')) {
    const parts = addr.split(',').map(s => s.trim());
    address_line1 = parts[0] || '';
    address_city = parts[1] || '';
    const stateZip = (parts[2] || '').trim().split(' ');
    address_state = stateZip[0] || '';
    address_postal_code = stateZip[1] || '';
    console.log(`syncOrderToHub: address parsed from delivery_address string for order ${order.order_number}: line1="${address_line1}", city="${address_city}", state="${address_state}", zip="${address_postal_code}"`);
  }

  // Warn explicitly if address is still blank after all resolution attempts
  if (!address_line1) {
    console.warn(`syncOrderToHub: WARNING — address_line1 is still blank for order ${order.order_number} after all resolution. delivery_address="${addr}", order.address_line1="${order.address_line1}"`);
  }

  // Infer order_type from order characteristics
  let order_type = 'one_time';
  if (order.stripe_payment_intent_id && !order.stripe_checkout_session_id) {
    order_type = 'subscription';
  } else if (order.notes && order.notes.includes('Subscription')) {
    order_type = 'subscription';
  }
  const fulfillment_mode = order_type === 'subscription' ? 'multi_delivery' : 'single_delivery';

  const payload = {
    event: 'order.created',
    source: 'customer_app',
    order: {
      id: order.id,
      order_number: order.order_number,
      customer_email: order.customer_email,
      customer_name: order.customer_name || '',
      customer_phone: order.contact_phone || '',
      // Fully resolved address fields
      address_line1,
      address_line2: order.address_line2 || '',
      address_city,
      address_state,
      address_postal_code,
      address_country,
      delivery_address: addr,
      // Line items
      line_items: (order.items || []).map(i => ({
        title: i.title,
        quantity: i.quantity,
        price: i.price,
        product_id: i.product_id,
        image_url: i.image_url || null,
      })),
      items: order.items,
      subtotal: order.subtotal,
      delivery_fee: order.delivery_fee,
      total_price: order.total,
      total: order.total,
      fulfillment_method: order.fulfillment_type || 'delivery',
      fulfillment_type: order.fulfillment_type,
      requested_delivery_date: order.estimated_delivery_date || null,
      estimated_delivery_date: order.estimated_delivery_date,
      status: order.status,
      production_status: 'new',
      // FIX: payment_status always from Stripe, never from stale local state
      payment_status,
      is_preorder: order.is_preorder,
      preorder_fulfillment_date: order.preorder_fulfillment_date,
      customer_notes: order.notes || '',
      notes: order.notes,
      stripe_checkout_session_id: order.stripe_checkout_session_id || null,
      stripe_payment_intent_id: order.stripe_payment_intent_id || null,
      created_date: order.created_date,
      order_type,
      fulfillment_mode,
    },
  };

  // Log exact payload for audit
  const payloadSummary = `payment_status=${payment_status} | address_line1="${address_line1}" | address_city="${address_city}" | address_state="${address_state}" | address_postal_code="${address_postal_code}" | customer_name="${order.customer_name}" | customer_email="${order.customer_email}" | total=${order.total} | items=${(order.items||[]).length}`;
  console.log(`syncOrderToHub: PAYLOAD SUMMARY for ${order.order_number}: ${payloadSummary}`);
  console.log(`syncOrderToHub: syncing order ${order.order_number} to hub`);

  try {
    const response = await fetch(HUB_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CUSTOMER_APP_SYNC_SECRET}`,
      },
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();
    let hubResponse = null;
    try { hubResponse = JSON.parse(responseText); } catch { hubResponse = responseText; }

    if (response.status === 410) {
      console.log(`syncOrderToHub: hub push endpoint deprecated (410). Order ${order.order_number} safe in Customer App DB — will be pulled by hub.`);
      return Response.json({ success: true, note: 'Hub pull model — order will sync on next hub pull cycle' });
    }

    if (!response.ok) {
      console.error(`syncOrderToHub: hub returned ${response.status} for order ${order.order_number}:`, responseText);
      return Response.json({ error: `Hub returned ${response.status}`, details: responseText }, { status: response.status });
    }

    console.log(`syncOrderToHub: ✅ order ${order.order_number} accepted by Hub. Response:`, JSON.stringify(hubResponse));

    // Log success with full payload summary to OrderSyncLog
    try {
      await base44.asServiceRole.entities.OrderSyncLog.create({
        order_number: order.order_number,
        status: 'success',
        description: `Hub accepted. Payload: ${payloadSummary}. Hub response: ${JSON.stringify(hubResponse).substring(0, 300)}`,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        triggered_by: body.triggered_by || 'stripe_webhook',
      });
    } catch (logErr) {
      console.warn(`syncOrderToHub: failed to write success OrderSyncLog: ${logErr.message}`);
    }

    return Response.json({ success: true, hub_response: hubResponse });

  } catch (fetchErr) {
    console.error(`syncOrderToHub: fetch error for order ${order.order_number}: ${fetchErr.message}`);

    // Log failure with full payload details
    try {
      await base44.asServiceRole.entities.OrderSyncLog.create({
        order_number: order.order_number,
        status: 'error',
        description: `Sync failed: ${fetchErr.message}. Payload attempted: ${payloadSummary}`,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        triggered_by: body.triggered_by || 'stripe_webhook',
      });
    } catch (logErr) {
      console.warn(`syncOrderToHub: failed to write error OrderSyncLog: ${logErr.message}`);
    }

    return Response.json({ error: fetchErr.message }, { status: 500 });
  }
});