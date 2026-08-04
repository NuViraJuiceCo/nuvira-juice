import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Automation trigger: when Order is created, enroll new customer in loyalty.
 * Delegates to createLoyaltyMember (single source of truth).
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { event, data } = await req.json();

    const customerEmail = data?.customer_email;
    if (!customerEmail) {
      console.log('No customer email found, skipping loyalty enrollment');
      return Response.json({ success: true });
    }

    // Check if already enrolled
    const existing = await base44.asServiceRole.entities.LoyaltyMember.filter({ email: customerEmail });
    if (existing.length > 0) {
      console.log(`Customer ${customerEmail} already enrolled`);
      return Response.json({ success: true });
    }

    const profiles = await base44.asServiceRole.entities.UserProfile.filter({ customer_email: customerEmail }, '-created_date', 5);
    const profile = profiles[0] || {};
    const orderName = String(data?.customer_name || data?.full_name || '').trim();
    const orderNameParts = orderName.split(/\s+/).filter(Boolean);
    const firstName = String(profile?.first_name || orderNameParts[0] || '').trim();
    const lastName = String(profile?.last_name || orderNameParts.slice(1).join(' ') || '').trim();

    // Call centralized enrollment (single source of truth)
    const enrollRes = await base44.functions.invoke('createLoyaltyMember', {
      email: customerEmail,
      first_name: firstName,
      last_name: lastName,
      phone: data?.contact_phone || profile?.phone || null,
    });

    if (!enrollRes.data.success) {
      console.warn(`Enrollment note: ${enrollRes.data.error}`);
    }

    console.log(`New customer ${customerEmail} enrolled via order automation`);
    return Response.json({ success: true });
  } catch (error) {
    console.error('Enrollment automation error:', error);
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
});
