import React, { useMemo, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import {
  Elements,
  CardNumberElement,
  CardExpiryElement,
  CardCvcElement,
  ExpressCheckoutElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import { Button } from '@/components/ui/button';
import { CheckCircle2, Lock } from 'lucide-react';

/**
 * SubscriptionPaymentPanel
 *
 * In-app payment form for subscription checkout.
 * Uses the same Card Element pattern as one-time order EmbeddedPayment.
 * No iframes, no redirects — customer stays in the app.
 *
 * Props:
 *   clientSecret: string — PaymentIntent client_secret from createSubscriptionPaymentElementIntent
 *   publishableKey: string
 *   amountDue: number — dollars (e.g. 36.00)
 *   planName: string
 *   stripeSubscriptionId: string
 *   onSuccess: (paymentIntentId: string) => void
 *   onCancel: () => void
 */

function PaymentForm({ amountDue, planName, clientSecret, onSuccess, onCancel }) {
  const stripe = useStripe();
  const elements = useElements();
  const [errorMsg, setErrorMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [expressAvailable, setExpressAvailable] = useState(false);

  const cardElementStyle = {
    style: {
      base: {
        fontSize: '16px',
        fontFamily: 'Inter, sans-serif',
        color: '#1a2e23',
        '::placeholder': { color: '#a0aec0' },
      },
      invalid: { color: '#e53e3e' },
    },
  };

  const handleExpressConfirm = async () => {
    if (!stripe) return;
    setSubmitting(true);
    setErrorMsg('');

    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      clientSecret,
      confirmParams: { return_url: window.location.origin + '/account/subscriptions' },
      redirect: 'if_required',
    });

    if (error) {
      setErrorMsg(error.message || 'Payment failed. Please try again.');
      setSubmitting(false);
    } else if (paymentIntent?.status === 'succeeded') {
      onSuccess(paymentIntent.id);
    } else {
      setErrorMsg('Payment not completed. Please try again.');
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setSubmitting(true);
    setErrorMsg('');

    const cardElement = elements.getElement(CardNumberElement);
    const { error, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
      payment_method: { card: cardElement },
    });

    if (error) {
      setErrorMsg(error.message || 'Payment failed. Please try again.');
      setSubmitting(false);
    } else if (paymentIntent?.status === 'succeeded' || paymentIntent?.status === 'processing') {
      // 'processing' is valid for some payment methods — webhook will fire invoice.payment_succeeded
      onSuccess(paymentIntent.id);
    } else if (paymentIntent?.status === 'requires_action') {
      // 3DS or additional authentication needed — Stripe.js handles the UI automatically
      // confirmCardPayment already handles requires_action internally, so this is a fallback
      setErrorMsg('Additional authentication required. Please follow the prompts and try again.');
      setSubmitting(false);
    } else {
      setErrorMsg('Payment not completed. Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Plan summary */}
      <div className="flex items-center justify-between bg-primary/10 border border-primary/20 rounded-xl px-4 py-3">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
          <span className="text-sm font-semibold">{planName}</span>
        </div>
        <span className="text-sm font-bold text-primary">${amountDue.toFixed(2)}</span>
      </div>

      {/* Express Checkout */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Wallet Checkout</p>
        <div style={{ minHeight: '48px' }}>
          <ExpressCheckoutElement
            onConfirm={handleExpressConfirm}
            onReady={({ availablePaymentMethods }) => {
              const methods = availablePaymentMethods || {};
              setExpressAvailable(Object.values(methods).some(Boolean));
            }}
            onLoadError={(err) => console.error('[SubPE Express] error:', err)}
            options={{
              buttonType: { applePay: 'subscribe', googlePay: 'subscribe' },
              layout: { maxColumns: 1, maxRows: 3, overflow: 'auto' },
              wallets: { applePay: 'always', googlePay: 'always' },
            }}
          />
        </div>
      </div>

      {expressAvailable && (
        <div className="flex items-center gap-3 my-1">
          <div className="flex-1 h-px bg-border" />
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">or pay with card</span>
          <div className="flex-1 h-px bg-border" />
        </div>
      )}

      {/* Card form */}
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Card number</label>
          <div className="border border-input rounded-xl px-3 py-3 bg-white">
            <CardNumberElement options={cardElementStyle} />
          </div>
        </div>
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="text-xs text-muted-foreground mb-1 block">Expiry</label>
            <div className="border border-input rounded-xl px-3 py-3 bg-white">
              <CardExpiryElement options={cardElementStyle} />
            </div>
          </div>
          <div className="flex-1">
            <label className="text-xs text-muted-foreground mb-1 block">CVC</label>
            <div className="border border-input rounded-xl px-3 py-3 bg-white">
              <CardCvcElement options={cardElementStyle} />
            </div>
          </div>
        </div>

        {errorMsg && (
          <div className="bg-destructive/10 border border-destructive/30 rounded-xl px-3 py-2.5">
            <p className="text-xs text-destructive font-medium">{errorMsg}</p>
          </div>
        )}

        <Button
          type="submit"
          disabled={!stripe || submitting}
          className="w-full h-12 rounded-xl font-semibold text-sm"
        >
          {submitting ? 'Processing Payment…' : `Subscribe — $${amountDue.toFixed(2)}`}
        </Button>
      </form>

      <button
        onClick={onCancel}
        disabled={submitting}
        className="w-full text-center text-xs text-muted-foreground py-1 hover:text-foreground transition-colors"
      >
        Cancel
      </button>

      <div className="flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground">
        <Lock className="w-3 h-3" />
        <span>Secured by Stripe · No commitments · Cancel anytime</span>
      </div>
    </div>
  );
}

export default function SubscriptionPaymentPanel({ clientSecret, publishableKey, amountDue, planName, stripeSubscriptionId, onSuccess, onCancel }) {
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

  // mode + amount + currency required for ExpressCheckoutElement (Apple Pay / Google Pay) to render correctly
  const elementsOptions = {
    clientSecret,
    appearance,
    locale: 'en',
    mode: 'subscription',
    amount: Math.round(amountDue * 100), // cents
    currency: 'usd',
  };

  return (
    <div className="bg-card border border-border/40 rounded-2xl p-5 mt-4">
      <div className="flex items-center gap-2 mb-4">
        <Lock className="w-3.5 h-3.5 text-primary" />
        <span className="font-heading text-base font-semibold">Complete Subscription</span>
      </div>
      <Elements stripe={stripePromise} options={elementsOptions}>
        <PaymentForm
          amountDue={amountDue}
          planName={planName}
          clientSecret={clientSecret}
          onSuccess={onSuccess}
          onCancel={onCancel}
        />
      </Elements>
    </div>
  );
}