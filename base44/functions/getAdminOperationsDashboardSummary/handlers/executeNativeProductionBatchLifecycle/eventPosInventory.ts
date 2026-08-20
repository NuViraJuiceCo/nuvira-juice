// @ts-nocheck

const SHOPIFY_API_VERSION = '2026-07';
const COMMAND_TYPE = 'event_pos_inventory_initialization';
const SOURCE = 'customer_app_native_production_verify';
const EVENT_STOCK_SOURCE = 'event_stock';
const EVENT_STOCK_SYSTEM = 'customer_app_native_event_stock';
const EVENT_STOCK_OWNER = 'native_owned_event_stock';
const EVENT_INVENTORY_MODE = 'verified_event_production';
const COMMAND_LEASE_MS = 15 * 60 * 1000;

function text(value) {
  return (value ?? '').toString().trim();
}

function lower(value) {
  return text(value).toLowerCase();
}

function matchKey(value) {
  return lower(value).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function safeId(value) {
  const valueText = text(value);
  return /^[A-Za-z0-9._:@/#-]{1,220}$/.test(valueText) ? valueText : '';
}

function safeCode(value, fallback = 'event_pos_inventory_sync_failed') {
  const valueText = lower(value).replace(/[^a-z0-9_:-]/g, '_').slice(0, 120);
  return valueText || fallback;
}

function codedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function integerQuantity(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function chicagoDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function shopifyGid(value, resource) {
  const valueText = text(value);
  if (valueText.startsWith(`gid://shopify/${resource}/`)) return valueText;
  if (/^\d+$/.test(valueText)) return `gid://shopify/${resource}/${valueText}`;
  return '';
}

function eventSources(batch) {
  return (Array.isArray(batch?.order_sources) ? batch.order_sources : [])
    .filter(source => lower(source?.source_type) === EVENT_STOCK_SOURCE);
}

function nonEventSources(batch) {
  return (Array.isArray(batch?.order_sources) ? batch.order_sources : [])
    .filter(source => lower(source?.source_type) !== EVENT_STOCK_SOURCE);
}

export function eventPosInventoryEligibility(batch) {
  const sources = eventSources(batch);
  const sourceSystem = lower(batch?.source_system);
  const ownerStatus = lower(batch?.native_owner_status);
  const eventStockMarked = sources.length > 0 || (
    sourceSystem === EVENT_STOCK_SYSTEM && ownerStatus === EVENT_STOCK_OWNER
  );
  if (!eventStockMarked) return { applicable: false, reason: 'not_event_stock' };
  if (batch?.is_test_batch === true) return { applicable: false, reason: 'test_batch_excluded' };
  if (nonEventSources(batch).length > 0) {
    return { applicable: true, ready: false, blocker: 'mixed_event_and_customer_demand_requires_allocation' };
  }
  if (sources.length === 0) {
    return { applicable: true, ready: false, blocker: 'event_stock_source_missing' };
  }
  const eventIds = [...new Set(sources.map(source => safeId(source?.order_id)).filter(Boolean))];
  if (eventIds.length !== 1) {
    return { applicable: true, ready: false, blocker: 'single_event_link_required' };
  }
  const quantity = integerQuantity(batch?.final_usable_quantity);
  if (quantity === null) {
    return { applicable: true, ready: false, blocker: 'verified_final_usable_quantity_required' };
  }
  return { applicable: true, ready: true, event_id: eventIds[0], quantity };
}

function shopifyHost() {
  return text(Deno.env.get('SHOPIFY_STORE_URL'))
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/\/+$/, '');
}

async function shopifyAccessToken(host, provider) {
  const clientId = text(Deno.env.get('SHOPIFY_CLIENT_ID'));
  const secretNames = [
    'SHOPIFY_CLIENT_SECRET',
    'SHOPIFY_API_SECRET_KEY',
    'SHOPIFY_API_SECRET',
    'SHOPIFY_APP_SECRET',
    'SHOPIFY_SHARED_SECRET',
  ];
  const seenSecrets = new Set();
  if (clientId) {
    for (const name of secretNames) {
      const clientSecret = text(Deno.env.get(name));
      if (!clientSecret || seenSecrets.has(clientSecret)) continue;
      seenSecrets.add(clientSecret);
      provider.calls += 1;
      const response = await fetch(`https://${host}/admin/oauth/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' }),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok && payload?.access_token) return text(payload.access_token);
    }
  }
  return text(Deno.env.get('SHOPIFY_API_TOKEN'));
}

async function shopifyGraphql(query, variables, provider, { mutating = false } = {}) {
  const host = shopifyHost();
  if (provider.host !== host) {
    provider.host = host;
    provider.token = '';
  }
  const token = host
    ? provider.token || await shopifyAccessToken(host, provider)
    : '';
  if (!host || !token) throw codedError('shopify_inventory_credentials_missing');
  provider.token = token;
  provider.calls += 1;
  if (mutating) provider.writes += 1;
  const response = await fetch(`https://${host}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || (Array.isArray(payload?.errors) && payload.errors.length > 0)) {
    throw codedError('shopify_graphql_request_failed');
  }
  return payload?.data || {};
}

function providerResult(payload, field, errorCode) {
  const result = payload?.[field] || null;
  if (!result) throw codedError(errorCode);
  if (Array.isArray(result.userErrors) && result.userErrors.length > 0) throw codedError(errorCode);
  return result;
}

function availableQuantity(level) {
  const available = (Array.isArray(level?.quantities) ? level.quantities : [])
    .find(quantity => lower(quantity?.name) === 'available');
  const parsed = Number(available?.quantity);
  return Number.isInteger(parsed) ? parsed : null;
}

async function updateBatchSync(base44, batchId, patch) {
  if (!batchId) return null;
  return base44.asServiceRole.entities.ProductionBatch.update(batchId, patch).catch(() => null);
}

async function blockBatchSync(base44, batch, code) {
  const blocker = safeCode(code);
  await updateBatchSync(base44, batch?.id, {
    shopify_pos_inventory_sync_status: 'blocked',
    shopify_pos_inventory_sync_error: blocker,
  });
  return {
    applicable: true,
    success: false,
    status: 'blocked',
    error_code: blocker,
    provider_calls_performed: false,
    inventory_mutation: false,
    customer_notifications_sent: false,
  };
}

function commandExpired(command) {
  const started = Date.parse(command?.started_at || command?.submitted_at || command?.created_date || '');
  return Number.isFinite(started) && Date.now() - started > COMMAND_LEASE_MS;
}

async function claimCommand({ base44, batch, event, requestId, user, quantity }) {
  const idempotencyKey = `${COMMAND_TYPE}:${safeId(event.id)}:${safeId(batch.id)}`;
  const existingRows = await base44.asServiceRole.entities.CommandLog
    .filter({ idempotency_key: idempotencyKey }, '-created_date', 2)
    .catch(() => []);
  if (existingRows.length > 1) throw codedError('duplicate_event_pos_inventory_commands');
  const existing = existingRows[0] || null;
  if (lower(existing?.status) === 'success') {
    return { state: 'success', command: existing, idempotencyKey };
  }
  if (['pending', 'running'].includes(lower(existing?.status)) && !commandExpired(existing)) {
    return { state: 'running', command: existing, idempotencyKey };
  }
  const now = new Date().toISOString();
  const payload = {
    command_type: COMMAND_TYPE,
    command_source: SOURCE,
    status: 'running',
    target_entity: 'ProductionBatch',
    target_id: batch.id,
    target_display_id: safeId(batch.batch_id) || safeId(batch.id),
    actor_email: text(user?.email).slice(0, 180) || null,
    actor_role: text(user?.role).slice(0, 80) || null,
    actor_type: 'authenticated_admin',
    payload: {
      event_id: safeId(event.id),
      event_date: text(event.date).slice(0, 40),
      product_name: text(batch.product_name).slice(0, 120),
      verified_final_usable_quantity: quantity,
      inventory_policy: EVENT_INVENTORY_MODE,
    },
    result: {
      provider_write_completed: false,
      native_projection_completed: false,
      customer_notifications_sent: false,
    },
    idempotency_key: idempotencyKey,
    idempotent_skipped: false,
    request_id: safeId(requestId) || null,
    submitted_at: existing?.submitted_at || now,
    started_at: now,
    completed_at: null,
    error_code: null,
    error_message: null,
    function_name: 'executeNativeProductionBatchLifecycle',
    notes: 'Verified event-only production initializes one dedicated Shopify POS location. Customer notifications and general food inventory records are not changed.',
  };
  if (existing?.id) {
    const command = await base44.asServiceRole.entities.CommandLog.update(existing.id, payload);
    return { state: 'claimed', command, idempotencyKey };
  }
  const command = await base44.asServiceRole.entities.CommandLog.create(payload);
  return { state: 'claimed', command, idempotencyKey };
}

async function failCommand({ base44, commandId, batch, code, provider }) {
  const errorCode = safeCode(code);
  const now = new Date().toISOString();
  await Promise.all([
    commandId ? base44.asServiceRole.entities.CommandLog.update(commandId, {
      status: 'failed',
      completed_at: now,
      error_code: errorCode,
      error_message: 'Event POS inventory initialization requires review',
      result: {
        provider_write_completed: provider.writes > 0,
        native_projection_completed: false,
        customer_notifications_sent: false,
      },
    }).catch(() => null) : null,
    updateBatchSync(base44, batch?.id, {
      shopify_pos_inventory_sync_status: 'error',
      shopify_pos_inventory_sync_error: errorCode,
      ...(commandId ? { shopify_pos_inventory_command_id: commandId } : {}),
    }),
  ]);
  return {
    applicable: true,
    success: false,
    status: 'error',
    error_code: errorCode,
    provider_calls_performed: provider.calls > 0,
    inventory_mutation: provider.writes > 0,
    customer_notifications_sent: false,
  };
}

async function loadProduct(base44, title) {
  const products = await base44.asServiceRole.entities.Product.list('sort_order', 250).catch(() => []);
  const matches = products.filter(product => matchKey(product?.title) === matchKey(title));
  if (matches.length !== 1) throw codedError('single_customer_app_product_match_required');
  return matches[0];
}

async function loadBatch(base44, key) {
  const safeKey = safeId(key);
  if (!safeKey) return null;
  const byId = await base44.asServiceRole.entities.ProductionBatch
    .filter({ id: safeKey }, '-created_date', 2)
    .catch(() => []);
  if (byId.length === 1) return byId[0];
  const byBatchId = await base44.asServiceRole.entities.ProductionBatch
    .filter({ batch_id: safeKey }, '-created_date', 2)
    .catch(() => []);
  return byBatchId.length === 1 ? byBatchId[0] : null;
}

async function ensureSingleEventProductBatch(base44, batch, eventId) {
  const rows = await base44.asServiceRole.entities.ProductionBatch
    .filter({ production_date: batch.production_date, product_name: batch.product_name }, '-created_date', 50)
    .catch(() => []);
  const sameEvent = rows.filter(row => eventSources(row).some(source => safeId(source?.order_id) === eventId));
  if (sameEvent.length !== 1 || sameEvent[0]?.id !== batch.id) {
    throw codedError('single_event_product_batch_required');
  }
}

async function readTarget({ product, locationId, provider }) {
  const productId = shopifyGid(product.shopify_pos_product_id || product.shopify_product_id, 'Product');
  const variantId = shopifyGid(product.shopify_pos_variant_id || product.shopify_variant_id, 'ProductVariant');
  if (!productId || !variantId) throw codedError('verified_shopify_pos_product_mapping_required');
  const data = await shopifyGraphql(`query EventPosInventoryTarget($productId: ID!, $variantId: ID!, $locationId: ID!) {
    product(id: $productId) { id title handle status }
    productVariant(id: $variantId) {
      id
      inventoryPolicy
      product { id title handle status }
      inventoryItem {
        id tracked
        inventoryLevels(first: 50) {
          nodes { location { id name isActive fulfillsOnlineOrders } quantities(names: ["available"]) { name quantity } }
        }
      }
    }
    location(id: $locationId) { id name isActive fulfillsOnlineOrders fulfillmentService { id } }
  }`, { productId, variantId, locationId }, provider);
  const variant = data?.productVariant;
  const shopifyProduct = data?.product;
  if (!variant?.id || !variant?.inventoryItem?.id || !shopifyProduct?.id) throw codedError('shopify_pos_product_mapping_not_found');
  if (variant?.product?.id !== productId || variant?.product?.id !== shopifyProduct?.id) throw codedError('shopify_pos_variant_product_mismatch');
  if (matchKey(shopifyProduct?.title) !== matchKey(product?.title)) throw codedError('shopify_pos_product_title_mismatch');
  if (lower(shopifyProduct?.status) !== 'active') throw codedError('shopify_pos_product_not_active');
  const location = data?.location;
  if (!location?.id || location.id !== locationId || location?.isActive === false) throw codedError('shopify_event_location_unavailable');
  const level = (Array.isArray(variant.inventoryItem.inventoryLevels?.nodes) ? variant.inventoryItem.inventoryLevels.nodes : [])
    .find(row => row?.location?.id === locationId) || null;
  return { productId, variantId, shopifyProduct, variant, inventoryItem: variant.inventoryItem, location, level };
}

async function readShopifyScopes(provider) {
  const data = await shopifyGraphql(`query EventPosInventoryScopes {
    currentAppInstallation { accessScopes { handle } }
  }`, {}, provider);
  return new Set((Array.isArray(data?.currentAppInstallation?.accessScopes)
    ? data.currentAppInstallation.accessScopes
    : []).map(scope => lower(scope?.handle)).filter(Boolean));
}

export async function previewEventPosInventoryReadiness({ base44, eventId, batchKeys }) {
  const provider = { calls: 0, writes: 0, host: '', token: '' };
  const blockers = [];
  const warnings = [];
  const rows = [];
  const safeEventId = safeId(eventId);
  const requestedBatchKeys = [...new Set((Array.isArray(batchKeys) ? batchKeys : [])
    .map(safeId).filter(Boolean))].slice(0, 20);
  if (!safeEventId) blockers.push('event_id_required');
  if (requestedBatchKeys.length === 0) blockers.push('production_batch_ids_required');
  if (blockers.length > 0) {
    return { success: false, ready: false, blockers, warnings, rows, provider_calls_performed: false, provider_writes_performed: false };
  }

  const eventRows = await base44.asServiceRole.entities.Event
    .filter({ id: safeEventId }, '-created_date', 2)
    .catch(() => []);
  if (eventRows.length !== 1) blockers.push('single_event_record_required');
  const event = eventRows[0] || null;
  if (event?.shopify_pos_inventory_sync_enabled !== true) blockers.push('event_pos_inventory_sync_not_enabled');
  if (lower(event?.shopify_pos_inventory_mode) !== EVENT_INVENTORY_MODE) blockers.push('event_pos_inventory_mode_invalid');
  const locationId = shopifyGid(event?.shopify_pos_location_id, 'Location');
  if (!locationId) blockers.push('event_shopify_pos_location_required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text(event?.date)) || text(event?.date) <= chicagoDate()) {
    blockers.push('event_pos_inventory_requires_future_event_date');
  }
  if (blockers.length > 0) {
    return { success: false, ready: false, blockers: [...new Set(blockers)], warnings, rows, provider_calls_performed: false, provider_writes_performed: false };
  }

  try {
    const scopes = await readShopifyScopes(provider);
    if (!scopes.has('write_inventory')) blockers.push('shopify_write_inventory_scope_required');
    if (!scopes.has('write_products')) blockers.push('shopify_write_products_scope_required');
    const canIsolateLocation = scopes.has('write_locations') || scopes.has('write_fulfillments');

    for (const batchKey of requestedBatchKeys) {
      const batch = await loadBatch(base44, batchKey);
      if (!batch) {
        rows.push({ batch_key: batchKey, ready: false, blockers: ['production_batch_not_found'] });
        blockers.push('production_batch_not_found');
        continue;
      }
      const sourceRows = eventSources(batch);
      const rowBlockers = [];
      const rowWarnings = [];
      if (batch?.is_test_batch === true) rowBlockers.push('test_batch_excluded');
      if (lower(batch?.source_system) !== EVENT_STOCK_SYSTEM || lower(batch?.native_owner_status) !== EVENT_STOCK_OWNER) {
        rowBlockers.push('event_stock_provenance_required');
      }
      if (nonEventSources(batch).length > 0) rowBlockers.push('mixed_event_and_customer_demand_requires_allocation');
      const linkedEventIds = [...new Set(sourceRows.map(source => safeId(source?.order_id)).filter(Boolean))];
      if (linkedEventIds.length !== 1 || linkedEventIds[0] !== safeEventId) rowBlockers.push('batch_event_link_mismatch');

      let product = null;
      let target = null;
      if (rowBlockers.length === 0) {
        await ensureSingleEventProductBatch(base44, batch, safeEventId);
        product = await loadProduct(base44, batch.product_name);
        target = await readTarget({ product, locationId, provider });
        if (target.location?.fulfillmentService?.id) rowBlockers.push('shopify_fulfillment_service_location_not_allowed');
        if (target.location?.fulfillsOnlineOrders === true) {
          rowWarnings.push('online_fulfillment_will_be_disabled_on_first_sync');
          if (!canIsolateLocation) rowBlockers.push('shopify_location_isolation_scope_required');
        }
        if (lower(target.variant?.inventoryPolicy) !== 'continue') rowWarnings.push('online_inventory_policy_will_change_to_continue');
        if (target.inventoryItem?.tracked !== true) rowWarnings.push('inventory_tracking_will_be_enabled');
        const current = availableQuantity(target.level);
        if (target.level && current !== 0) rowBlockers.push('shopify_event_location_inventory_changed');
      }
      blockers.push(...rowBlockers);
      warnings.push(...rowWarnings);
      rows.push({
        production_batch_id: safeId(batch.id),
        batch_id: safeId(batch.batch_id),
        product_name: text(batch.product_name).slice(0, 120),
        planned_quantity: integerQuantity(batch.planned_units),
        ready: rowBlockers.length === 0,
        blockers: rowBlockers,
        warnings: rowWarnings,
        current_event_quantity: target?.level ? availableQuantity(target.level) : 0,
        location_name: text(target?.location?.name).slice(0, 160) || text(event.shopify_pos_location_name).slice(0, 160) || null,
      });
    }
  } catch (error) {
    blockers.push(safeCode(error?.code || error?.message));
  }

  return {
    success: blockers.length === 0,
    ready: blockers.length === 0 && rows.length === requestedBatchKeys.length && rows.every(row => row.ready === true),
    event_id: safeEventId,
    event_name: text(event?.title || event?.name).slice(0, 160) || null,
    event_date: text(event?.date).slice(0, 40) || null,
    location_name: text(event?.shopify_pos_location_name).slice(0, 160) || null,
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
    rows,
    provider_calls_performed: provider.calls > 0,
    provider_writes_performed: provider.writes > 0,
    customer_notifications_sent: false,
  };
}

async function ensureLocationIsPosOnly(target, provider) {
  if (target.location?.fulfillmentService?.id) throw codedError('shopify_fulfillment_service_location_not_allowed');
  if (target.location?.fulfillsOnlineOrders !== true) return target.location;
  const data = await shopifyGraphql(`mutation IsolateEventPosLocation($id: ID!, $input: LocationEditInput!) {
    locationEdit(id: $id, input: $input) {
      location { id name isActive fulfillsOnlineOrders fulfillmentService { id } }
      userErrors { code field message }
    }
  }`, { id: target.location.id, input: { fulfillsOnlineOrders: false } }, provider, { mutating: true });
  const result = providerResult(data, 'locationEdit', 'shopify_event_location_isolation_failed');
  if (result.location?.fulfillsOnlineOrders !== false) throw codedError('shopify_event_location_not_isolated');
  return result.location;
}

async function ensureDemandBasedOnlinePolicy(target, provider) {
  if (lower(target.variant?.inventoryPolicy) === 'continue') return;
  const data = await shopifyGraphql(`mutation PreserveDemandBasedOnlineSales($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id inventoryPolicy }
      userErrors { code field message }
    }
  }`, {
    productId: target.productId,
    variants: [{ id: target.variantId, inventoryPolicy: 'CONTINUE' }],
  }, provider, { mutating: true });
  const result = providerResult(data, 'productVariantsBulkUpdate', 'shopify_inventory_policy_update_failed');
  const updated = (Array.isArray(result.productVariants) ? result.productVariants : [])
    .find(variant => variant?.id === target.variantId);
  if (lower(updated?.inventoryPolicy) !== 'continue') throw codedError('shopify_inventory_policy_not_confirmed');
}

async function ensureTracking(target, provider) {
  if (target.inventoryItem?.tracked === true) return;
  const data = await shopifyGraphql(`mutation TrackVerifiedEventInventory($id: ID!, $input: InventoryItemInput!) {
    inventoryItemUpdate(id: $id, input: $input) {
      inventoryItem { id tracked }
      userErrors { code field message }
    }
  }`, { id: target.inventoryItem.id, input: { tracked: true } }, provider, { mutating: true });
  const result = providerResult(data, 'inventoryItemUpdate', 'shopify_inventory_tracking_failed');
  if (result.inventoryItem?.tracked !== true) throw codedError('shopify_inventory_tracking_not_confirmed');
}

async function readInventoryLevel(inventoryItemId, locationId, provider) {
  const data = await shopifyGraphql(`query EventPosInventoryLevel($inventoryItemId: ID!) {
    inventoryItem(id: $inventoryItemId) {
      id tracked
      inventoryLevels(first: 50) {
        nodes { location { id name } quantities(names: ["available"]) { name quantity } }
      }
    }
  }`, { inventoryItemId }, provider);
  if (data?.inventoryItem?.tracked !== true) throw codedError('shopify_inventory_tracking_readback_failed');
  return (Array.isArray(data?.inventoryItem?.inventoryLevels?.nodes) ? data.inventoryItem.inventoryLevels.nodes : [])
    .find(level => level?.location?.id === locationId) || null;
}

async function initializeQuantity({ target, quantity, providerIdempotencyKey, provider }) {
  let level = await readInventoryLevel(target.inventoryItem.id, target.location.id, provider);
  const currentQuantity = availableQuantity(level);
  if (level && currentQuantity === quantity) return { quantity, already_applied: true };
  if (level && currentQuantity !== 0) throw codedError('shopify_event_location_inventory_changed');
  if (!level) {
    const data = await shopifyGraphql(`mutation ActivateVerifiedEventInventory($inventoryItemId: ID!, $locationId: ID!, $available: Int!) {
      inventoryActivate(inventoryItemId: $inventoryItemId, locationId: $locationId, available: $available) {
        inventoryLevel { id quantities(names: ["available"]) { name quantity } }
        userErrors { field message }
      }
    }`, {
      inventoryItemId: target.inventoryItem.id,
      locationId: target.location.id,
      available: quantity,
    }, provider, { mutating: true });
    const result = providerResult(data, 'inventoryActivate', 'shopify_event_inventory_activation_failed');
    if (availableQuantity(result.inventoryLevel) !== quantity) throw codedError('shopify_event_inventory_activation_readback_failed');
    return { quantity, already_applied: false };
  }
  const data = await shopifyGraphql(`mutation SetVerifiedEventInventory($input: InventorySetQuantitiesInput!, $idempotencyKey: String!) {
    inventorySetQuantities(input: $input) @idempotent(key: $idempotencyKey) {
      inventoryAdjustmentGroup { createdAt reason referenceDocumentUri changes { name delta } }
      userErrors { code field message }
    }
  }`, {
    idempotencyKey: providerIdempotencyKey,
    input: {
      name: 'available',
      reason: 'correction',
      referenceDocumentUri: `gid://nuvira/EventProductionBatch/${safeId(target.batchId) || 'verified'}`,
      quantities: [{
        inventoryItemId: target.inventoryItem.id,
        locationId: target.location.id,
        quantity,
        compareQuantity: 0,
      }],
    },
  }, provider, { mutating: true });
  providerResult(data, 'inventorySetQuantities', 'shopify_event_inventory_set_failed');
  level = await readInventoryLevel(target.inventoryItem.id, target.location.id, provider);
  if (availableQuantity(level) !== quantity) throw codedError('shopify_event_inventory_readback_failed');
  return { quantity, already_applied: false };
}

export async function syncVerifiedEventBatchToShopifyPos({ base44, batch, requestId, user }) {
  const eligibility = eventPosInventoryEligibility(batch);
  if (!eligibility.applicable) {
    return {
      applicable: false,
      success: true,
      status: 'not_applicable',
      reason: eligibility.reason,
      provider_calls_performed: false,
      inventory_mutation: false,
      customer_notifications_sent: false,
    };
  }
  if (!eligibility.ready) return blockBatchSync(base44, batch, eligibility.blocker);

  const eventRows = await base44.asServiceRole.entities.Event
    .filter({ id: eligibility.event_id }, '-created_date', 2)
    .catch(() => []);
  if (eventRows.length !== 1) return blockBatchSync(base44, batch, 'single_event_record_required');
  const event = eventRows[0];
  if (event.shopify_pos_inventory_sync_enabled !== true) return blockBatchSync(base44, batch, 'event_pos_inventory_sync_not_enabled');
  if (lower(event.shopify_pos_inventory_mode) !== EVENT_INVENTORY_MODE) return blockBatchSync(base44, batch, 'event_pos_inventory_mode_invalid');
  const locationId = shopifyGid(event.shopify_pos_location_id, 'Location');
  if (!locationId) return blockBatchSync(base44, batch, 'event_shopify_pos_location_required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text(event.date)) || text(event.date) <= chicagoDate()) {
    return blockBatchSync(base44, batch, 'event_pos_inventory_requires_future_event_date');
  }

  const provider = { calls: 0, writes: 0, host: '', token: '' };
  let command = null;
  try {
    await ensureSingleEventProductBatch(base44, batch, event.id);
    const product = await loadProduct(base44, batch.product_name);
    const claim = await claimCommand({ base44, batch, event, requestId, user, quantity: eligibility.quantity });
    command = claim.command;
    if (claim.state === 'success') {
      await updateBatchSync(base44, batch.id, {
        shopify_pos_inventory_sync_status: 'in_sync',
        shopify_pos_inventory_sync_quantity: eligibility.quantity,
        shopify_pos_inventory_command_id: command?.id || null,
        shopify_pos_location_id: locationId,
        shopify_pos_inventory_sync_error: null,
      });
      return {
        applicable: true,
        success: true,
        skipped: true,
        idempotent: true,
        status: 'in_sync',
        quantity: eligibility.quantity,
        location_name: text(event.shopify_pos_location_name).slice(0, 160) || null,
        provider_calls_performed: false,
        inventory_mutation: false,
        customer_notifications_sent: false,
      };
    }
    if (claim.state === 'running') {
      return {
        applicable: true,
        success: false,
        skipped: true,
        status: 'syncing',
        error_code: 'event_pos_inventory_command_in_progress',
        provider_calls_performed: false,
        inventory_mutation: false,
        customer_notifications_sent: false,
      };
    }

    await updateBatchSync(base44, batch.id, {
      shopify_pos_inventory_sync_status: 'syncing',
      shopify_pos_inventory_command_id: command?.id || null,
      shopify_pos_location_id: locationId,
      shopify_pos_inventory_sync_error: null,
    });

    const target = await readTarget({ product, locationId, provider });
    target.batchId = batch.id;
    target.location = await ensureLocationIsPosOnly(target, provider);
    await ensureDemandBasedOnlinePolicy(target, provider);
    await ensureTracking(target, provider);
    const providerIdempotencyKey = `event-pos:${safeId(event.id)}:${safeId(batch.id)}:available-v1`;
    const initialized = await initializeQuantity({
      target,
      quantity: eligibility.quantity,
      providerIdempotencyKey,
      provider,
    });
    const now = new Date().toISOString();
    await base44.asServiceRole.entities.Product.update(product.id, {
      shopify_pos_product_id: target.productId,
      shopify_pos_variant_id: target.variantId,
      shopify_product_id: target.productId,
      shopify_variant_id: target.variantId,
      shopify_handle: text(target.shopifyProduct?.handle) || product.shopify_handle || null,
    });
    await updateBatchSync(base44, batch.id, {
      shopify_pos_inventory_sync_status: 'in_sync',
      shopify_pos_inventory_sync_quantity: initialized.quantity,
      shopify_pos_inventory_synced_at: now,
      shopify_pos_inventory_command_id: command?.id || null,
      shopify_pos_location_id: locationId,
      shopify_pos_inventory_sync_error: null,
    });
    await base44.asServiceRole.entities.CommandLog.update(command.id, {
      status: 'success',
      completed_at: now,
      error_code: null,
      error_message: null,
      result: {
        provider_write_completed: provider.writes > 0,
        native_projection_completed: true,
        quantity: initialized.quantity,
        location_id: locationId,
        product_id: target.productId,
        variant_id: target.variantId,
        inventory_item_id: target.inventoryItem.id,
        already_applied: initialized.already_applied === true,
        online_fulfillment_disabled: true,
        online_inventory_policy: 'continue',
        customer_notifications_sent: false,
      },
    });
    return {
      applicable: true,
      success: true,
      skipped: initialized.already_applied === true,
      idempotent: initialized.already_applied === true,
      status: 'in_sync',
      quantity: initialized.quantity,
      location_name: text(target.location?.name).slice(0, 160) || null,
      provider_calls_performed: provider.calls > 0,
      inventory_mutation: provider.writes > 0,
      customer_notifications_sent: false,
    };
  } catch (error) {
    return failCommand({
      base44,
      commandId: command?.id,
      batch,
      code: error?.code || error?.message,
      provider,
    });
  }
}
