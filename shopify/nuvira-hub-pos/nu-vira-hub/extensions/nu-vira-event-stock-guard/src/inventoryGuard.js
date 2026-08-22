export const DEFAULT_LOW_STOCK_THRESHOLD = 5;

const SEVERITY_ORDER = {
  inventory_unknown: 0,
  inventory_untracked: 1,
  insufficient: 2,
  final_stock: 3,
  one_left: 4,
  low_stock: 5,
};

function wholeNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.trunc(numeric)) : null;
}

function itemName(lineItem, variant) {
  return String(lineItem?.title || variant?.displayName || variant?.title || 'item').trim();
}

function unitLabel(quantity) {
  return quantity === 1 ? 'unit' : 'units';
}

export function assessLineItem({
  lineItem,
  variant,
  lowStockThreshold = DEFAULT_LOW_STOCK_THRESHOLD,
}) {
  if (!lineItem) return null;

  const inCart = wholeNumber(lineItem.quantity);
  if (inCart === null || inCart === 0) return null;

  const name = itemName(lineItem, variant);
  const variantId = Number(lineItem.variantId);

  if (!variant) {
    return {
      variantId,
      name,
      onHand: null,
      inCart,
      remaining: null,
      code: 'inventory_unknown',
      tone: 'critical',
      label: 'STOP — STOCK CHECK UNAVAILABLE',
      message: `NuVira Event Stock Guard could not read ${name} at this POS location. Verify the location and physical count before checkout.`,
    };
  }

  if (variant.inventoryIsTracked !== true) {
    return {
      variantId,
      name,
      onHand: null,
      inCart,
      remaining: null,
      code: 'inventory_untracked',
      tone: 'critical',
      label: 'STOP — INVENTORY NOT TRACKED',
      message: `${name} does not have Shopify inventory tracking enabled. Verify physical event stock before checkout; do not assume it is available.`,
    };
  }

  const onHand = wholeNumber(variant.inventoryAtLocation);
  if (onHand === null) {
    return {
      variantId,
      name,
      onHand: null,
      inCart,
      remaining: null,
      code: 'inventory_unknown',
      tone: 'critical',
      label: 'STOP — STOCK COUNT UNAVAILABLE',
      message: `${name} has no readable count at this POS location. Verify the active location and physical count before checkout.`,
    };
  }

  const remaining = onHand - inCart;
  const base = {
    variantId,
    name,
    onHand,
    inCart,
    remaining,
  };

  if (inCart > onHand) {
    const excess = inCart - onHand;
    return {
      ...base,
      code: 'insufficient',
      tone: 'critical',
      label: 'STOP — NOT ENOUGH ON HAND',
      message: `Only ${onHand} ${unitLabel(onHand)} of ${name} are available here. Remove ${excess} from this POS cart and have the customer order the remainder in the NuVira app.`,
    };
  }

  if (remaining === 0) {
    const lastLabel = onHand === 1 ? 'LAST ONE' : 'FINAL STOCK';
    return {
      ...base,
      code: 'final_stock',
      tone: 'critical',
      label: `${lastLabel} — CONFIRM BEFORE CHECKOUT`,
      message:
        onHand === 1
          ? `${name} is the last unit on hand. This sale will sell it out.`
          : `This cart contains all ${onHand} remaining units of ${name}. This sale will sell it out.`,
    };
  }

  if (remaining === 1) {
    return {
      ...base,
      code: 'one_left',
      tone: 'warning',
      label: 'ONE LEFT AFTER THIS SALE',
      message: `${name} will have exactly one unit left after this cart is completed.`,
    };
  }

  if (remaining <= lowStockThreshold) {
    return {
      ...base,
      code: 'low_stock',
      tone: 'warning',
      label: 'LOW STOCK',
      message: `${name} has ${onHand} ${unitLabel(onHand)} on hand; only ${remaining} will remain after this cart.`,
    };
  }

  return null;
}

export function assessCart({
  lineItems = [],
  variantsById,
  lowStockThreshold = DEFAULT_LOW_STOCK_THRESHOLD,
}) {
  const warnings = lineItems
    .map((lineItem) => {
      const variantId = Number(lineItem?.variantId);
      const variant = variantsById instanceof Map
        ? variantsById.get(variantId)
        : variantsById?.[variantId];
      return assessLineItem({lineItem, variant, lowStockThreshold});
    })
    .filter(Boolean);

  return warnings.sort((left, right) => {
    const severity = SEVERITY_ORDER[left.code] - SEVERITY_ORDER[right.code];
    return severity || left.name.localeCompare(right.name);
  });
}

export function warningFingerprint(warnings = []) {
  return warnings
    .map(({variantId, code, onHand, inCart}) => `${variantId}:${code}:${onHand}:${inCart}`)
    .join('|');
}

export function toastMessage(warnings = []) {
  if (!warnings.length) return '';
  const primary = warnings[0];
  const suffix = warnings.length > 1 ? ` +${warnings.length - 1} more warning${warnings.length === 2 ? '' : 's'}.` : '';

  if (primary.code === 'inventory_unknown') {
    return `STOP: stock could not be checked for ${primary.name}; verify it before checkout.${suffix}`;
  }
  if (primary.code === 'inventory_untracked') {
    return `STOP: inventory is not tracked for ${primary.name}; verify physical stock before checkout.${suffix}`;
  }
  if (primary.code === 'insufficient') {
    return `STOP: only ${primary.onHand} ${primary.name} on hand; ${primary.inCart} are in the cart.${suffix}`;
  }
  if (primary.code === 'final_stock') {
    return `${primary.onHand === 1 ? 'LAST ONE' : 'FINAL STOCK'}: this sale will sell out ${primary.name}.${suffix}`;
  }
  if (primary.code === 'one_left') {
    return `LOW STOCK: only 1 ${primary.name} will remain after this sale.${suffix}`;
  }
  return `LOW STOCK: only ${primary.remaining} ${primary.name} will remain after this sale.${suffix}`;
}
