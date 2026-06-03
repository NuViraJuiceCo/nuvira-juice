import React, { createContext, useContext, useState, useEffect } from 'react';

const CartContext = createContext();

function readStoredCart() {
  try {
    const saved = window.localStorage?.getItem('nuvira_cart');
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

function storeCart(items) {
  try {
    window.localStorage?.setItem('nuvira_cart', JSON.stringify(items));
  } catch {
    // Cart persistence should never prevent the app shell from rendering.
  }
}

export function CartProvider({ children }) {
  const [items, setItems] = useState(readStoredCart);

  useEffect(() => {
    storeCart(items);
  }, [items]);

  const addItem = (product, quantity = 1, extra = {}) => {
    setItems(prev => {
      const existing = prev.find(i => i.product_id === product.id);
      if (existing) {
        return prev.map(i =>
          i.product_id === product.id
            ? { ...i, quantity: i.quantity + quantity }
            : i
        );
      }
      return [...prev, {
        product_id: product.id,
        title: product.title,
        price: product.price,
        quantity,
        image_url: product.image_url,
        size: product.size,
        category: product.category,
        is_program: product.is_program || false,
        ...extra,
      }];
    });
  };

  const removeItem = (productId) => {
    setItems(prev => prev.filter(i => i.product_id !== productId));
  };

  const updateQuantity = (productId, quantity) => {
    if (quantity <= 0) {
      removeItem(productId);
      return;
    }
    setItems(prev =>
      prev.map(i => i.product_id === productId ? { ...i, quantity } : i)
    );
  };

  const updateBundleComposition = (productId, composition) => {
    setItems(prev => prev.map(i => i.product_id === productId ? { ...i, bundle_composition: composition } : i));
  };

  const clearCart = () => setItems([]);

  const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);

  return (
    <CartContext.Provider value={{
      items, addItem, removeItem, updateQuantity, updateBundleComposition, clearCart, subtotal, itemCount
    }}>
      {children}
    </CartContext.Provider>
  );
}

export const useCart = () => useContext(CartContext);
