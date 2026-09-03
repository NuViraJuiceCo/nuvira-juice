// @ts-nocheck
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function normalizeEmail(value: unknown) {
  return String(value || '').trim().toLowerCase();
}
function normalizeText(value: unknown, maxLength: number) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function isValidGuestSecret(value: unknown) {
  const normalized = String(value || '').trim();
  return normalized.length >= 24 && normalized.length <= 180 && /^[A-Za-z0-9._:-]+$/.test(normalized);
}

async function sha256Hex(value: unknown) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value || '')));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(left: unknown, right: unknown) {
  const a = String(left || '');
  const b = String(right || '');
  if (!a || a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return mismatch === 0;
}

async function verifyGuestPurchaseClaim(base44: any, body: any, contactEmail: string) {
  const orderNumber = normalizeText(body.guest_order_number, 120).toUpperCase();
  const guestToken = normalizeText(body.guest_order_token, 180);
  if (!orderNumber && !guestToken) return { attempted: false, order: null };
  if (!/^NV-[A-Z0-9-]{3,64}$/.test(orderNumber) || !isValidGuestSecret(guestToken)) {
    return { attempted: true, error: 'Guest purchase verification is invalid or expired', status: 403 };
  }

  const checkoutSessions = await base44.asServiceRole.entities.CheckoutSession.filter(
    { order_number: orderNumber },
    '-created_date',
    5,
  );
  const expectedHash = await sha256Hex(guestToken);
  const now = Date.now();
  const tokenMatches = checkoutSessions.some((row: any) => (
    row?.checkout_data?.guest_checkout === true
      && Number.isFinite(Date.parse(String(row?.expires_at || '')))
      && Date.parse(String(row.expires_at)) > now
      && constantTimeEqual(row?.checkout_data?.guest_order_token_hash, expectedHash)
  ));
  if (!tokenMatches) return { attempted: true, error: 'Guest purchase verification is invalid or expired', status: 403 };

  const orders = await base44.asServiceRole.entities.Order.filter({ order_number: orderNumber }, '-created_date', 3);
  const order = orders.find((candidate: any) => (
    normalizeEmail(candidate?.customer_email) === contactEmail
      && (candidate?.payment_captured === true || ['paid', 'captured'].includes(String(candidate?.payment_status || '').toLowerCase()))
      && candidate?.is_test_order !== true
  ));
  if (!order) return { attempted: true, error: 'No eligible paid guest purchase was found for this email', status: 403 };
  return { attempted: true, order };
}

export default async function handler(req: Request) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return Response.json({ error: 'Invalid request' }, { status: 400 });
    }

    const authenticatedEmail = normalizeEmail(user.email);
    const requestedEmail = normalizeEmail(body.email);
    const firstName = normalizeText(body.first_name, 100);
    const lastName = normalizeText(body.last_name, 100);
    const phone = normalizeText(body.phone, 40);
    const address = normalizeText(body.address, 500);
    const birthday = normalizeText(body.birthday, 10);

    if (!authenticatedEmail || !requestedEmail || !firstName || !lastName || !phone) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (requestedEmail !== authenticatedEmail) {
      return Response.json({ error: 'Cannot update another customer profile' }, { status: 403 });
    }

    if (birthday && !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) {
      return Response.json({ error: 'Invalid birthday' }, { status: 400 });
    }

    const usesAppleRelay = authenticatedEmail.endsWith('@privaterelay.appleid.com');
    const requestedContactEmail = normalizeEmail(body.contact_email);
    if (usesAppleRelay && (!requestedContactEmail || !requestedContactEmail.includes('@'))) {
      return Response.json({ error: 'A contact email is required' }, { status: 400 });
    }

    const contactEmail = usesAppleRelay ? requestedContactEmail : authenticatedEmail;
    const loyaltyEmail = contactEmail;
    const guestPurchaseClaim = await verifyGuestPurchaseClaim(base44, body, contactEmail);
    if (guestPurchaseClaim.error) {
      return Response.json({ error: guestPurchaseClaim.error }, { status: guestPurchaseClaim.status });
    }
    const optionalProfileFields = {
      ...(address ? { address } : {}),
      ...(birthday ? { birthday } : {}),
    };

    try {
      await base44.auth.updateMe({
        first_name: firstName,
        last_name: lastName,
        phone,
        ...optionalProfileFields,
      });
    } catch {
      console.warn('[completeAccountSetup] user_projection_update_failed');
    }

    const existingProfiles = await base44.asServiceRole.entities.UserProfile.filter(
      { customer_email: authenticatedEmail },
      '-updated_date',
      2,
    );
    const profileData = {
      first_name: firstName,
      last_name: lastName,
      contact_email: contactEmail,
      phone,
      ...optionalProfileFields,
      onboarding_complete: true,
    };

    if (existingProfiles[0]) {
      await base44.asServiceRole.entities.UserProfile.update(existingProfiles[0].id, profileData);
    } else {
      await base44.asServiceRole.entities.UserProfile.create({
        customer_email: authenticatedEmail,
        ...profileData,
      });
    }

    let loyaltyStatus = 'active';
    try {
      const existingMembers = await base44.asServiceRole.entities.LoyaltyMember.filter(
        { email: loyaltyEmail },
        '-updated_date',
        1,
      );

      if (!existingMembers[0]) {
        const enrollmentResponse = await base44.functions.invoke('createLoyaltyMember', {
          email: loyaltyEmail,
          auth_email: authenticatedEmail,
          first_name: firstName,
          last_name: lastName,
          phone,
          address: address || null,
          birthday: birthday || null,
        });
        const enrollmentResult = enrollmentResponse?.data || enrollmentResponse;
        if (enrollmentResult?.success !== true && enrollmentResult?.existing !== true) {
          loyaltyStatus = 'pending_retry';
          console.warn('[completeAccountSetup] loyalty_enrollment_pending');
        }
      }
    } catch {
      loyaltyStatus = 'pending_retry';
      console.warn('[completeAccountSetup] loyalty_enrollment_pending');
    }

    return Response.json({
      success: true,
      loyalty_status: loyaltyStatus,
      guest_purchase_claimed: Boolean(guestPurchaseClaim.order),
      claimed_order_number: guestPurchaseClaim.order?.order_number || null,
      message: loyaltyStatus === 'active'
        ? 'Account setup complete'
        : 'Account setup complete; rewards enrollment is pending',
    });
  } catch {
    console.error('[completeAccountSetup] setup_failed');
    return Response.json({ error: 'Unable to complete setup' }, { status: 500 });
  }
}
