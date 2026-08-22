import "@shopify/ui-extensions/preact";
import {render} from 'preact';
import {useInventoryWarnings} from './useInventoryWarnings.js';

export default async () => {
  render(<Extension />, document.body);
}

function Extension() {
  const {i18n} = shopify;
  const {error, hasCartItems, loading, warnings} = useInventoryWarnings(shopify, {announce: true});

  let heading = i18n.translate('tile_heading_ready');
  let subheading = hasCartItems
    ? i18n.translate('tile_subheading_ready')
    : i18n.translate('tile_subheading_idle');

  if (loading) subheading = i18n.translate('tile_subheading_loading');
  if (warnings.length) {
    heading = i18n.translate('tile_heading_warning');
    subheading = warnings[0].label;
  }
  if (error) {
    heading = i18n.translate('tile_heading_error');
    subheading = i18n.translate('tile_subheading_error');
  }

  return (
    <s-tile
      heading={heading}
      subheading={subheading}
      itemCount={warnings.length || (error ? 1 : undefined)}
      tone={warnings.length || error ? 'accent' : 'neutral'}
      onClick={() => shopify.action.presentModal()}
    />
  );
}
