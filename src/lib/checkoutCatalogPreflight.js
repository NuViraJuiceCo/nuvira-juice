const REVISION = '2026-09-08.catalog-checkout-v1';
const FALLBACK = 'We could not confirm your cart. Please try again before paying.';
const isReadOnly = data => data?.preview_only === true && data.writes_performed === false
  && data.provider_calls_performed === false && data.payment_intent_created === false && data.order_created === false;
const safeMessage = data => isReadOnly(data) && typeof data.error === 'string' && data.error.length <= 300
  ? data.error : FALLBACK;

// Read-only check before profile, bag-return or payment preparation. A timeout
// never starts a payment; the underlying read may finish but has no write path.
export async function verifyCheckoutCatalog(invoke, items, { timeoutMs = 10000 } = {}) {
  let timer;
  let response;
  try {
    response = await Promise.race([
      Promise.resolve().then(() => invoke('createPaymentIntent', { mode: 'preview_catalog_checkout', items })),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(FALLBACK)), timeoutMs); }),
    ]);
  } catch (error) {
    const data = error?.data || error?.response?.data;
    throw new Error(safeMessage(data));
  } finally { clearTimeout(timer); }
  const data = response?.data || response;
  if (!isReadOnly(data) || data.ok !== true) throw new Error(safeMessage(data));
  if (data.quote?.revision !== REVISION || !Array.isArray(data.quote.items) || data.quote.items.length !== items.length
    || !Number.isFinite(data.quote.subtotal) || data.quote.subtotal < 0
    || data.quote.items.some(item => typeof item.product_id !== 'string' || !item.product_id
      || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || !Number.isFinite(item.price) || item.price < 0)
    || Math.round(data.quote.subtotal * 100) !== data.quote.items.reduce((sum, item) => sum + Math.round(item.price * 100) * item.quantity, 0)) {
    throw new Error(FALLBACK);
  }
  return data.quote;
}
