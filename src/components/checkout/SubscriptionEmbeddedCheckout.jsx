import React, { useMemo, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { loadStripe } from '@stripe/stripe-js';
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from '@stripe/react-stripe-js';
import { X, Lock, Loader2 } from 'lucide-react';

export default function SubscriptionEmbeddedCheckout({ clientSecret, publishableKey, onClose }) {
  const [stripeReady, setStripeReady] = useState(false);
  const [stripeError, setStripeError] = useState(null);
  const scrollRef = useRef(null);

  const stripePromise = useMemo(() => {
    if (!publishableKey) return null;
    return loadStripe(publishableKey);
  }, [publishableKey]);

  // Lock body scroll
  useEffect(() => {
    const savedScrollY = window.scrollY;
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${savedScrollY}px`;
    document.body.style.width = '100%';

    return () => {
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
      window.scrollTo(0, savedScrollY);
    };
  }, []);

  // Validate clientSecret
  useEffect(() => {
    if (!clientSecret || !publishableKey) {
      setStripeError('Checkout session could not be started. Please go back and try again.');
      return;
    }
    setStripeReady(true);
  }, [clientSecret, publishableKey]);

  // Pass clientSecret directly (NOT fetchClientSecret callback)
  const stripeOptions = useMemo(() => ({ clientSecret }), [clientSecret]);

  const overlay = (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 99999,
        display: 'flex',
        flexDirection: 'column',
        width: '100vw',
        height: '100dvh',
        backgroundColor: 'hsl(var(--background))',
      }}
    >
      {/* Safe-area top + header */}
      <div
        style={{
          flexShrink: 0,
          paddingTop: 'env(safe-area-inset-top)',
          backgroundColor: 'hsl(var(--background))',
          borderBottom: '1px solid hsl(var(--border) / 0.4)',
        }}
      >
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <Lock className="w-3.5 h-3.5 text-primary" />
            <span className="font-heading text-base font-semibold">Complete Subscription</span>
          </div>
          <button
            onClick={onClose}
            style={{ touchAction: 'manipulation' }}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-muted active:bg-secondary transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Scrollable body */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          overscrollBehavior: 'contain',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        {stripeError ? (
          <div className="flex flex-col items-center justify-center min-h-[300px] px-6 text-center gap-4">
            <p className="text-sm text-destructive font-medium">{stripeError}</p>
            <button onClick={onClose} className="text-sm font-semibold text-primary underline">
              Go back
            </button>
          </div>
        ) : !stripeReady ? (
          <div className="flex flex-col items-center justify-center min-h-[300px] gap-3">
            <Loader2 className="w-6 h-6 text-primary animate-spin" />
            <p className="text-sm text-muted-foreground">Loading secure checkout...</p>
          </div>
        ) : (
          <EmbeddedCheckoutProvider stripe={stripePromise} options={stripeOptions}>
            <EmbeddedCheckout />
          </EmbeddedCheckoutProvider>
        )}
      </div>
    </div>
  );

  // Portal to document.body so it escapes any scroll/stacking context on the page
  return createPortal(overlay, document.body);
}