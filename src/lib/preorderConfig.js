// Pre-order configuration
// Pre-orders: April 23 – April 30 (inclusive).
// Launch / first production day: May 1st.
// First delivery date for ALL orders (pre-orders + May 1st orders): May 2nd.

export const PREORDER_START       = new Date('2026-04-23T00:00:00'); // Pre-orders open April 23
export const PREORDER_END         = new Date('2026-04-30T23:59:59'); // Last day to pre-order
export const LAUNCH_DATE          = new Date('2026-05-01T00:00:00'); // Production day / live store
export const FULFILLMENT_DATE_STR = '2026-05-01';                    // Production date (capture payments)
export const FIRST_DELIVERY_DATE  = '2026-05-02';                    // All pre-orders + May 1 orders delivered

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
  if (product?.is_preorder) return true;
  return false;
}