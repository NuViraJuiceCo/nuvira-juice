const APPLY_CHANGES = false;
const EMIT_ROLLBACK_BACKUP = false;

const MAX_EXPECTED_LEGACY_RECORDS = 201;
const PAGE_LIMIT = 500;
const MAX_COLLECTION_ROWS = 5000;
const LEGACY_TEXT = /may[ _-]?30/i;

const ENTITY_PLANS = [
  {
    entityName: 'ShopifyOrder',
    fields: ['id', 'sync_status', 'tags', 'internal_notes', 'audit_trail'],
    statuses: ['native_may30_ready', 'native_may30_refunded'],
  },
  {
    entityName: 'FulfillmentTask',
    fields: ['id', 'sync_status', 'task_source', 'schedule_source', 'notes', 'audit_trail'],
    statuses: ['native_may30_ready'],
  },
  {
    entityName: 'OrderReviewQueue',
    fields: [
      'id', 'incident_type', 'incoming_source', 'issue_description', 'recommended_action',
      'admin_notes', 'status', 'resolved_action', 'idempotency_key', 'queue_visibility_status',
      'existing_order_id', 'existing_order_number', 'archived_at', 'archived_by', 'archived_reason',
    ],
    statuses: [],
  },
];

export function normalizeLegacyString(value) {
  if (typeof value !== 'string' || !LEGACY_TEXT.test(value)) return value;
  return value
    .replace(/native_may30_refunded/gi, 'native_ops_refunded')
    .replace(/native_may30_ready/gi, 'native_ops_ready')
    .replace(/may30_native_ops/gi, 'native_order_ops')
    .replace(/processMay30NativeOrderOps/g, 'syncOrderToHub')
    .replace(/native may 30/gi, 'native operations')
    .replace(/may[ _-]?30/gi, 'native_ops');
}

export function normalizeLegacyValue(value) {
  if (typeof value === 'string') return normalizeLegacyString(value);
  if (Array.isArray(value)) return value.map(normalizeLegacyValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, normalizeLegacyValue(entry)]),
    );
  }
  return value;
}

export function containsLegacyText(value) {
  if (typeof value === 'string') return LEGACY_TEXT.test(value);
  if (Array.isArray(value)) return value.some(containsLegacyText);
  if (value && typeof value === 'object') return Object.values(value).some(containsLegacyText);
  return false;
}

export function buildPatch(row, fields) {
  const patch = {};
  for (const field of fields) {
    if (field === 'id' || row[field] === undefined) continue;
    const normalized = normalizeLegacyValue(row[field]);
    if (JSON.stringify(normalized) !== JSON.stringify(row[field])) patch[field] = normalized;
  }
  return patch;
}

export function shouldArchiveLegacyReview(row) {
  return ['pending', 'reviewing'].includes(String(row?.status || '').toLowerCase())
    && !row?.existing_order_id
    && !row?.existing_order_number
    && String(row?.incident_type || '').toLowerCase() === 'missing_customer_info'
    && containsLegacyText(row?.issue_description);
}

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

async function readLegacyRows(entity, plan) {
  const pages = await Promise.all(plan.statuses.map((syncStatus) => (
    entity.filter({ sync_status: syncStatus }, '-created_date', PAGE_LIMIT, 0, plan.fields)
  )));
  const byId = new Map();
  for (const row of pages.flatMap(normalizeRows)) {
    if (row?.id) byId.set(row.id, row);
  }
  return [...byId.values()];
}

async function readAllOperationalRows(entity, fields) {
  const rows = [];
  for (let skip = 0; skip < MAX_COLLECTION_ROWS; skip += PAGE_LIMIT) {
    const page = normalizeRows(await entity.list('id', PAGE_LIMIT, skip, fields));
    rows.push(...page);
    if (page.length < PAGE_LIMIT) return rows;
  }
  throw new Error(`Operational metadata audit exceeded ${MAX_COLLECTION_ROWS} rows.`);
}

function safeBackupRecord(entityName, row, fields) {
  return {
    entity: entityName,
    id: row.id,
    fields: Object.fromEntries(
      fields.filter((field) => field !== 'id' && row[field] !== undefined).map((field) => [field, row[field]]),
    ),
  };
}

