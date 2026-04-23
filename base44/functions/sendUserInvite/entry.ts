import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    // Admin-only
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { email } = await req.json();
    if (!email) {
      return Response.json({ error: 'Email is required' }, { status: 400 });
    }

    await base44.users.inviteUser(email, 'user');
    console.log(`Invite sent to ${email}`);
    
    return Response.json({ success: true, message: `Invite sent to ${email}` });
  } catch (error) {
    console.error('sendUserInvite error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});