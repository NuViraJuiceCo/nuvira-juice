const PAGE_SIZE = 100;
const MAX_ROWS = 5000;
const LEGACY_TEXT = /may[ _-]?30/i;

const HISTORY_PLANS = [
  {
    entity: 'OrderSyncLog',
    fields: [
      'id', 'status', 'description', 'triggered_by', 'sync_source', 'event_type', 'action',
      'reason', 'fields_updated', 'fields_rejected', 'error', 'error_code', 'idempotency_key',
      'request_id', 'correlation_id',
    ],
  },
  {
    entity: 'CommandLog',
    fields: [
      'id', 'command_type', 'command_source', 'status', 'target_entity', 'error_code',
      'error_message', 'idempotency_key', 'request_id', 'function_name', 'notes',
    ],
  },
  {
    entity: 'OrderReviewQueue',
    fields: [
      'id', 'incident_type', 'incoming_source', 'issue_description', 'recommended_action',
      'admin_notes', 'status', 'resolved_action', 'idempotency_key', 'queue_visibility_status',
      'archived_at', 'archived_reason', 'existing_order_id', 'existing_order_number',
    ],
  },
  {
    entity: 'SafeSyncParityLog',
    fields: [
      'id', 'sample_id', 'request_id', 'correlation_id', 'source', 'event_type',
      'bridge_action', 'hub_result_status', 'native_parity_status', 'mismatch_categories',
      'warnings', 'logging_mode',
    ],
  },
  {
    entity: 'ShopifySyncLog',
    fields: ['id', 'sync_type', 'description', 'status', 'error_details', 'triggered_by'],
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

function containsLegacyText(value) {
  if (typeof value === 'string') return LEGACY_TEXT.test(value);
  if (Array.isArray(value)) return value.some(containsLegacyText);
  if (value && typeof value === 'object') return Object.values(value).some(containsLegacyText);
  return false;
}

function countBy(rows, field) {
  return Object.fromEntries(
    [...rows.reduce((counts, row) => {
      const key = String(row?.[field] || 'unknown').toLowerCase();
      counts.set(key, (counts.get(key) || 0) + 1);
      return counts;
    }, new Map()).entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
}

async function listAll(entity, fields) {
  const rows = [];
  for (let skip = 0; skip < MAX_ROWS; skip += PAGE_SIZE) {
    const page = normalizeRows(await entity.list('id', PAGE_SIZE, skip, fields));
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
  throw new Error(`Historical log audit exceeded ${MAX_ROWS} rows.`);
}

export async function auditLegacyLogHistory(client) {
  if (!client?.entities) throw new Error('Base44 entity client is required.');
  const entities = [];
  for (const plan of HISTORY_PLANS) {
    const rows = await listAll(client.entities[plan.entity], plan.fields);
    const matchingRows = rows.filter((row) => plan.fields.some((field) => containsLegacyText(row[field])));
    const activeReviewRows = plan.entity === 'OrderReviewQueue'
      ? matchingRows.filter((row) => (
        ['pending', 'reviewing'].includes(String(row.status || '').toLowerCase())
        && String(row.queue_visibility_status || '').toLowerCase() !== 'archived'
        && !row.archived_at
      ))
      : [];
    entities.push({
      entity: plan.entity,
      audited_records: rows.length,
      historical_legacy_records: matchingRows.length,
      historical_fields: plan.fields.filter((field) => matchingRows.some((row) => containsLegacyText(row[field]))),
      historical_statuses: countBy(matchingRows, 'status'),
      active_review_queue_records: plan.entity === 'OrderReviewQueue' ? activeReviewRows.length : null,
      active_review_queue_rows: plan.entity === 'OrderReviewQueue'
        ? activeReviewRows.map((row) => ({
          id: row.id,
          incident_type: row.incident_type || null,
          existing_order_id: row.existing_order_id || null,
          existing_order_number: row.existing_order_number || null,
          issue_description: row.issue_description || null,
          recommended_action: row.recommended_action || null,
        }))
        : [],
    });
  }
  return {
    ok: true,
    read_only: true,
    pii_returned: false,
    active_runtime_owner: false,
    entities,
  };
}

if (globalThis.base44) {
  console.log(JSON.stringify(await auditLegacyLogHistory(globalThis.base44), null, 2));
}
