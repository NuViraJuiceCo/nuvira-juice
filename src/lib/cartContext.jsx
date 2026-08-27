import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { trackGoogleAddToCart, trackGoogleBeginCheckout, trackGoogleRemoveFromCart } from '@/lib/googleAnalytics';
import { trackMetaAddToCart, trackMetaInitiateCheckout } from '@/lib/metaPixel';

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
    void trackGoogleAddToCart({ ...product, ...extra }, quantity);
    void trackMetaAddToCart({ ...product, ...extra }, quantity);
    setItems(prev => {
      const nextLineKey = extra.cart_line_key || product.id;
      const existing = prev.find(i => (i.cart_line_key || i.product_id) === nextLineKey);
      if (existing) {
        return prev.map(i =>
          (i.cart_line_key || i.product_id) === nextLineKey
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
        shopify_product_id: product.shopify_product_id || null,
        shopify_variant_id: product.shopify_variant_id || null,
        meta_catalog_content_id: product.meta_catalog_content_id || null,
        is_program: product.is_program || false,
        ...extra,
      }];
    });
  };

  const removeItem = (lineKey) => {
    const existing = items.find(i => (i.cart_line_key || i.product_id) === lineKey);
    if (existing) void trackGoogleRemoveFromCart(existing, existing.quantity);
    setItems(prev => prev.filter(i => (i.cart_line_key || i.product_id) !== lineKey));
  };

  const updateQuantity = (lineKey, quantity) => {
    if (quantity <= 0) {
      removeItem(lineKey);
      return;
    }
    const existing = items.find(i => (i.cart_line_key || i.product_id) === lineKey);
    if (existing && quantity < existing.quantity) {
      void trackGoogleRemoveFromCart(existing, existing.quantity - quantity);
    }
    setItems(prev =>
      prev.map(i => (i.cart_line_key || i.product_id) === lineKey ? { ...i, quantity } : i)
    );
  };

  const updateBundleComposition = (lineKey, composition) => {
    setItems(prev => prev.map(i => (i.cart_line_key || i.product_id) === lineKey ? { ...i, bundle_composition: composition } : i));
  };

  const clearCart = () => setItems([]);
  const trackCheckoutStarted = () => {
    if (items.length > 0) recordJourneyActivity('checkout_started', items);
    if (items.length > 0) void trackGoogleBeginCheckout(items, subtotal);
    if (items.length > 0) void trackMetaInitiateCheckout(items, subtotal);
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
