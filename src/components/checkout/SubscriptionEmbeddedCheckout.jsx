import React, { useMemo, useCallback } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from '@stripe/react-stripe-js';
import { X } from 'lucide-react';

/**
 * SubscriptionEmbeddedCheckout
 * 
 * Renders Stripe's full embedded checkout inside a bottom sheet.
 * Uses ui_mode='embedded' checkout session — handles all card/wallet input.
 * 
 * Props:
 *   clientSecret: string — from createSubscriptionPaymentIntent
 *   publishableKey: string — Stripe publishable key
 *   onClose: () => void — called when customer cancels
 */
export default function SubscriptionEmbeddedCheckout({ clientSecret, publishableKey, onClose }) {
  const stripePromise = useMemo(
    () => publishableKey ? loadStripe(publishableKey) : null,
    [publishableKey]
  );

  const fetchClientSecret = useCallback(() => Promise.resolve(clientSecret), [clientSecret]);

  if (!clientSecret || !stripePromise) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40 bg-background shrink-0">
        <span className="font-heading text-base font-semibold">Complete Subscription</span>
        <button
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center rounded-full bg-muted hover:bg-secondary transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Stripe Embedded Checkout fills remaining space */}
      <div className="flex-1 overflow-auto">
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