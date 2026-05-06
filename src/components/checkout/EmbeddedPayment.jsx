import React, { useState, useMemo } from 'react';
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

// Inner form — must be inside <Elements>
function PaymentForm({ total, clientSecret, onSuccess, onError, isSubmitting, setIsSubmitting, onWalletStatus }) {
  const stripe   = useStripe();
  const elements = useElements();
  const [errorMsg, setErrorMsg] = useState('');
  const [expressAvailable, setExpressAvailable] = useState(false);
  const [expressMounted, setExpressMounted] = useState(false);

  // Handle Express Checkout (Apple Pay / Google Pay) confirmation
  // ExpressCheckoutElement calls this after the user authorizes in the wallet sheet.
  // The express element has already collected the payment method — just confirm the PI.
  const handleExpressConfirm = async (event) => {
    if (!stripe) return;
    setIsSubmitting(true);
    setErrorMsg('');

    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      clientSecret,
      confirmParams: { return_url: window.location.origin + '/order-confirmation' },
      redirect: 'if_required',
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

  // Handle standard card form submission using CardElement
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setIsSubmitting(true);
    setErrorMsg('');

    const cardElement = elements.getElement(CardNumberElement);
    const { error, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
      payment_method: { card: cardElement },
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

  return (
    <div className="space-y-4">
      {/* Express Checkout — Apple Pay / Google Pay — always rendered, never hidden */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Wallet Checkout</p>
        <div style={{ minHeight: '48px' }}>
          <ExpressCheckoutElement
            onConfirm={handleExpressConfirm}
            onReady={({ availablePaymentMethods }) => {
              const methods = availablePaymentMethods || {};
              const hasExpress = Object.values(methods).some(Boolean);
              setExpressAvailable(hasExpress);
              setExpressMounted(true);
              if (onWalletStatus) onWalletStatus({ mounted: true, methods });
            }}
            onLoadError={(err) => {
              console.error('[ExpressCheckout] onLoadError:', err);
              if (onWalletStatus) onWalletStatus({ mounted: false, methods: {}, error: err?.message });
            }}
            options={{
              buttonType: { applePay: 'buy', googlePay: 'buy' },
              layout: { maxColumns: 1, maxRows: 3, overflow: 'auto' },
              wallets: { applePay: 'always', googlePay: 'always' },
            }}
          />
        </div>
      </div>

      {/* Divider — only shown when express wallets are available */}
      {expressAvailable && (
        <div className="flex items-center gap-3 my-1">
          <div className="flex-1 h-px bg-border" />
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">or pay with card</span>
          <div className="flex-1 h-px bg-border" />
        </div>
      )}

      {/* Card-only form — CardNumberElement/CardExpiryElement/CardCvcElement (no Bank/Klarna/ACH possible) */}
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
          disabled={!stripe || isSubmitting}
          className="w-full h-12 rounded-xl font-semibold text-sm"
        >
          {isSubmitting ? 'Processing Payment…' : `Pay $${total.toFixed(2)}`}
        </Button>

        <p className="text-center text-[10px] text-muted-foreground">
          {expressAvailable
            ? 'Apple Pay · Google Pay · Card — Secured by Stripe'
            : 'Card — Secured by Stripe'}
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
  const [walletStatus, setWalletStatus] = useState(null); // { mounted: bool, methods: { applePay, googlePay, link, ... } }

  const piId = clientSecret ? clientSecret.split('_secret_')[0] : null;
  const isIframe = typeof window !== 'undefined' && window.self !== window.top;
  const origin = typeof window !== 'undefined' ? window.location.origin : 'unknown';

  // Early return AFTER all hooks
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

  const fmt = (val) => {
    if (walletStatus === null) return 'not ready';
    return val ? 'true ✅' : 'false ❌';
  };

  return (
    <div>
      {/* Temporary debug bar — remove once Apple Pay domain is confirmed */}
      <div className="mb-3 rounded-xl border border-amber-400 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 space-y-0.5">
        <div><span className="font-semibold">Origin:</span> {origin}</div>
        <div><span className="font-semibold">In iframe:</span> {isIframe ? 'YES ⚠️' : 'No'}</div>
        <div><span className="font-semibold">PI:</span> {piId}</div>
        <div><span className="font-semibold">Key mode:</span> {publishableKey?.startsWith('pk_live') ? 'LIVE ✅' : 'TEST ⚠️'}</div>
        <div><span className="font-semibold">ExpressCheckout mounted:</span> {walletStatus ? 'true ✅' : 'false ❌'}</div>
        <div><span className="font-semibold">Apple Pay available:</span> {fmt(walletStatus?.methods?.applePay)}</div>
        <div><span className="font-semibold">Google Pay available:</span> {fmt(walletStatus?.methods?.googlePay)}</div>
        <div><span className="font-semibold">Link available:</span> {fmt(walletStatus?.methods?.link)}</div>
      </div>

      <Elements
        stripe={stripePromise}
        options={{ clientSecret, appearance, locale: 'en' }}
      >
        <PaymentForm
          total={total}
          clientSecret={clientSecret}
          onSuccess={onSuccess}
          onError={onError}
          isSubmitting={isSubmitting}
          setIsSubmitting={setIsSubmitting}
          onWalletStatus={setWalletStatus}
        />
      </Elements>
    </div>
  );
}