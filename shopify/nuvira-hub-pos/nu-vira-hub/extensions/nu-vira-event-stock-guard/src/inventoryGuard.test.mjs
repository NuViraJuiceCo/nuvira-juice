import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assessCart,
  assessLineItem,
  toastMessage,
  warningFingerprint,
} from './inventoryGuard.js';

function line(quantity, title = 'Radiance Shot', variantId = 101) {
  return {quantity, title, variantId};
}

function variant(onHand, overrides = {}) {
  return {
    id: 101,
    inventoryAtLocation: onHand,
    inventoryIsTracked: true,
    ...overrides,
  };
}

test('does not warn above the low-stock threshold when the cart fits', () => {
  assert.equal(assessLineItem({lineItem: line(1), variant: variant(7)}), null);
});

test('warns at five units for every tracked event item', () => {
  const warning = assessLineItem({lineItem: line(1), variant: variant(5)});
  assert.equal(warning.code, 'low_stock');
  assert.equal(warning.remaining, 4);
});

test('warns before a sale that leaves exactly one unit', () => {
  const warning = assessLineItem({lineItem: line(4), variant: variant(5)});
  assert.equal(warning.code, 'one_left');
  assert.match(warning.message, /exactly one unit left/i);
});

test('calls out the last unit before checkout', () => {
  const warning = assessLineItem({lineItem: line(1), variant: variant(1)});
  assert.equal(warning.code, 'final_stock');
  assert.match(warning.label, /LAST ONE/);
  assert.match(toastMessage([warning]), /LAST ONE/);
});

test('calls out a cart that consumes all remaining units', () => {
  const warning = assessLineItem({lineItem: line(5), variant: variant(5)});
  assert.equal(warning.code, 'final_stock');
  assert.match(warning.message, /all 5 remaining units/);
});

test('stops a cart quantity above physical event stock', () => {
  const warning = assessLineItem({lineItem: line(10), variant: variant(5)});
  assert.equal(warning.code, 'insufficient');
  assert.equal(warning.remaining, -5);
  assert.match(warning.message, /Remove 5/);
  assert.match(warning.message, /NuVira app/);
});

test('does not make inventory decisions for untracked products', () => {
  assert.equal(
    assessLineItem({lineItem: line(1), variant: variant(undefined, {inventoryIsTracked: false})}),
    null,
  );
});

test('sorts the most urgent warning first and creates a stable fingerprint', () => {
  const variantsById = new Map([
    [101, variant(5)],
    [202, variant(1, {id: 202})],
  ]);
  const warnings = assessCart({
    lineItems: [line(1, 'Radiance Shot', 101), line(1, 'Reset Shot', 202)],
    variantsById,
  });

  assert.deepEqual(warnings.map(({code}) => code), ['final_stock', 'low_stock']);
  assert.equal(warningFingerprint(warnings), '202:final_stock:1:1|101:low_stock:5:1');
  assert.match(toastMessage(warnings), /\+1 more warning/);
});
