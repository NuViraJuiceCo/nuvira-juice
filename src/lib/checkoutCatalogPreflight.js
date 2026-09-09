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
  const birthdays = items.filter(item => item?.isBirthdayReward === true || item?.birthday_product_id || item?.product_id === '__birthday_reward__');
  const pricedBirthdays = data.quote.items.filter(item => item?.isBirthdayReward === true || item?.birthday_product_id);
  if (birthdays.length) {
    const gift = pricedBirthdays[0]; const snapshot = data.quote.birthday_checkout;
    if (birthdays.length !== 1 || pricedBirthdays.length !== 1
      || snapshot?.revision !== '2026-09-08.birthday-entitlement-v1'
      || snapshot.product_id !== birthdays[0].birthday_product_id || gift.product_id !== snapshot.product_id
      || gift.birthday_product_id !== snapshot.product_id || gift.isBirthdayReward !== true
      || gift.quantity !== 1 || gift.price !== 0 || !Number.isSafeInteger(snapshot.retail_value_cents)
      || snapshot.retail_value_cents <= 0
      || Math.round(data.quote.birthday_discount * 100) !== snapshot.retail_value_cents
      || Math.round(data.quote.catalog_subtotal * 100) !== Math.round(data.quote.subtotal * 100) + snapshot.retail_value_cents) {
      throw new Error(FALLBACK);
    }
  } else if (pricedBirthdays.length || data.quote.birthday_checkout) throw new Error(FALLBACK);
  return data.quote;
}
