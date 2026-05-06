import React, { useState, useMemo } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import {
  Elements,
  PaymentElement,
  ExpressCheckoutElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import { Button } from '@/components/ui/button';

// Inner form — must be inside <Elements>
function PaymentForm({ total, onSuccess, onError, isSubmitting, setIsSubmitting }) {
  const stripe   = useStripe();
  const elements = useElements();
  const [errorMsg, setErrorMsg] = useState('');
  const [expressAvailable, setExpressAvailable] = useState(false);
  const [expressDebug, setExpressDebug] = useState(null);

  // Handle Express Checkout (Apple Pay / Google Pay) confirmation
  const handleExpressConfirm = async () => {
    if (!stripe || !elements) return;
    setIsSubmitting(true);
    setErrorMsg('');

    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: 'if_required',
      confirmParams: {},
    });

    if (error) {
      setErrorMsg(error.message || 'Payment failed. Please try again.');
      setIsSubmitting(false);
      onError(error.message);
    } else if (paymentIntent?.status === 'succeeded') {
      onSuccess(paymentIntent.id);
    } else {
      setErrorMsg('Payment not completed. Please try again.');
      setIsSubmitting(false);
    }
  };

  // Handle standard card form submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setIsSubmitting(true);
    setErrorMsg('');

    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: 'if_required',
      confirmParams: {},
    });

    if (error) {
      setErrorMsg(error.message || 'Payment failed. Please try again.');
      setIsSubmitting(false);
      onError(error.message);
    } else if (paymentIntent?.status === 'succeeded') {
      onSuccess(paymentIntent.id);
    } else {
      setErrorMsg('Payment not completed. Please try again.');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Express Checkout — Apple Pay / Google Pay */}
      <ExpressCheckoutElement
        onConfirm={handleExpressConfirm}
        onReady={({ availablePaymentMethods }) => {
          const methods = availablePaymentMethods || {};
          const hasExpress = Object.values(methods).some(Boolean);
          setExpressAvailable(hasExpress);
          setExpressDebug(methods);
          // Debug log — remove after Apple Pay confirmed working
          console.log('[ExpressCheckout] onReady availablePaymentMethods:', JSON.stringify(methods));
          console.log('[ExpressCheckout] applePay:', methods.applePay, '| googlePay:', methods.googlePay, '| link:', methods.link);
          console.log('[ExpressCheckout] domain:', window.location.hostname);
          if (!hasExpress) {
            console.warn('[ExpressCheckout] No express methods available. Apple Pay requires: Safari, verified domain in Stripe Dashboard (nuvirajuice.com), Apple Pay set up in Wallet, Live Mode enabled.');
          }
        }}
        options={{
          buttonType: { applePay: 'buy', googlePay: 'buy' },
          layout: { maxColumns: 1, maxRows: 3, overflow: 'never' },
          wallets: { applePay: 'always', googlePay: 'always' },
        }}
      />

      {/* Divider — only shown when express wallets are available */}
      {expressAvailable && (
        <div className="flex items-center gap-3 my-1">
          <div className="flex-1 h-px bg-border" />
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">or pay with card</span>
          <div className="flex-1 h-px bg-border" />
        </div>
      )}

      {/* Card / Link fallback */}
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* paymentMethodOrder restricts visible tabs to card + link only.
            Wallets (Apple Pay / Google Pay) are handled exclusively by ExpressCheckoutElement above.
            Bank, Klarna, ACH, redirects are suppressed here at the UI layer. */}
        <PaymentElement
          options={{
            layout: 'tabs',
            paymentMethodOrder: ['card', 'link'],
            wallets: { applePay: 'never', googlePay: 'never' },
            terms: { card: 'never' },
          }}
        />

        {errorMsg && (
          <div className="bg-destructive/10 border border-destructive/30 rounded-xl px-3 py-2.5">
            <p className="text-xs text-destructive font-medium">{errorMsg}</p>
          </div>
        )}

        <Button
          type="submit"
          disabled={!stripe || isSubmitting}
          className="w-full h-12 rounded-xl font-semibold text-sm"
        >
          {isSubmitting ? 'Processing Payment…' : `Pay $${total.toFixed(2)}`}
        </Button>

        <p className="text-center text-[10px] text-muted-foreground">
          {expressAvailable
            ? 'Apple Pay · Google Pay · Card · Link — Secured by Stripe'
            : 'Enter your card details above. Fast checkout with Link may be available.'}
        </p>
        <p className="text-center text-[10px] text-muted-foreground opacity-60">
          Your card info never touches NuVira servers
        </p>
      </form>
    </div>
  );
}

/**
 * EmbeddedPayment
 * Props:
 *   clientSecret: string — from createPaymentIntent response
 *   publishableKey: string — Stripe publishable key from backend
 *   total: number
 *   onSuccess: (paymentIntentId: string) => void
 *   onError: (message: string) => void
 *   isSubmitting: boolean
 *   setIsSubmitting: (v: boolean) => void
 */
export default function EmbeddedPayment({ clientSecret, publishableKey, total, onSuccess, onError, isSubmitting, setIsSubmitting }) {
  const stripePromise = useMemo(() => publishableKey ? loadStripe(publishableKey) : null, [publishableKey]);

  if (!clientSecret || !stripePromise) return null;

  const appearance = {
    theme: 'stripe',
    variables: {
      colorPrimary: '#2d6a4f',
      colorBackground: '#ffffff',
      colorText: '#1a2e23',
      borderRadius: '12px',
      fontFamily: 'Inter, sans-serif',
    },
  };

  return (
    <Elements
      stripe={stripePromise}
      options={{ clientSecret, appearance, locale: 'en' }}
    >
      <PaymentForm
        total={total}
        onSuccess={onSuccess}
        onError={onError}
        isSubmitting={isSubmitting}
        setIsSubmitting={setIsSubmitting}
      />
    </Elements>
  );
}