// @ts-nocheck
// Base44 deploys each nested handler as an isolated function. Keep this pure
// eligibility helper local so preview deploys cannot depend on a sibling function.

const EVENT_STOCK_SOURCE = 'event_stock';
const EVENT_STOCK_SYSTEM = 'customer_app_native_event_stock';
const EVENT_STOCK_OWNER = 'native_owned_event_stock';

function text(value) {
  return (value ?? '').toString().trim();
}

function lower(value) {
  return text(value).toLowerCase();
}

function safeId(value) {
  const valueText = text(value);
  return /^[A-Za-z0-9._:@/#-]{1,220}$/.test(valueText) ? valueText : '';
}

function integerQuantity(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function eventSources(batch) {
  return (Array.isArray(batch?.order_sources) ? batch.order_sources : [])
    .filter(source => lower(source?.source_type) === EVENT_STOCK_SOURCE);
}

function nonEventSources(batch) {
  return (Array.isArray(batch?.order_sources) ? batch.order_sources : [])
    .filter(source => lower(source?.source_type) !== EVENT_STOCK_SOURCE);
}

function eventAllocations(batch) {
  const allocations = new Map();
  for (const source of eventSources(batch)) {
    const eventId = safeId(source?.order_id);
    const quantity = integerQuantity(source?.quantity);
    if (!eventId || quantity === null) continue;
    allocations.set(eventId, (allocations.get(eventId) || 0) + quantity);
  }
  return [...allocations.entries()]
    .map(([event_id, quantity]) => ({ event_id, quantity }))
    .sort((left, right) => left.event_id.localeCompare(right.event_id));
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
  if (sources.some(source => !safeId(source?.order_id) || integerQuantity(source?.quantity) === null)) {
    return { applicable: true, ready: false, blocker: 'event_stock_allocation_quantity_required' };
  }
  const allocations = eventAllocations(batch);
  if (allocations.length === 0) {
    return { applicable: true, ready: false, blocker: 'event_stock_allocation_required' };
  }
  const quantity = integerQuantity(batch?.final_usable_quantity);
  if (quantity === null) {
    return { applicable: true, ready: false, blocker: 'verified_final_usable_quantity_required' };
  }
  const allocatedQuantity = allocations.reduce((sum, allocation) => sum + allocation.quantity, 0);
  if (allocatedQuantity !== quantity) {
    return {
      applicable: true,
      ready: false,
      blocker: 'verified_output_must_equal_event_allocation_total',
      quantity,
      allocated_quantity: allocatedQuantity,
      allocations,
    };
  }
  return { applicable: true, ready: true, quantity, allocations };
}
