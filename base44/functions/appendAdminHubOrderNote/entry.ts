import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const MAX_NOTE_LENGTH = 1000;

function normalizeText(value) {
  return (value ?? '').toString().trim();
}

function normalizeSingleLine(value) {
  return normalizeText(value).replace(/\s+/g, ' ');
}

function normalizeNote(value) {
  return normalizeSingleLine(value);
}

async function readJsonBody(req) {
  try {
    const body = await req.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  } catch {
    return null;
  }
}

function sanitizeHubResponse(data, requestId) {
  return {
    success: data?.success === true,
    appended: data?.appended === true,
    skipped: data?.skipped === true,
    reason: data?.reason || null,
    request_id: data?.request_id || requestId || null,
    hub_order_id: data?.hub_order_id || null,
    order_number: data?.order_number || null,
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    let user = null;
    try {
      user = await base44.auth.me();
    } catch {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await readJsonBody(req);
    if (body === null) {
      return Response.json({ error: 'malformed_json' }, { status: 400 });
    }

    const hubOrderId = normalizeText(body.hub_order_id);
    const orderNumber = normalizeText(body.order_number);
    const note = normalizeNote(body.note);
    const requestId = normalizeSingleLine(body.request_id);

    if (!hubOrderId && !orderNumber) {
      return Response.json({
        error: 'At least one scoped identifier is required',
        required_any_of: ['hub_order_id', 'order_number'],
      }, { status: 400 });
    }

    if (!note) {
      return Response.json({ error: 'note is required' }, { status: 400 });
    }

    if (note.length > MAX_NOTE_LENGTH) {
      return Response.json({ error: `note must be ${MAX_NOTE_LENGTH} characters or fewer` }, { status: 400 });
    }

    if (!requestId) {
      return Response.json({ error: 'request_id is required' }, { status: 400 });
    }

    if (!HUB_API_URL || !CUSTOMER_APP_SYNC_SECRET) {
      return Response.json({ error: 'Hub note service is not configured' }, { status: 503 });
    }

    const hubBase = HUB_API_URL.replace(/\/$/, '').replace(/\/api\/functions\/.*$/, '').replace(/\/functions\/.*$/, '');
    const hubResponse = await fetch(`${hubBase}/functions/appendOrderInternalNoteForCustomerApp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${CUSTOMER_APP_SYNC_SECRET}`,
      },
      body: JSON.stringify({
        hub_order_id: hubOrderId || null,
        order_number: orderNumber || null,
        note,
        request_id: requestId,
        actor_email: user.email,
        actor_role: user.role,
        source: 'customer_app_admin',
      }),
    });

    const hubData = await hubResponse.json().catch(() => null);

    if (!hubResponse.ok) {
      return Response.json({
        error: hubData?.error || 'Unable to append Hub internal note',
        hub_status: hubResponse.status,
      }, { status: hubResponse.status >= 400 && hubResponse.status < 500 ? hubResponse.status : 502 });
    }

    return Response.json(sanitizeHubResponse(hubData, requestId));
  } catch (error) {
    console.error('[appendAdminHubOrderNote] Error:', error.message);
    return Response.json({ error: 'Unable to append Hub internal note' }, { status: 500 });
  }
});
