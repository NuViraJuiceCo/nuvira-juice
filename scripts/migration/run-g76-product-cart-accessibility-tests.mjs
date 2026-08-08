import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('src/pages/ProductDetail.jsx', 'utf8');
const cart = fs.readFileSync('src/pages/Cart.jsx', 'utf8');
const checkout = fs.readFileSync('src/pages/Checkout.jsx', 'utf8');
const address = fs.readFileSync('src/components/AddressAutocomplete.jsx', 'utf8');

assert.match(source, /aria-label=\{`Add \$\{quantity\} \$\{product\.title\} to cart for \$\$\{/);
assert.match(source, /Add to cart · \$\$\{/);
assert.match(source, /onClick=\{handleAddToCart\}/);
assert.match(source, /aria-label="Decrease quantity"/);
assert.match(source, /aria-label="Increase quantity"/);
assert.match(cart, /aria-label=\{`Remove \$\{item\.title\} from cart`\}/);
assert.match(cart, /aria-label=\{`Decrease \$\{item\.title\} quantity`\}/);
assert.match(cart, /aria-label=\{`Increase \$\{item\.title\} quantity`\}/);
for (const label of ['Discount Code', 'First name', 'Last name', 'Phone Number']) {
  assert.match(checkout, new RegExp(`aria-label=["']${label}["']`));
}
for (const label of ['Street address', 'City', 'State', 'ZIP code']) {
  assert.match(address, new RegExp(`aria-label=["']${label}["']`));
}

console.log(JSON.stringify({
  ok: true,
  suite: 'g76-product-cart-accessibility',
  cases: 16,
  writes_performed: false,
  provider_calls_performed: false,
}, null, 2));
