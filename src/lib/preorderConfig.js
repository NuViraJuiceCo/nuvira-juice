/**
 * PREORDER CONFIGURATION — Customer App
 *
 * SOURCE OF TRUTH: The backend function `createCheckoutSession` is the authoritative
 * source for preorder mode. It uses hardcoded dates internally to determine whether
 * to create a manual-capture (preorder) or immediate-capture Stripe session.
 *
 * This file controls FRONTEND UI only (banners, messaging, delivery date display).
 * It must stay in sync with the dates in createCheckoutSession.
 *
 * Backend dates (in functions/createCheckoutSession):
 *   PREORDER_START    = 2026-04-23T00:00:00
 *   PREORDER_END      = 2026-04-30T23:59:59
 *   FULFILLMENT_DATE  = 2026-05-01  (payment capture / production day)
 *   DELIVERY_DATE     = 2026-05-02  (first delivery)
 *
 * ⚠️ If you change preorder dates, update BOTH this file AND createCheckoutSession.
 *
 * Pre-order window is now CLOSED (ended 2026-04-30). isPreorderMode() returns false.
 */

export const PREORDER_START       = new Date('2026-04-23T00:00:00');
export const PREORDER_END         = new Date('2026-04-30T23:59:59');
export const LAUNCH_DATE          = new Date('2026-05-01T00:00:00');
export const FULFILLMENT_DATE_STR = '2026-05-01';
export const FIRST_DELIVERY_DATE  = '2026-05-02';

/**
 * Returns true if the current date/time falls within the pre-order window.
 * Pre-order window has CLOSED — hardcoded to false.
 * To re-enable: return new Date() >= PREORDER_START && new Date() <= PREORDER_END;
 */
export function isPreorderMode() {
  return false;
}

/**
 * Returns true if a product (or the whole store) is in pre-order mode.
 */
export function isProductPreorder(product = null) {
  if (isPreorderMode()) return true;
  if (product?.is_preorder) return true;
  return false;
}