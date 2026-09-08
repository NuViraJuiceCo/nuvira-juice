import React, { useEffect, useMemo, useRef, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from '@stripe/react-stripe-js';

// No PaymentElement or confirmPayment: a no-cost Session has no PaymentIntent.
// onComplete navigates to the existing server-backed confirmation read; it does
// not mark an order paid, deduct points, or emit Purchase/AddPaymentInfo events.
export default function RewardEmbeddedCheckout({ clientSecret, publishableKey, checkoutSessionId, onComplete }) {
  const [provider, setProvider] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const completionRef = useRef(false);
  const activeSecretRef = useRef(null);
  const callbackRef = useRef(onComplete);
  callbackRef.current = onComplete;
  const valid = /^cs_[A-Za-z0-9_]+$/.test(checkoutSessionId || '')
    && typeof clientSecret === 'string' && clientSecret.startsWith(`${checkoutSessionId}_secret_`)
    && /^pk_(live|test)_/.test(publishableKey || '');

  useEffect(() => {
    let active = true;
    activeSecretRef.current = clientSecret;
    completionRef.current = false;
    setProvider(null);
    setLoadError(false);
    if (valid) {
      void Promise.resolve().then(() => loadStripe(publishableKey)).then(stripe => {
        if (!active) return;
        if (stripe) setProvider(stripe); else setLoadError(true);
      }).catch(() => { if (active) setLoadError(true); });
    }
    return () => { active = false; activeSecretRef.current = null; };
  }, [valid, publishableKey, checkoutSessionId, clientSecret]);

  const options = useMemo(() => ({ clientSecret, onComplete: () => {
    if (completionRef.current || activeSecretRef.current !== clientSecret) return;
    completionRef.current = true;
    callbackRef.current?.(checkoutSessionId);
  } }), [clientSecret, checkoutSessionId]);

  if (!valid || loadError) return <div role="alert" className="rounded-xl border border-destructive/30 p-4 text-sm">
    Secure reward checkout could not load. Your order has not been confirmed here. Please check your orders before retrying.
  </div>;
  if (!provider) return <p role="status" aria-live="polite" className="py-8 text-center text-sm text-muted-foreground">
    Loading your secure reward checkout…
  </p>;
  return <div className="overflow-hidden rounded-2xl border border-primary/20 bg-background">
    <EmbeddedCheckoutProvider stripe={provider} options={options}><EmbeddedCheckout /></EmbeddedCheckoutProvider>
  </div>;
}