export async function runMigration(client) {
  if (!client?.entities) throw new Error('Base44 entity client is required.');

  const preview = [];
  const rollbackRecords = [];
  for (const plan of ENTITY_PLANS) {
    const entity = client.entities[plan.entityName];
    const allRows = await readAllOperationalRows(entity, plan.fields);
    const rows = allRows.filter((row) => plan.fields.some((field) => containsLegacyText(row[field])));
    const legacyStatusRows = await readLegacyRows(entity, plan);
    const updates = rows.map((row) => {
      const patch = buildPatch(row, plan.fields);
      if (plan.entityName === 'OrderReviewQueue' && shouldArchiveLegacyReview(row)) {
        Object.assign(patch, {
          status: 'archived',
          queue_visibility_status: 'archived',
          archived_at: new Date().toISOString(),
          archived_by: 'legacy_native_status_migration',
          archived_reason: 'Obsolete launch-era diagnostic without an order identifier.',
        });
      }
      return { id: row.id, ...patch };
    });
    const emptyPatches = updates.filter((row) => Object.keys(row).length === 1);
    if (emptyPatches.length > 0) {
      throw new Error(`${plan.entityName} contains legacy status rows without a normalizable patch.`);
    }
    preview.push({
      entity: plan.entityName,
      matched: rows.length,
      would_update: updates.length,
      legacy_status_records: legacyStatusRows.length,
      orphaned_active_reviews_to_archive: plan.entityName === 'OrderReviewQueue'
        ? rows.filter(shouldArchiveLegacyReview).length
        : 0,
      legacy_fields: plan.fields.filter((field) => rows.some((row) => containsLegacyText(row[field]))),
      updates,
    });
    rollbackRecords.push(...rows.map((row) => safeBackupRecord(plan.entityName, row, plan.fields)));
  }

  const total = preview.reduce((sum, plan) => sum + plan.matched, 0);
  if (APPLY_CHANGES && total > MAX_EXPECTED_LEGACY_RECORDS) {
    throw new Error(`Refusing to update ${total} records; reviewed maximum is ${MAX_EXPECTED_LEGACY_RECORDS}.`);
  }

  const writeResults = [];
  if (APPLY_CHANGES) {
    for (const plan of preview) {
      if (plan.updates.length === 0) {
        writeResults.push({ entity: plan.entity, updated: 0 });
        continue;
      }
      const result = await client.entities[plan.entity].bulkUpdate(plan.updates);
      const returnedRows = normalizeRows(result);
      const providerReported = Number(
        result?.updated ?? result?.updated_count ?? result?.modified_count ?? returnedRows.length,
      );
      writeResults.push({
        entity: plan.entity,
        requested: plan.updates.length,
        provider_reported: Number.isFinite(providerReported) ? providerReported : null,
      });
    }
  }

  const remaining = [];
  const collectionAudit = [];
  for (const plan of ENTITY_PLANS) {
    const entity = client.entities[plan.entityName];
    if (APPLY_CHANGES) {
      const rows = await readLegacyRows(entity, plan);
      remaining.push({ entity: plan.entityName, legacy_records: rows.length });
    }
    const allRows = await readAllOperationalRows(entity, plan.fields);
    const legacyRows = allRows.filter((row) => plan.fields.some((field) => containsLegacyText(row[field])));
    collectionAudit.push({
      entity: plan.entityName,
      audited_records: allRows.length,
      legacy_records: legacyRows.length,
      legacy_fields: plan.fields.filter((field) => legacyRows.some((row) => containsLegacyText(row[field]))),
    });
  }
  if (APPLY_CHANGES) {
    if (remaining.some((entry) => entry.legacy_records !== 0)) {
      throw new Error(`Post-write reconciliation failed: ${JSON.stringify(remaining)}`);
    }
    if (collectionAudit.some((entry) => entry.legacy_records !== 0)) {
      throw new Error(`Post-write operational metadata audit failed: ${JSON.stringify(collectionAudit)}`);
    }
  }

  const summary = {
    ok: true,
    mode: APPLY_CHANGES ? 'apply' : 'preview',
    legacy_records: total,
    reviewed_maximum: MAX_EXPECTED_LEGACY_RECORDS,
    entities: preview.map(({ entity, matched, would_update, legacy_status_records, orphaned_active_reviews_to_archive, legacy_fields }) => ({
      entity,
      matched,
      would_update,
      legacy_status_records,
      orphaned_active_reviews_to_archive,
      legacy_fields,
    })),
    write_results: writeResults,
    post_write_remaining: remaining,
    operational_metadata_audit: collectionAudit,
    payments_changed: false,
    fulfillment_lifecycle_changed: false,
    production_lifecycle_changed: false,
    loyalty_changed: false,
    inventory_changed: false,
    communications_requested: false,
  };

  if (EMIT_ROLLBACK_BACKUP) {
    summary.rollback_backup = {
      generated_at: new Date().toISOString(),
      record_count: rollbackRecords.length,
      records: rollbackRecords,
    };
  }

  return summary;
}

if (globalThis.base44) {
  console.log(JSON.stringify(await runMigration(globalThis.base44), null, 2));
}
