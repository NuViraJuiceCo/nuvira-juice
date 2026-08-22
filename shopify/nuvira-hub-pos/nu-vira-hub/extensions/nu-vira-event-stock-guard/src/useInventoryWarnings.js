import {useEffect, useRef, useState} from 'preact/hooks';
import {assessCart, toastMessage, warningFingerprint} from './inventoryGuard.js';

const EMPTY_STATE = {
  loading: false,
  error: '',
  hasCartItems: false,
  warnings: [],
};

/**
 * @typedef {Pick<import('@shopify/ui-extensions/pos.home.tile.render').Api,
 *   'cart' | 'productSearch' | 'toast'>} StockGuardApi
 */

/**
 * @param {StockGuardApi} api
 * @param {{announce?: boolean}} options
 */
export function useInventoryWarnings(api, {announce = false} = {}) {
  const [state, setState] = useState(EMPTY_STATE);
  const requestSequence = useRef(0);
  const lastAnnouncement = useRef('');

  useEffect(() => {
    let active = true;

    const evaluate = async (cart) => {
      const sequence = ++requestSequence.current;
      const lineItems = (cart?.lineItems || []).filter((item) => Number(item?.variantId));

      if (!lineItems.length) {
        lastAnnouncement.current = '';
        setState(EMPTY_STATE);
        return;
      }

      setState((current) => ({...current, loading: true, error: '', hasCartItems: true}));

      try {
        const variantIds = [...new Set(lineItems.map((item) => Number(item.variantId)))];
        const result = await api.productSearch.fetchProductVariantsWithIds(variantIds);
        const variantsById = new Map(
          (result?.fetchedResources || []).map((variant) => [Number(variant.id), variant]),
        );
        const warnings = assessCart({lineItems, variantsById});

        if (!active || sequence !== requestSequence.current) return;
        setState({loading: false, error: '', hasCartItems: true, warnings});

        if (announce) {
          const fingerprint = warningFingerprint(warnings);
          if (fingerprint && fingerprint !== lastAnnouncement.current) {
            api.toast.show(toastMessage(warnings));
          }
          lastAnnouncement.current = fingerprint;
        }
      } catch (error) {
        if (!active || sequence !== requestSequence.current) return;
        const message = error instanceof Error ? error.message : String(error || 'Unknown error');
        setState({loading: false, error: message, hasCartItems: true, warnings: []});

        if (announce && lastAnnouncement.current !== 'lookup-error') {
          api.toast.show('Stock check unavailable — verify on-hand quantity before checkout.');
          lastAnnouncement.current = 'lookup-error';
        }
      }
    };

    evaluate(api.cart.current.value);
    const unsubscribe = api.cart.current.subscribe(evaluate);

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [announce, api]);

  return state;
}
