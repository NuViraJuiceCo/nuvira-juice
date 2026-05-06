import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL              = `${(Deno.env.get('HUB_API_URL') || '').replace(/\/$/, '')}/functions/receiveCustomerAppEvent`;
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

/**
 * Syncs an app-originated order to the operations hub.
 * Called by: stripeWebhook on checkout.session.completed
 * Payload: { order_id: "<id>" }  OR  { data: <Order>, stripe_session: <Stripe session> }
 *
 * Payment status resolution (in priority order):
 *   1. Stripe session payment_status field (passed from webhook — most reliable)
 *   2. order.payment_captured === true → "paid"
 *   3. Default → "pending"
 *
 * NOTE: is_preorder is passed through as-is from the stored order record for
 * backward compatibility with existing orders. New orders will always have
 * is_preorder: false and this field has no effect on Hub processing behavior.
 */

function isFakeStripeId(id) {
  if (!id) return false;
  const fakePatterns = [
    'UNIQUE_SESSION_ID', 'UNIQUE_INTENT', 'cs_test_fake',
    'pi_test_fake', 'cs_live_FAKE', 'pi_live_FAKE',
    'test_session', 'test_intent',
  ];
  return fakePatterns.some(p => id.includes(p));
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const body   = await req.json();

  let order = body.data;
  const stripeSession = body.stripe_session || null;

  if (!order && body.order_id) {
    const results = await base44.asServiceRole.entities.Order.filter({ id: body.order_id });
    order = results[0] || null;
  }

  if (!order || !order.id) {
    console.error('syncOrderToHub: no order data provided');
    return Response.json({ error: 'No order data' }, { status: 400 });
  }

  // Block clearly fake/test Stripe IDs
  if (isFakeStripeId(order.stripe_checkout_session_id) || isFakeStripeId(order.stripe_payment_intent_id)) {
    const msg = `syncOrderToHub: BLOCKED — fake Stripe IDs on order ${order.order_number}`;
    console.error(msg);
    return Response.json({ error: 'Fake Stripe IDs blocked' }, { status: 400 });
  }

  if (!HUB_API_URL) {
    console.log('syncOrderToHub: HUB_API_URL not set, skipping');
    return Response.json({ success: true, skipped: true });
  }

  // Resolve payment_status from Stripe session (source of truth)
  let payment_status = 'pending';
  if (stripeSession?.payment_status === 'paid') {
    payment_status = 'paid';
  } else if (stripeSession?.payment_status) {
    payment_status = stripeSession.payment_status;
  } else if (order.payment_captured === true) {
    payment_status = 'paid';
  }
  // NOTE: is_preorder / authorized logic removed — all new orders are immediate capture.
  // Old orders with is_preorder:true already have correct payment_captured state in DB.

  console.log(`syncOrderToHub: payment_status="${payment_status}" for order ${order.order_number}`);

  // Resolve address fields — structured first, then fall back to parsing delivery_address string
  const addr = order.delivery_address || '';
  let address_line1       = order.address_line1       || '';
  let address_city        = order.address_city        || '';
  let address_state       = order.address_state       || '';
  let address_postal_code = order.address_postal_code || '';
  const address_country   = order.address_country     || 'US';

  if (!address_line1 && typeof addr === 'string' && addr.includes(',')) {
    const parts = addr.split(',').map(s => s.trim());
    address_line1       = parts[0] || '';
    address_city        = parts[1] || '';
    const stateZip      = (parts[2] || '').trim().split(' ');
    address_state       = stateZip[0] || '';
    address_postal_code = stateZip[1] || '';
    console.log(`syncOrderToHub: address parsed from string for ${order.order_number}: "${address_line1}", "${address_city}", "${address_state}", "${address_postal_code}"`);
  }

  if (!address_line1) {
    console.warn(`syncOrderToHub: WARNING — address_line1 blank for order ${order.order_number}`);
  }

  // order_type: always one_time for Customer App orders.
  // (Subscriptions go through createSubscriptionSession, not syncOrderToHub)
  const order_type       = 'one_time';
  const fulfillment_mode = 'single_delivery';

  const payload = {
    event:  'order.created',
    source: 'customer_app',
    order: {
      id:            order.id,
      order_number:  order.order_number,
      customer_email: order.customer_email,
      customer_name:  order.customer_name || '',
      customer_phone: order.contact_phone || '',
      address_line1,
      address_line2:       order.address_line2 || '',
      address_city,
      address_state,
      address_postal_code,
      address_country,
      delivery_address:    addr,
      line_items: (order.items || []).map(i => ({
        title:      i.title,
        quantity:   i.quantity,
        price:      i.price,
        product_id: i.product_id,
        image_url:  i.image_url || null,
      })),
      items:                   order.items,
      subtotal:                order.subtotal,
      delivery_fee:            order.delivery_fee,
      total_price:             order.total,
      total:                   order.total,
      fulfillment_method:      order.fulfillment_type || 'delivery',
      fulfillment_type:        order.fulfillment_type,
      requested_delivery_date:  order.estimated_delivery_date || null,
      estimated_delivery_date:  order.estimated_delivery_date,
      assigned_delivery_date:   order.assigned_delivery_date  || order.estimated_delivery_date || null,
      production_date:          order.production_date || null,
      delivery_window_label:    order.delivery_window_label   || '5 PM – 8 PM',
      delivery_window_start:    order.assigned_delivery_window_start || '17:00',
      delivery_window_end:      order.assigned_delivery_window_end   || '20:00',
      status:                   order.status,
      production_status:       'new',
      payment_status,
      // Backward compat: pass is_preorder from stored order record.
      // New orders will always be false. Old preorders keep their value.
      is_preorder:             order.is_preorder || false,
      customer_notes:          order.notes || '',
      notes:                   order.notes,
      stripe_checkout_session_id: order.stripe_checkout_session_id || null,
      stripe_payment_intent_id:   order.stripe_payment_intent_id   || null,
      created_date:    order.created_date,
      order_type,
      fulfillment_mode,
    },
  };

  const payloadSummary = `payment_status=${payment_status} | address="${address_line1}, ${address_city}, ${address_state} ${address_postal_code}" | customer="${order.customer_name}" | email="${order.customer_email}" | total=${order.total} | items=${(order.items||[]).length} | is_preorder=${order.is_preorder || false}`;
  console.log(`syncOrderToHub: PAYLOAD for ${order.order_number}: ${payloadSummary}`);

  try {
    const response = await fetch(HUB_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${CUSTOMER_APP_SYNC_SECRET}`,
      },
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();
    let hubResponse = null;
    try { hubResponse = JSON.parse(responseText); } catch { hubResponse = responseText; }

    if (response.status === 410) {
      console.log(`syncOrderToHub: Hub push deprecated (410). Order ${order.order_number} safe in Customer App DB.`);
      return Response.json({ success: true, note: 'Hub pull model — order will sync on next hub pull cycle' });
    }

    if (!response.ok) {
      console.error(`syncOrderToHub: hub returned ${response.status} for ${order.order_number}:`, responseText);
      // Log as error — eligible for retry by retryFailedHubSyncs
      try {
        await base44.asServiceRole.entities.OrderSyncLog.create({
          order_number: order.order_number,
          status:       'error',
          hub_action:   null,
          description:  `Hub HTTP ${response.status}. Retry eligible. ${payloadSummary}. Response: ${responseText.substring(0, 300)}`,
          started_at:   new Date().toISOString(),
          completed_at: new Date().toISOString(),
          triggered_by: body.triggered_by || 'stripe_webhook',
        });
      } catch (logErr) {
        console.warn(`syncOrderToHub: failed to write error log: ${logErr.message}`);
      }
      return Response.json({ error: `Hub returned ${response.status}`, details: responseText }, { status: response.status });
    }

    // --- Interpret Hub response contract ---
    // Hub should return: { action, hub_order_id?, matched_hub_order_id?, status?, note? }
    const hubAction = typeof hubResponse === 'object' ? (hubResponse?.action || hubResponse?.status || null) : null;
    const hubOrderId = typeof hubResponse === 'object' ? (hubResponse?.hub_order_id || hubResponse?.order_id || null) : null;
    const matchedHubOrderId = typeof hubResponse === 'object' ? (hubResponse?.matched_hub_order_id || null) : null;

    let logStatus;
    let logLabel;

    if (hubAction === 'created' || hubAction === 'updated') {
      // Confirmed operational sync — Hub created or updated a record
      logStatus = 'success';
      logLabel  = `✅ Hub ${hubAction} order. hub_order_id=${hubOrderId}`;
      console.log(`syncOrderToHub: ${logLabel} for ${order.order_number}`);

    } else if (hubAction === 'dedupe_exact_match') {
      // Hub matched an identical existing order — no new record created but order IS in Hub
      logStatus = 'deduped';
      logLabel  = `🔁 Hub dedupe_exact_match. matched_hub_order_id=${matchedHubOrderId}`;
      console.log(`syncOrderToHub: ${logLabel} for ${order.order_number}`);

    } else if (hubAction === 'queued_for_review') {
      logStatus = 'queued_for_review';
      logLabel  = `⏳ Hub queued_for_review. No operational record yet.`;
      console.warn(`syncOrderToHub: ${logLabel} for ${order.order_number}`);

    } else if (hubAction === 'rejected') {
      logStatus = 'rejected';
      logLabel  = `🚫 Hub rejected order. Response: ${JSON.stringify(hubResponse).substring(0, 200)}`;
      console.error(`syncOrderToHub: ${logLabel} for ${order.order_number}`);

    } else {
      // Catch-all: Hub returned 200 but no confirmed action (e.g. "acknowledged / no action required")
      // This is NOT a successful operational sync — mark skipped and keep retry eligible
      logStatus = 'skipped';
      logLabel  = `⚠️ Hub returned 200 with no confirmed action (hub_action="${hubAction}"). Retry eligible. Response: ${JSON.stringify(hubResponse).substring(0, 200)}`;
      console.warn(`syncOrderToHub: ${logLabel} for ${order.order_number}`);
    }

    try {
      await base44.asServiceRole.entities.OrderSyncLog.create({
        order_number:       order.order_number,
        status:             logStatus,
        hub_action:         hubAction || 'unknown',
        hub_order_id:       hubOrderId || undefined,
        matched_hub_order_id: matchedHubOrderId || undefined,
        description:        `${logLabel}. ${payloadSummary}`.substring(0, 1000),
        started_at:         new Date().toISOString(),
        completed_at:       new Date().toISOString(),
        triggered_by:       body.triggered_by || 'stripe_webhook',
      });
    } catch (logErr) {
      console.warn(`syncOrderToHub: failed to write log: ${logErr.message}`);
    }

    return Response.json({ success: logStatus === 'success' || logStatus === 'deduped', log_status: logStatus, hub_action: hubAction, hub_response: hubResponse });

  } catch (fetchErr) {
    console.error(`syncOrderToHub: fetch error for ${order.order_number}: ${fetchErr.message}`);

    try {
      await base44.asServiceRole.entities.OrderSyncLog.create({
        order_number:  order.order_number,
        status:        'error',
        description:   `Sync failed: ${fetchErr.message}. Payload: ${payloadSummary}`,
        started_at:    new Date().toISOString(),
        completed_at:  new Date().toISOString(),
        triggered_by:  body.triggered_by || 'stripe_webhook',
      });
    } catch (logErr) {
      console.warn(`syncOrderToHub: failed to write error log: ${logErr.message}`);
    }

    return Response.json({ error: fetchErr.message }, { status: 500 });
  }
});