import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';

const CartContext = createContext();
const JOURNEY_SESSION_KEY = 'nuvira_customer_journey_session';

function journeySessionId() {
  try {
    const existing = window.localStorage?.getItem(JOURNEY_SESSION_KEY);
    if (existing) return existing;
    const created = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `nv-journey-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.localStorage?.setItem(JOURNEY_SESSION_KEY, created);
    return created;
  } catch {
    return `nv-journey-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function journeySource() {
  const platform = window?.Capacitor?.getPlatform?.();
  return platform === 'ios' || platform === 'android' ? platform : 'web';
}

function journeyEventId(eventName) {
  const unique = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `customer:${eventName}:${unique}`;
}

function recordJourneyActivity(eventName, items) {
  const safeItems = Array.isArray(items) ? items.map(item => ({
    product_id: item.product_id,
    title: item.title,
    quantity: item.quantity,
    price: item.price,
  })) : [];
  base44.functions.invoke('customerJourneyAutomation', {
    action: 'record_activity',
    event_name: eventName,
    event_id: journeyEventId(eventName),
    session_id: journeySessionId(),
    source: journeySource(),
    path: `${window.location.pathname}${window.location.search}`,
    items: safeItems,
  }).catch(() => {
    // Journey analytics must never interrupt shopping or checkout.
  });
}

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
  const cartTrackingTimerRef = useRef(null);
  const hasObservedInitialCartRef = useRef(false);

  useEffect(() => {
    storeCart(items);
    const isInitialObservation = !hasObservedInitialCartRef.current;
    hasObservedInitialCartRef.current = true;
    if (isInitialObservation && items.length === 0) return undefined;

    if (cartTrackingTimerRef.current) window.clearTimeout(cartTrackingTimerRef.current);
    cartTrackingTimerRef.current = window.setTimeout(() => {
      recordJourneyActivity(items.length > 0 ? 'cart_updated' : 'cart_cleared', items);
    }, 750);
    return () => {
      if (cartTrackingTimerRef.current) window.clearTimeout(cartTrackingTimerRef.current);
    };
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
  const trackCheckoutStarted = () => {
    if (items.length > 0) recordJourneyActivity('checkout_started', items);
  };

  const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);

  return (
    <CartContext.Provider value={{
      items, addItem, removeItem, updateQuantity, updateBundleComposition, clearCart, trackCheckoutStarted, subtotal, itemCount
    }}>
      {children}
    </CartContext.Provider>
  );
}

export const useCart = () => useContext(CartContext);
