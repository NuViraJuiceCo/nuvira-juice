const PAGE_SIZE = 100;
const MAX_ROWS = 5000;

const SNAPSHOT_PLANS = [
  {
    entity: 'POSCustomerClaim',
    fields: [
      'id', 'status', 'source_order_ids', 'source_order_numbers', 'eligible_order_count',
      'eligible_spend', 'pending_points', 'updated_from_source_at', 'email_marketing_status',
      'sms_marketing_status', 'profile_completion_required', 'invitation_status', 'updated_date',
    ],
  },
  {
    entity: 'MarketingConsent',
    fields: [
      'id', 'email_status', 'sms_status', 'email_source', 'sms_source',
      'promotional_email_eligible', 'promotional_sms_eligible', 'last_verified_at', 'updated_date',
    ],
  },
  {
    entity: 'CustomerMessageDeliveryLog',
    fields: [
      'id', 'channel', 'message_type', 'status', 'sent_at', 'delivered_at', 'failed_at',
      'suppressed_at', 'created_date', 'updated_date',
    ],
  },
  {
    entity: 'Notification',
    fields: ['id', 'type', 'notification_subtype', 'is_read', 'created_date', 'updated_date'],
  },
];

function normalizeRows(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function listAll(entity, fields) {
  const rows = [];
  for (let skip = 0; skip < MAX_ROWS; skip += PAGE_SIZE) {
    const page = normalizeRows(await entity.list('id', PAGE_SIZE, skip, fields));
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  if (rows.length === MAX_ROWS) throw new Error(`Snapshot exceeded ${MAX_ROWS} rows.`);
  return rows;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
}

async function sha256(value) {
  const encoded = new TextEncoder().encode(JSON.stringify(stableValue(value)));
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function latest(rows, field) {
  return rows.map((row) => row[field]).filter(Boolean).sort().at(-1) || null;
}

export async function captureSideEffectSnapshot(client) {
  if (!client?.entities) throw new Error('Base44 entity client is required.');
  const entities = [];
  for (const plan of SNAPSHOT_PLANS) {
    const rows = await listAll(client.entities[plan.entity], plan.fields);
    entities.push({
      entity: plan.entity,
      count: rows.length,
      sha256: await sha256(rows),
      latest_created_date: latest(rows, 'created_date'),
      latest_updated_date: latest(rows, 'updated_date'),
    });
  }
  return {
    ok: true,
    read_only: true,
    pii_returned: false,
    captured_at: new Date().toISOString(),
    entities,
  };
}

if (globalThis.base44) {
  console.log(JSON.stringify(await captureSideEffectSnapshot(globalThis.base44), null, 2));
}
