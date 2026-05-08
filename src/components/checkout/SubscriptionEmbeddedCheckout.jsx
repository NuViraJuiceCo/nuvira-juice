import React, { useMemo, useEffect, useRef, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from '@stripe/react-stripe-js';
import { X, Lock, Loader2 } from 'lucide-react';

export default function SubscriptionEmbeddedCheckout({ clientSecret, publishableKey, onClose }) {
  const [stripeReady, setStripeReady] = useState(false);
  const [stripeError, setStripeError] = useState(null);
  const scrollRef = useRef(null);

  // Load stripe promise once — memoized so it doesn't reload on re-renders
  const stripePromise = useMemo(() => {
    if (!publishableKey) return null;
    return loadStripe(publishableKey);
  }, [publishableKey]);

  // Lock body scroll when overlay opens
  useEffect(() => {
    const savedScrollY = window.scrollY;
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${savedScrollY}px`;
    document.body.style.width = '100%';

    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
    });

    return () => {
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
      window.scrollTo(0, savedScrollY);
    };
  }, []);

  // Validate inputs before attempting to render Stripe
  useEffect(() => {
    if (!clientSecret) {
      setStripeError('Missing checkout session. Please go back and try again.');
      return;
    }
    if (!publishableKey) {
      setStripeError('Stripe configuration error. Please contact support.');
      return;
    }
    // clientSecret from embedded checkout sessions starts with "cs_"
    if (!clientSecret.startsWith('cs_')) {
      console.error('[SubCheckout] Invalid clientSecret format:', clientSecret?.substring(0, 20));
      setStripeError('Invalid checkout session. Please go back and try again.');
      return;
    }
    setStripeReady(true);
  }, [clientSecret, publishableKey]);

  // CRITICAL: Pass clientSecret directly as options.clientSecret (NOT fetchClientSecret)
  // Using fetchClientSecret with a pre-fetched secret causes Stripe to silently fail
  const stripeOptions = useMemo(() => ({
    clientSecret,
  }), [clientSecret]);

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
      {/* Header */}
      <div
        style={{ flexShrink: 0 }}
        className="flex items-center justify-between px-4 py-3 border-b border-border/40 bg-background"
      >
        <div className="flex items-center gap-2">
          <Lock className="w-3.5 h-3.5 text-primary" />
          <span className="font-heading text-base font-semibold">Complete Subscription</span>
        </div>
        <button
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center rounded-full bg-muted hover:bg-secondary transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Body */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {/* Error state */}
        {stripeError && (
          <div className="flex flex-col items-center justify-center min-h-[300px] px-6 text-center gap-4">
            <p className="text-sm text-destructive font-medium">{stripeError}</p>
            <button
              onClick={onClose}
              className="text-sm font-semibold text-primary underline"
            >
              Go back
            </button>
          </div>
        )}

        {/* Loading state — shown until Stripe mounts its own UI */}
        {!stripeError && !stripeReady && (
          <div className="flex flex-col items-center justify-center min-h-[300px] gap-3">
            <Loader2 className="w-6 h-6 text-primary animate-spin" />
            <p className="text-sm text-muted-foreground">Loading secure checkout...</p>
          </div>
        )}

        {/* Stripe Embedded Checkout — only renders when ready */}
        {stripeReady && stripePromise && (
          <EmbeddedCheckoutProvider
            stripe={stripePromise}
            options={stripeOptions}
          >
            <EmbeddedCheckout />
          </EmbeddedCheckoutProvider>
        )}
      </div>
    </div>
  );
}