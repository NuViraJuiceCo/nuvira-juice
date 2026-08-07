import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const RESOURCE_LIMITS = {
  product_catalog: 200,
  bag_returns: 300,
  notification_campaigns: 30,
  loyalty_members: 200,
  zone3_reviews: 100,
};

async function readJsonBody(req: Request) {
  try {
    const body = await req.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  } catch {
    return null;
  }
}

function text(value: unknown, maxLength = 180): string | null {
  const normalized = (value ?? '').toString().trim().replace(/\s+/g, ' ');
  if (!normalized) return null;
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1).trim()}...` : normalized;
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function listValue(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function dateValue(value: unknown): string | null {
  return text(value, 80);
}

function sanitizeCartItems(items: unknown): Array<Record<string, unknown>> {
  return listValue(items).slice(0, 20).map((item: any) => ({
    title: text(item?.title, 120),
    quantity: numberValue(item?.quantity),
    price: numberValue(item?.price),
  }));
}

function productRow(row: any) {
  return {
    id: row.id,
    title: text(row.title, 160),
    price: numberValue(row.price),
    category: text(row.category, 80),
    is_available: row.is_available !== false,
    image_url: text(row.image_url, 500),
    sort_order: numberValue(row.sort_order),
  };
}

function bagReturnRow(row: any) {
  return {
    id: row.id,
    customer_email: text(row.customer_email, 180),
    small_bags_requested: numberValue(row.small_bags_requested),
    tote_bags_requested: numberValue(row.tote_bags_requested),
    verification_status: text(row.verification_status, 80),
    created_date: dateValue(row.created_date),
    credit_issued: numberValue(row.credit_issued),
    small_bags_accepted: numberValue(row.small_bags_accepted),
    tote_bags_accepted: numberValue(row.tote_bags_accepted),
    rejection_reason: text(row.rejection_reason, 120),
    driver_notes: text(row.driver_notes, 240),
    verified_by: text(row.verified_by, 160),
  };
}

function campaignRow(row: any) {
  return {
    id: row.id,
    title: text(row.title, 160),
    message: text(row.message, 260),
    audience: text(row.audience, 80),
    notification_type: text(row.notification_type, 80),
    status: text(row.status, 80),
    sent_count: numberValue(row.sent_count),
    sent_at: dateValue(row.sent_at),
    created_date: dateValue(row.created_date),
  };
}

function emailKey(value: unknown): string {
  return (value ?? '').toString().trim().toLowerCase();
}

function profileName(profile: any): string | null {
  return text([profile?.first_name, profile?.last_name].map((part) => text(part, 80)).filter(Boolean).join(' '), 160);
}

function loyaltyMemberRow(row: any, profile: any = null, points: any = null) {
  return {
    id: row.id,
    full_name: text(row.full_name, 160) || profileName(profile),
    email: text(row.email, 180),
    phone: text(row.phone, 80) || text(profile?.phone, 80),
    created_date: dateValue(row.created_date),
    signup_date: dateValue(row.signup_date),
    total_points: numberValue(points?.total_points ?? row.total_points),
    is_active: row.is_active !== false,
  };
}

function zoneReviewRow(row: any) {
  return {
    id: row.id,
    request_number: text(row.request_number, 120),
    request_type: text(row.request_type, 80),
    status: text(row.status, 80),
    customer_name: text(row.customer_name, 160),
    customer_email: text(row.customer_email, 180),
    customer_phone: text(row.customer_phone, 80),
    delivery_address: text(row.delivery_address, 260),
    estimated_distance_miles: numberValue(row.estimated_distance_miles),
    estimated_drive_time_minutes: numberValue(row.estimated_drive_time_minutes),
    zone_name: text(row.zone_name, 120),
    zone_key: text(row.zone_key, 80),
    estimated_delivery_fee: numberValue(row.estimated_delivery_fee),
    selected_plan_name: text(row.selected_plan_name, 160),
    selected_plan_price: numberValue(row.selected_plan_price),
    selected_plan_frequency: text(row.selected_plan_frequency, 80),
    cart_subtotal: numberValue(row.cart_subtotal),
    amount_authorized: numberValue(row.amount_authorized),
    amount_capturable: row.amount_capturable == null ? null : numberValue(row.amount_capturable),
    estimated_total: numberValue(row.estimated_total),
    authorization_expires_at: dateValue(row.authorization_expires_at),
    created_date: dateValue(row.created_date),
    cart_items: sanitizeCartItems(row.cart_items),
    approved_by: text(row.approved_by, 160),
    created_order_number: text(row.created_order_number, 120),
    denied_by: text(row.denied_by, 160),
    admin_decision_reason: text(row.admin_decision_reason, 260),
    provider_ids_hidden: true,
  };
}

async function readRows(base44: any, resource: keyof typeof RESOURCE_LIMITS) {
  switch (resource) {
    case 'product_catalog':
      return (await base44.asServiceRole.entities.Product.list('sort_order', RESOURCE_LIMITS[resource])).map(productRow);
    case 'bag_returns':
      return (await base44.asServiceRole.entities.BagReturn.list('-created_date', RESOURCE_LIMITS[resource])).map(bagReturnRow);
    case 'notification_campaigns':
      return (await base44.asServiceRole.entities.NotificationCampaign.list('-created_date', RESOURCE_LIMITS[resource])).map(campaignRow);
    case 'loyalty_members': {
      const [members, profiles, pointsAccounts] = await Promise.all([
        base44.asServiceRole.entities.LoyaltyMember.filter({}, 'created_date', RESOURCE_LIMITS[resource]),
        base44.asServiceRole.entities.UserProfile.filter({}, '-created_date', RESOURCE_LIMITS[resource]),
        base44.asServiceRole.entities.UserPoints.filter({}, '-created_date', RESOURCE_LIMITS[resource]),
      ]);
      const profilesByEmail = new Map<string, any>();
      const pointsByEmail = new Map<string, any>();
      for (const profile of profiles) {
        const keys = [emailKey(profile?.customer_email), emailKey(profile?.contact_email)].filter(Boolean);
        for (const key of keys) {
          const current = profilesByEmail.get(key);
          if (!current || (!profileName(current) && profileName(profile))) profilesByEmail.set(key, profile);
        }
      }
      for (const points of pointsAccounts) {
        const key = emailKey(points?.customer_email);
        if (key && !pointsByEmail.has(key)) pointsByEmail.set(key, points);
      }
      return members.map((member: any) => {
        const key = emailKey(member?.email);
        return loyaltyMemberRow(member, profilesByEmail.get(key), pointsByEmail.get(key));
      });
    }
    case 'zone3_reviews':
      return (await base44.asServiceRole.entities.DeliveryApprovalRequest.list('-created_date', RESOURCE_LIMITS[resource])).map(zoneReviewRow);
    default:
      return [];
  }
}

export async function handleAdminDataSummary(req: Request) {
  if (req.method !== 'POST') {
    return Response.json({ error: 'method_not_allowed' }, { status: 405 });
  }

  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await readJsonBody(req);
    if (body === null) {
      return Response.json({ success: false, error: 'malformed_json' }, { status: 400 });
    }
    const resource = text(body?.resource, 80) as keyof typeof RESOURCE_LIMITS;
    if (!resource || !(resource in RESOURCE_LIMITS)) {
      return Response.json({ error: 'unsupported_resource' }, { status: 400 });
    }

    const rows = await readRows(base44, resource);
    return Response.json({
      success: true,
      resource,
      count: rows.length,
      rows,
      read_only: true,
      mutations_enabled: false,
      redaction_applied: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load admin summary.';
    return Response.json({ error: text(message, 180) || 'admin_summary_failed' }, { status: 500 });
  }
}
