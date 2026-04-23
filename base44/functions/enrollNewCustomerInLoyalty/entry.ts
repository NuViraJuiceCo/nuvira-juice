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

    // Call centralized enrollment (single source of truth)
    const enrollRes = await base44.functions.invoke('createLoyaltyMember', {
      email: customerEmail,
      first_name: data?.full_name?.split(' ')[0] || 'Customer',
      last_name: data?.full_name?.split(' ').slice(1).join(' ') || '',
      phone: data?.phone,
    });

    if (!enrollRes.data.success) {
      console.warn(`Enrollment note: ${enrollRes.data.error}`);
    }

    console.log(`New customer ${customerEmail} enrolled via order automation`);
    return Response.json({ success: true });
  } catch (error) {
    console.error('Enrollment automation error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});