// @ts-nocheck
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * Backward-compatible retirement boundary for older clients that still call
 * syncUserToHub. Customer App profile records are authoritative.
 */
export default async function handler(req: Request) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { email } = body;

    if (!email) {
      return Response.json({ error: 'Missing email' }, { status: 400 });
    }

    const user = await base44.auth.me().catch(() => null);
    if (!user) {
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    }
    if (user.role !== 'admin' && normalizeEmail(user.email) !== normalizeEmail(email)) {
      return Response.json({ error: 'forbidden' }, { status: 403 });
    }

    return Response.json({
      success: true,
      skipped: true,
      retired: true,
      source: 'customer_app_profile_authoritative',
      external_calls_performed: false,
    });
  } catch (error) {
    console.error('syncUserToHub error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
