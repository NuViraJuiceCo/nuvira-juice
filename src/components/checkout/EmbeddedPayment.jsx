import React, { useState, useMemo } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { Button } from '@/components/ui/button';

// Inner form — must be inside <Elements>
function PaymentForm({ total, onSuccess, onError, isSubmitting, setIsSubmitting }) {
  const stripe   = useStripe();
  const elements = useElements();
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setIsSubmitting(true);
    setErrorMsg('');

    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: 'if_required', // stay in-app, no redirect
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
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement
        options={{
          layout: 'tabs',
          wallets: { applePay: 'auto', googlePay: 'auto' },
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
        Secured by Stripe · Your card info never touches NuVira servers
      </p>
    </form>
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