import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    // Admin-only
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { email, nextUrl } = await req.json();
    if (!email) {
      return Response.json({ error: 'Email is required' }, { status: 400 });
    }

    const url = nextUrl ? await base44.users.inviteUser(email, 'user', nextUrl) : await base44.users.inviteUser(email, 'user');
    console.log(`Invite sent to ${email}${nextUrl ? ` with next URL: ${nextUrl}` : ''}`);
    
    return Response.json({ success: true, message: `Invite sent to ${email}`, invite_url: url });
  } catch (error) {
    console.error('sendUserInvite error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});