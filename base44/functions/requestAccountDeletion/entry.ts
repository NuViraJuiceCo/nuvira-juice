import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const RETAINED_RECORD_CATEGORIES = [
  'orders',
  'payment_records',
  'refund_records',
  'tax_records',
  'subscription_history',
  'fulfillment_and_delivery_records',
  'food_safety_and_compliance_records',
  'sync_and_audit_logs',
];

type DeleteTarget = {
  entityName: string;
  filters: Array<Record<string, string>>;
};

function normalizeEmail(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function sanitizeSource(value: unknown): string {
  const source = String(value || 'account_settings').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  return source.slice(0, 80) || 'account_settings';
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || 'unknown_error');
  return message.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[redacted-email]').slice(0, 500);
}

async function readJsonBody(req: Request): Promise<Record<string, any> | null> {
  try {
    const body = await req.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  } catch {
    return null;
  }
}

async function resolveIdentityEmails(base44: any, userEmail: string): Promise<string[]> {
  const identities = new Set<string>([userEmail]);
  const userProfiles = await base44.asServiceRole.entities.UserProfile.filter({ customer_email: userEmail }, null, 10);
  const contactProfiles = await base44.asServiceRole.entities.UserProfile.filter({ contact_email: userEmail }, null, 10);

  for (const profile of [...userProfiles, ...contactProfiles]) {
    identities.add(normalizeEmail(profile.customer_email));
    identities.add(normalizeEmail(profile.contact_email));
  }

  return unique(Array.from(identities));
}

async function deleteRecordsForFilter(base44: any, entityName: string, filter: Record<string, string>): Promise<number> {
  const entityApi = base44.asServiceRole.entities[entityName];
  if (!entityApi?.filter || !entityApi?.delete) {
    throw new Error(`entity_api_unavailable:${entityName}`);
  }

  let deleted = 0;
  let page = await entityApi.filter(filter, null, 100);
  while (Array.isArray(page) && page.length > 0) {
    for (const record of page) {
      if (record?.id) {
        await entityApi.delete(record.id);
        deleted += 1;
      }
    }
    page = page.length === 100 ? await entityApi.filter(filter, null, 100) : [];
  }

  return deleted;
}

async function deleteAppOwnedRecords(base44: any, identityEmails: string[]): Promise<Record<string, number>> {
  const targets: DeleteTarget[] = [
    {
      entityName: 'UserProfile',
      filters: identityEmails.flatMap((email) => [
        { customer_email: email },
        { contact_email: email },
      ]),
    },
    {
      entityName: 'NotificationPreference',
      filters: identityEmails.map((email) => ({ customer_email: email })),
    },
    {
      entityName: 'PushSubscription',
      filters: identityEmails.map((email) => ({ customer_email: email })),
    },
    {
      entityName: 'Notification',
      filters: identityEmails.map((email) => ({ customer_email: email })),
    },
    {
      entityName: 'UserPoints',
      filters: identityEmails.map((email) => ({ customer_email: email })),
    },
    {
      entityName: 'LoyaltyMember',
      filters: identityEmails.map((email) => ({ email })),
    },
  ];

  const deletedCounts: Record<string, number> = {};

  for (const target of targets) {
    let entityCount = 0;
    const seenFilters = new Set<string>();
    for (const filter of target.filters) {
      const key = JSON.stringify(filter);
      if (seenFilters.has(key)) continue;
      seenFilters.add(key);
      entityCount += await deleteRecordsForFilter(base44, target.entityName, filter);
    }
    deletedCounts[target.entityName] = entityCount;
  }

  return deletedCounts;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me().catch(() => null);
  if (!user?.email) {
    return Response.json({ error: 'Authentication required' }, { status: 401 });
  }

  const body = await readJsonBody(req);
  if (!body) {
    return Response.json({ error: 'malformed_json' }, { status: 400 });
  }
  if (body.confirm !== 'DELETE') {
    return Response.json({ error: 'confirmation_required' }, { status: 400 });
  }

  const now = new Date().toISOString();
  const requestorEmail = normalizeEmail(user.email);
  let deletionRequest: any = null;

  try {
    const identityEmails = await resolveIdentityEmails(base44, requestorEmail);
    deletionRequest = await base44.asServiceRole.entities.AccountDeletionRequest.create({
      requestor_email: requestorEmail,
      identity_emails: identityEmails,
      requested_at: now,
      status: 'processing',
      source: sanitizeSource(body.source),
      retained_record_categories: RETAINED_RECORD_CATEGORIES,
    });

    const deletedCounts = await deleteAppOwnedRecords(base44, identityEmails);
    const completedAt = new Date().toISOString();
    await base44.asServiceRole.entities.AccountDeletionRequest.update(deletionRequest.id, {
      status: 'completed',
      completed_at: completedAt,
      deleted_counts: deletedCounts,
      retained_record_categories: RETAINED_RECORD_CATEGORIES,
    });

    return Response.json({
      success: true,
      status: 'completed',
      deletion_request_id: deletionRequest.id,
      completed_at: completedAt,
      deleted_counts: deletedCounts,
      retained_record_categories: RETAINED_RECORD_CATEGORIES,
    });
  } catch (error) {
    const failureReason = sanitizeError(error);
    console.error('[requestAccountDeletion] Failed', failureReason);

    if (deletionRequest?.id) {
      await base44.asServiceRole.entities.AccountDeletionRequest.update(deletionRequest.id, {
        status: 'failed',
        failure_reason: failureReason,
        retained_record_categories: RETAINED_RECORD_CATEGORIES,
      }).catch(() => null);
    }

    return Response.json({
      success: false,
      error: 'account_deletion_failed',
      retained_record_categories: RETAINED_RECORD_CATEGORIES,
    }, { status: 500 });
  }
});
