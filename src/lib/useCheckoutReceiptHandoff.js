import { useState } from 'react';

// Router navigation may be a transition while clearCart is an urgent update.
// Keep checkout in a terminal handoff state until the destination mounts, so
// its ordinary empty-cart safety guard cannot replace the receipt navigation.
export function useCheckoutReceiptHandoff({ clearCart, navigate }) {
  const [receiptHandoff, setReceiptHandoff] = useState(false);
  const handoffToReceipt = (destination, { clearPurchasedCart = false, ...options } = {}) => {
    setReceiptHandoff(true);
    if (clearPurchasedCart) clearCart();
    navigate(destination, options);
  };
  return { receiptHandoff, handoffToReceipt };
}
