const member = new URLSearchParams(location.search).get('mode') !== 'guest';
const user = member ? { id: 'synthetic-member', email: 'qa@example.invalid', first_name: 'Demo', last_name: 'Customer', full_name: 'Demo Customer', role: 'user' } : null;
const items = [
  { product_id: 'synthetic-oasis', title: 'OASIS', price: 13, quantity: 2, image_url: '/images/products/cards/oasis.webp' },
  { product_id: 'synthetic-aura', title: 'AURA', price: 13, quantity: 1, image_url: '/images/products/cards/aura.webp' },
];
export const useAuth = () => ({ user });
export const useCart = () => ({ items, subtotal: 39, clearCart: () => { window.__cartCleared = true; }, trackCheckoutStarted: () => {} });
