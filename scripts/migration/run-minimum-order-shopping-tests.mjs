import assert from 'node:assert/strict';
import fs from 'node:fs';
import { orderMinimumGuidance } from '../../src/lib/orderMinimumGuidance.js';
import { orderMinimumStatus } from '../../src/lib/orderMinimums.js';

const juice = quantity => ({ category: 'juice', quantity });
const shot = quantity => ({ category: 'shot', quantity });
let cases = 0;
for (let juices = 0; juices <= 6; juices++) {
  for (let shots = 0; shots <= 8; shots++) {
    const items = [...(juices ? [juice(juices)] : []), ...(shots ? [shot(shots)] : [])];
    const before = JSON.stringify(items);
    const actual = orderMinimumGuidance(items);
    const expected = orderMinimumStatus(items);
    assert.equal(actual.meetsMinimum, expected.meetsMinimum);
    assert.equal(actual.remainingUnits, expected.remainingUnits);
    assert.equal(actual.canBuild, !expected.meetsMinimum);
    assert.equal(actual.progress, Math.min(100, expected.units / 3 * 100));
    assert.equal(JSON.stringify(items), before, 'Display helper cannot change the cart');
    cases++;
  }
}
assert.equal(orderMinimumGuidance([juice(1)]).title, 'Choose 2 more juices');
assert.equal(orderMinimumGuidance([shot(1)]).title, 'Choose 5 more shots');
assert.equal(orderMinimumGuidance([juice(2), shot(1)]).title, 'Choose 1 more shot');
assert.equal(orderMinimumGuidance([juice(1), shot(1)]).alternative, 'Or add 3 more shots. Mix and match any flavors.');
for (const item of [
  { category: 'bundle', quantity: 1, bottles_per_unit: 3 },
  { category: 'bundle', quantity: 1, bottles_per_unit: 8, is_program: true },
  { category: 'bundle', quantity: 1, bottles_per_unit: 6, isFreeReward: true, reward_id: 'test', price: 0 },
]) assert.equal(orderMinimumGuidance([item]).title, 'Order count minimum met');
assert.equal(orderMinimumGuidance([{ ...juice(1), isFreeReward: true, price: 0 }, juice(2)]).meetsMinimum, true);
assert.equal(orderMinimumGuidance([{ category: 'merch', quantity: 1 }]).visible, false);
assert.equal(orderMinimumGuidance([{ category: 'merch', quantity: 1 }, juice(1)]).canBuild, true);
for (const invalid of [juice(0), juice(101), juice(1.5), shot(-1), { category: 'bundle', quantity: 1, isFreeReward: true }]) {
  for (const prefix of [[], [juice(3)]]) {
    const items = [...prefix, invalid];
    const guidance = orderMinimumGuidance(items);
    assert.equal(guidance.canBuild, false);
    assert.equal(guidance.meetsMinimum, false);
    assert.equal(guidance.title, orderMinimumStatus(items).error);
    assert.equal(guidance.progress, 0);
  }
}
const read = path => fs.readFileSync(path, 'utf8');
const cart = read('src/pages/Cart.jsx');
const product = read('src/pages/ProductDetail.jsx');
const builder = read('src/components/cart/OrderMinimumBuilder.jsx');
assert.match(cart, /const minimumStatus = orderMinimumStatus\(items\)/);
assert.match(cart, /if \(!meetsMinimum\) return;\s*navigate\('\/checkout'\)/);
assert.match(cart, /disabled=\{!meetsMinimum\}/);
assert.match(cart, /createPortal\(/);
assert.match(cart, /, document\.body\)/);
assert.match(product, /aria-label="Purchase minimum"/);
assert.match(product, /Minimum: 3 juices \/ 6 shots/);
assert.match(product, /onChooseQuantity=\{setQuantity\}/);
assert.match(product, /setQuantity\(1\);\s*setSelectedImageIndex\(0\)/);
assert.match(builder, /onClick=\{\(\) => addItem\(product, 1\)\}/);
assert.match(builder, /product\.is_available === true/);
assert.match(builder, /Number\.isFinite\(product.price\) && product.price > 0/);
assert.match(builder, /Delivery-area dollar minimums still apply/);
assert.match(builder, /aria-valuetext=\{guidance.title\}/);
assert.doesNotMatch(builder, /PUBLIC_PRODUCT_FALLBACKS|functions\.invoke|trackGoogle|trackMeta|trackSnap|\.create\(|\.update\(/);
console.log(JSON.stringify({ ok: true, suite: 'minimum-order-shopping', count_matrix_cases: cases,
  provider_calls: false, production_writes: false, purchase_rules_changed: false }));
