import "@shopify/ui-extensions/preact";
import {render} from 'preact';
import {useInventoryWarnings} from './useInventoryWarnings.js';

export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  const {i18n} = shopify;
  const {error, hasCartItems, loading, warnings} = useInventoryWarnings(shopify);

  return (
    <s-page heading={i18n.translate('modal_heading')}>
      <s-scroll-box>
        <s-box padding="base">
          <s-stack direction="block" gap="base">
            {loading && <s-banner heading="Checking current location stock" tone="info" />}

            {error && (
              <s-banner heading="Stock lookup unavailable" tone="critical">
                Verify each item directly in Shopify inventory before checkout. Do not assume the cart is safe.
              </s-banner>
            )}

            {!loading && !error && !hasCartItems && (
              <s-banner heading="No products in the cart" tone="info">
                Add an event item and NuVira Event Stock Guard will compare the cart to stock at this POS location.
              </s-banner>
            )}

            {!loading && !error && hasCartItems && !warnings.length && (
              <s-banner heading="Cart quantities fit on-hand stock" tone="success">
                No low-stock or sell-out warning is active for the tracked items in this cart.
              </s-banner>
            )}

            {warnings.map((warning) => (
              <s-section key={`${warning.variantId}-${warning.code}`} heading={warning.name}>
                <s-stack direction="block" gap="small">
                  <s-badge tone={warning.tone}>{warning.label}</s-badge>
                  <s-text>{warning.message}</s-text>
                  {warning.onHand === null ? (
                    <s-text>In cart: {warning.inCart} · Physical count required before checkout</s-text>
                  ) : (
                    <s-text>
                      On hand here: {warning.onHand} · In cart: {warning.inCart} · After sale: {Math.max(0, warning.remaining)}
                    </s-text>
                  )}
                </s-stack>
              </s-section>
            ))}

            <s-banner heading="If event stock is sold out" tone="warning">
              Do not create a future-delivery sale in POS. Ask the customer to download NuVira Juice Co. from the App Store and place the order in the app.
            </s-banner>
          </s-stack>
        </s-box>
      </s-scroll-box>
    </s-page>
  );
}
