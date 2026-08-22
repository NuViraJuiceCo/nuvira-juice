import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useEffect, useState} from 'preact/hooks';

export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  const {i18n} = shopify;
  const [state, setState] = useState({loading: true, error: '', variant: null});

  useEffect(() => {
    let active = true;

    shopify.productSearch.fetchProductVariantWithId(Number(shopify.product.variantId))
      .then((variant) => {
        if (active) setState({loading: false, error: '', variant});
      })
      .catch((error) => {
        if (!active) return;
        setState({
          loading: false,
          error: error instanceof Error ? error.message : String(error || 'Unknown error'),
          variant: null,
        });
      });

    return () => {
      active = false;
    };
  }, []);

  const variant = state.variant;
  const onHand = variant?.inventoryIsTracked === true && Number.isFinite(Number(variant.inventoryAtLocation))
    ? Math.max(0, Math.trunc(Number(variant.inventoryAtLocation)))
    : null;

  /** @type {'neutral' | 'critical' | 'warning' | 'success'} */
  let tone = 'neutral';
  let label = 'Stock not tracked';
  let message = 'Confirm availability manually before adding this product.';

  if (state.loading) {
    label = 'Checking stock';
    message = 'Reading the quantity at this POS location.';
  } else if (state.error) {
    tone = 'critical';
    label = 'Check stock manually';
    message = 'Inventory lookup failed. Do not assume this item is available.';
  } else if (onHand === 0) {
    tone = 'critical';
    label = 'Sold out at event';
    message = 'Do not sell this item in POS. Ask the customer to order in the NuVira app.';
  } else if (onHand === 1) {
    tone = 'critical';
    label = 'Last one on hand';
    message = 'The next completed sale will sell out this item.';
  } else if (onHand !== null && onHand <= 5) {
    tone = 'warning';
    label = 'Low stock';
    message = `Only ${onHand} units are available at this location.`;
  } else if (onHand !== null) {
    tone = 'success';
    label = `${onHand} on hand`;
    message = 'The cart guard will warn again if the requested quantity is too high.';
  }

  return (
    <s-pos-block heading={i18n.translate('product_block_heading')}>
      <s-stack direction="block" gap="small">
        <s-badge tone={tone}>{label}</s-badge>
        <s-text>{message}</s-text>
      </s-stack>
    </s-pos-block>
  );
}
