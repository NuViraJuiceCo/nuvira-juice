const FOOD_CATEGORIES = new Set(['produce', 'juice base', 'spices & herbs']);
const FOOD_ITEMS = new Set(['honey']);
export const COUNT_STATUSES = new Set(['pending_count', 'verified']);

const lower = value => String(value ?? '').trim().toLowerCase();
const itemKey = value => lower(value).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

export function isFoodInventoryItem(item) {
  return FOOD_CATEGORIES.has(lower(item?.category)) || FOOD_ITEMS.has(itemKey(item?.ingredient));
}

export function hasBagSyncError(item) {
  return lower(item?.inventory_kind) === 'bag' && lower(item?.shopify_sync_status) === 'error';
}

export function rawThresholdStatus(item) {
  if (item?.stock === null || item?.stock === undefined || String(item.stock).trim() === '') return null;
  const stock = Number(item.stock);
  const reorderPoint = Number(item.reorder_point);
  if (!Number.isFinite(stock)) return null;
  if (stock <= 0) return 'out_of_stock';
  if (Number.isFinite(reorderPoint) && reorderPoint > 0 && stock <= reorderPoint * 0.5) return 'critical';
  if (Number.isFinite(reorderPoint) && reorderPoint > 0 && stock <= reorderPoint) return 'low';
  return 'ok';
}

export function countStatus(item) {
  const status = lower(item?.count_status);
  if (status === 'pending_count' || rawThresholdStatus(item) === null) return 'pending_count';
  // Preserve counted legacy rows without interpreting missing quantities as zero.
  return 'verified';
}

export function deriveInventoryStatus(item) {
  if (isFoodInventoryItem(item)) return 'demand_based';
  if (countStatus(item) !== 'verified' || rawThresholdStatus(item) === null) return 'count_required';
  if (lower(item?.shopify_sync_status) === 'error') return 'sync_error';
  return rawThresholdStatus(item);
}
