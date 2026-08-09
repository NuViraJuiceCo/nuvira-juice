import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const DAY_MS = 24 * 60 * 60 * 1000;

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function startOfUtcDay(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function classifyDocument(document: any, today: Date) {
  const rawExpiry = String(document?.expiry_date || '').trim();
  if (!rawExpiry) return { state: String(document?.status || 'Pending'), days_remaining: null };
  const expiry = new Date(`${rawExpiry}T00:00:00.000Z`);
  if (Number.isNaN(expiry.getTime())) return { state: 'Pending', days_remaining: null };
  const daysRemaining = Math.ceil((expiry.getTime() - today.getTime()) / DAY_MS);
  const reminderDays = Number.isFinite(Number(document?.reminder_days))
    ? Math.max(0, Number(document.reminder_days))
    : 30;
  if (daysRemaining < 0) return { state: 'Expired', days_remaining: daysRemaining };
  if (daysRemaining <= reminderDays) return { state: 'Due Soon', days_remaining: daysRemaining };
  return { state: 'Valid', days_remaining: daysRemaining };
}

function buildRows(rows: any[], color: string) {
  return rows.map(row => `<tr><td style="padding:8px 12px;border-bottom:1px solid #eee">${escapeHtml(row.name)}</td><td style="padding:8px 12px;border-bottom:1px solid #eee">${escapeHtml(row.type)}</td><td style="padding:8px 12px;border-bottom:1px solid #eee;color:${color};font-weight:600">${escapeHtml(row.derived_status)}</td><td style="padding:8px 12px;border-bottom:1px solid #eee">${escapeHtml(row.expiry_date || 'Not set')}</td></tr>`).join('');
}

function buildEmail(overdue: any[], dueSoon: any[]) {
  return `<div style="font-family:Inter,Arial,sans-serif;max-width:640px;margin:0 auto;color:#17211b">
    <div style="background:#123c2c;padding:24px">
      <h1 style="color:#fff;font-size:20px;margin:0">NuVira compliance review</h1>
      <p style="color:#d6eadf;margin:8px 0 0">${overdue.length} expired · ${dueSoon.length} due soon</p>
    </div>
    <div style="background:#fff;padding:24px;border:1px solid #dce4df">
      ${overdue.length ? `<h2 style="font-size:16px;color:#b42318">Expired (${overdue.length})</h2><table style="width:100%;border-collapse:collapse;font-size:14px"><tbody>${buildRows(overdue, '#b42318')}</tbody></table>` : ''}
      ${dueSoon.length ? `<h2 style="font-size:16px;color:#b54708;margin-top:24px">Due soon (${dueSoon.length})</h2><table style="width:100%;border-collapse:collapse;font-size:14px"><tbody>${buildRows(dueSoon, '#b54708')}</tbody></table>` : ''}
      <p style="margin-top:24px;font-size:13px;color:#52635a">Review and update these records in the NuVira Customer App Admin Console under Compliance.</p>
    </div>
  </div>`;
}

async function readBody(req: Request) {
  const raw = await req.text();
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

export default async (req: Request) => {
  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (!['admin', 'owner', 'compliance_manager'].includes(user.role)) {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await readBody(req);
    const mode = body?.mode === 'live' ? 'live' : 'dry_run';
    const today = startOfUtcDay(new Date());
    const documents = await base44.asServiceRole.entities.ComplianceDoc.list('-expiry_date', 200);
    const evaluated = documents.map((document: any) => ({
      id: document?.id || null,
      name: document?.name || 'Unnamed document',
      type: document?.type || 'Document',
      expiry_date: document?.expiry_date || null,
      ...classifyDocument(document, today),
    })).map((document: any) => ({ ...document, derived_status: document.state }));
    const overdue = evaluated.filter((document: any) => document.derived_status === 'Expired');
    const dueSoon = evaluated.filter((document: any) => document.derived_status === 'Due Soon');
    const attention = [...overdue, ...dueSoon];

    if (mode !== 'live' || attention.length === 0) {
      return Response.json({
        success: true,
        mode,
        sent: false,
        customer_app_native_authoritative: true,
        hub_operational_dependency: false,
        documents_checked: evaluated.length,
        expired_count: overdue.length,
        due_soon_count: dueSoon.length,
        writes_performed: false,
        provider_calls_performed: false,
      });
    }

    const users = await base44.asServiceRole.entities.User.list('-created_date', 200);
    const recipientEmails = [...new Set(users
      .filter((candidate: any) => ['admin', 'owner', 'compliance_manager'].includes(candidate?.role) && candidate?.email)
      .map((candidate: any) => String(candidate.email).trim().toLowerCase())
      .filter(Boolean))];

    const bodyHtml = buildEmail(overdue, dueSoon);
    let sentCount = 0;
    for (const email of recipientEmails) {
      await base44.asServiceRole.integrations.Core.SendEmail({
        to: email,
        subject: `NuVira compliance review: ${overdue.length} expired, ${dueSoon.length} due soon`,
        body: bodyHtml,
      });
      sentCount += 1;
    }
    console.log(`[ComplianceExpiryMonitor] documents=${evaluated.length}, expired=${overdue.length}, due_soon=${dueSoon.length}, recipients=${sentCount}`);

    return Response.json({
      success: true,
      mode,
      sent: sentCount > 0,
      customer_app_native_authoritative: true,
      hub_operational_dependency: false,
      documents_checked: evaluated.length,
      expired_count: overdue.length,
      due_soon_count: dueSoon.length,
      recipient_count: sentCount,
      writes_performed: false,
      provider_calls_performed: sentCount > 0,
      customer_notifications_sent: false,
      internal_admin_notifications_sent: sentCount,
    });
  } catch {
    console.error('[ComplianceExpiryMonitor] monitor_failed');
    return Response.json({ success: false, error: 'monitor_failed' }, { status: 500 });
  }
};
