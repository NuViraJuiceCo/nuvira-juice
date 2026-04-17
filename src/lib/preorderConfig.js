// Pre-order configuration
// The app is in pre-order mode between PREORDER_START and PREORDER_END (inclusive).
// On and after LAUNCH_DATE, the store is fully live.

export const PREORDER_START = new Date('2026-04-22T00:00:00'); // April 22 soft launch
export const PREORDER_END   = new Date('2026-04-29T23:59:59'); // Last day of pre-orders
export const LAUNCH_DATE    = new Date('2026-04-30T00:00:00'); // Capture + fulfillment begins
export const FULFILLMENT_DATE_STR = '2026-04-30';             // ISO date string for DB

/**
 * Returns true if the current date/time falls within the pre-order window.
 */
export function isPreorderMode() {
  const now = new Date();
  return now >= PREORDER_START && now <= PREORDER_END;
}

/**
 * Returns true if a product (or the whole store) is in pre-order mode.
 * Pass a product object to also check if the product itself is marked as a pre-order item.
 */
export function isProductPreorder(product = null) {
  if (isPreorderMode()) return true;
  // Per-product pre-order flag (for future seasonal/new product pre-orders)
  if (product?.is_preorder) return true;
  return false;
}