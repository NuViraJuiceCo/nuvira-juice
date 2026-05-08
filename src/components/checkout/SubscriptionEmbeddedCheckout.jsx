import React, { useMemo, useCallback, useEffect, useRef } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from '@stripe/react-stripe-js';
import { X } from 'lucide-react';

export default function SubscriptionEmbeddedCheckout({ clientSecret, publishableKey, onClose }) {
  const stripePromise = useMemo(
    () => publishableKey ? loadStripe(publishableKey) : null,
    [publishableKey]
  );
  const fetchClientSecret = useCallback(() => Promise.resolve(clientSecret), [clientSecret]);
  const scrollRef = useRef(null);

  // Lock body scroll and reset page scroll position when overlay opens
  useEffect(() => {
    // Save current scroll position and lock body
    const savedScrollY = window.scrollY;
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${savedScrollY}px`;
    document.body.style.width = '100%';

    // Reset the overlay's own scroll container to top
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
    });

    return () => {
      // Restore body scroll position on close
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
      window.scrollTo(0, savedScrollY);
    };
  }, []);

  if (!clientSecret || !stripePromise) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        height: '100dvh',
        backgroundColor: 'hsl(var(--background))',
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {/* Header — always visible at top */}
      <div style={{ flexShrink: 0 }} className="flex items-center justify-between px-4 py-3 border-b border-border/40 bg-background">
        <span className="font-heading text-base font-semibold">Complete Subscription</span>
        <button
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center rounded-full bg-muted hover:bg-secondary transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Stripe Embedded Checkout — scrollable content area */}
      <div
        ref={scrollRef}
        style={{ flex: 1, overflowY: 'auto', overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }}
      >
        <EmbeddedCheckoutProvider
          stripe={stripePromise}
          options={{ fetchClientSecret }}
        >
          <EmbeddedCheckout />
        </EmbeddedCheckoutProvider>
      </div>
    </div>
  );
}