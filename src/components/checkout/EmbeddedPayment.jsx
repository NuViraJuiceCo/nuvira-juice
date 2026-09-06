import React, { useEffect, useState, useMemo } from 'react';
import { CheckoutAction } from '@/components/checkout/CheckoutExperience';
import { Capacitor } from '@capacitor/core';
import { loadStripe } from '@stripe/stripe-js';
import { confirmNativeApplePayPayment, getNativeApplePayAvailability, isNativeApplePayPlatform, paymentIntentIdFromClientSecret } from '@/lib/nativeApplePay';
import { confirmNativeGooglePayPayment, getNativeGooglePayAvailability, isNativeGooglePayPlatform } from '@/lib/nativeGooglePay';
import {
  Elements,
  CardNumberElement,
  CardExpiryElement,
  CardCvcElement,
  ExpressCheckoutElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';

// Inner form — must be inside <Elements>
function PaymentForm({
  total,
  clientSecret,
  publishableKey,
  customerName,
  customerEmail,
  customerPhone,
  onSuccess,
  onError,
  isSubmitting,
  setIsSubmitting,
  onWalletStatus,
  onPaymentAttempt,
  confirmLabel,
  showWalletDiagnostics,
}) {
  const stripe   = useStripe();
  const elements = useElements();
  const [errorMsg, setErrorMsg] = useState('');
  const [expressReady, setExpressReady] = useState(false);
  const [expressAvailable, setExpressAvailable] = useState(false);
  const [nativeApplePayStatus, setNativeApplePayStatus] = useState({
    ready: false,
    available: false,
    reason: '',
    deviceSupportsApplePay: false,
    canMakePayments: false,
    canMakeCardPayments: false,
    merchantIdentifierConfigured: false,
  });
  const [nativeGooglePayStatus, setNativeGooglePayStatus] = useState({
    ready: false,
    available: false,
    reason: '',
  });

  useEffect(() => {
    let isMounted = true;
    if (!isNativeApplePayPlatform()) {
      setNativeApplePayStatus({
        ready: true,
        available: false,
        reason: 'not_ios_native',
        deviceSupportsApplePay: false,
        canMakePayments: false,
        canMakeCardPayments: false,
        merchantIdentifierConfigured: false,
      });
      return () => { isMounted = false; };
    }

    getNativeApplePayAvailability().then((status) => {
      if (!isMounted) return;
      setNativeApplePayStatus({ ready: true, ...status });
    });

    return () => { isMounted = false; };
  }, []);

  useEffect(() => {
    let isMounted = true;
    if (!isNativeGooglePayPlatform()) {
      setNativeGooglePayStatus({ ready: true, available: false, reason: 'not_android_native' });
      return () => { isMounted = false; };
    }

    getNativeGooglePayAvailability(publishableKey).then((status) => {
      if (!isMounted) return;
      setNativeGooglePayStatus({ ready: true, ...status });
    });

    return () => { isMounted = false; };
  }, [publishableKey]);

  // Handle Express Checkout (Apple Pay / Google Pay) confirmation
  // ExpressCheckoutElement calls this after the user authorizes in the wallet sheet.
  // The express element has already collected the payment method — just confirm the PI.
  const handleExpressConfirm = async (event) => {
    if (!stripe) return;
    onPaymentAttempt?.(event?.expressPaymentType || 'Express wallet');
    setIsSubmitting(true);
    setErrorMsg('');

    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      clientSecret,
      confirmParams: {
        return_url: window.location.origin + '/order-confirmation',
        payment_method_data: {
          billing_details: {
            name: customerName || undefined,
            email: customerEmail || undefined,
            phone: customerPhone || undefined,
          },
        },
      },
      redirect: 'if_required',
    });

    if (error) {
      setErrorMsg(error.message || 'Payment failed. Please try again.');
      setIsSubmitting(false);
      onError(error.message);
    } else if (paymentIntent?.status === 'succeeded' || paymentIntent?.status === 'requires_capture') {
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

    onPaymentAttempt?.('Card');
    setIsSubmitting(true);
    setErrorMsg('');

    const cardElement = elements.getElement(CardNumberElement);
    const { error, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
      payment_method: {
        card: cardElement,
        billing_details: {
          name: customerName || undefined,
          email: customerEmail || undefined,
          phone: customerPhone || undefined,
        },
      },
    });

    if (error) {
      setErrorMsg(error.message || 'Payment failed. Please try again.');
      setIsSubmitting(false);
      onError(error.message);
    } else if (paymentIntent?.status === 'succeeded' || paymentIntent?.status === 'requires_capture') {
      // requires_capture = Zone 3 manual hold authorized successfully
      onSuccess(paymentIntent.id);
    } else {
      setErrorMsg('Payment not completed. Please try again.');
      setIsSubmitting(false);
    }
  };

  const handleNativeApplePay = async () => {
    onPaymentAttempt?.('Apple Pay');
    setIsSubmitting(true);
    setErrorMsg('');

    try {
      const result = await confirmNativeApplePayPayment({
        clientSecret,
        publishableKey,
        total,
        customerName,
        customerEmail,
        customerPhone,
      });

      const resolvedPaymentIntentId = result?.paymentIntentId || paymentIntentIdFromClientSecret(clientSecret);
      if (result?.status === 'success' && resolvedPaymentIntentId) {
        onSuccess(resolvedPaymentIntentId);
        return;
      }

      throw new Error('Apple Pay did not complete. Please try again.');
    } catch (error) {
      if (error?.code === 'USER_CANCELED') {
        setErrorMsg('');
      } else {
        const message = error?.message || 'Apple Pay failed. Please try again.';
        setErrorMsg(message);
        onError(message);
      }
      setIsSubmitting(false);
    }
  };

  const handleNativeGooglePay = async () => {
    onPaymentAttempt?.('Google Pay');
    setIsSubmitting(true);
    setErrorMsg('');

    try {
      const result = await confirmNativeGooglePayPayment({ clientSecret, publishableKey });
      if (result?.status === 'success' && result?.paymentIntentId) {
        onSuccess(result.paymentIntentId);
        return;
      }
      throw new Error('Google Pay did not complete. Please try again.');
    } catch (error) {
      if (error?.code === 'USER_CANCELED') {
        setErrorMsg('');
      } else {
        const message = error?.message || 'Google Pay failed. Please try again.';
        setErrorMsg(message);
        onError(message);
      }
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

  const formatDiagnosticBool = (value) => (value ? 'yes' : 'no');
  const formatDiagnosticText = (value) => String(value ?? 'unknown');
  const nativeGooglePayPreferred = isNativeGooglePayPlatform() && nativeGooglePayStatus.available;

  return (
    <div className="space-y-4">
      {nativeApplePayStatus.available && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Apple Pay</p>
          <button
            type="button"
            onClick={handleNativeApplePay}
            disabled={isSubmitting}
            className="w-full h-12 rounded-xl bg-black text-white font-semibold text-sm inline-flex items-center justify-center shadow disabled:pointer-events-none disabled:opacity-50"
          >
            {isSubmitting ? 'Opening Apple Pay…' : `Pay $${total.toFixed(2)} with Apple Pay`}
          </button>
        </div>
      )}

      {nativeGooglePayStatus.available && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Google Pay</p>
          <button
            type="button"
            onClick={handleNativeGooglePay}
            disabled={isSubmitting}
            className="w-full h-12 rounded-xl bg-black text-white font-semibold text-sm inline-flex items-center justify-center shadow disabled:pointer-events-none disabled:opacity-50"
          >
            {isSubmitting ? 'Opening Google Pay…' : `Pay $${total.toFixed(2)} with Google Pay`}
          </button>
        </div>
      )}

      {/* Express Checkout — Apple Pay / Google Pay. Collapse the section if Stripe reports no wallet methods. */}
      {!nativeGooglePayPreferred && (!expressReady || expressAvailable) && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Wallet Checkout</p>
          <div style={{ minHeight: '48px' }}>
            <ExpressCheckoutElement
              onConfirm={handleExpressConfirm}
              onReady={({ availablePaymentMethods }) => {
                const methods = availablePaymentMethods || {};
                const hasExpress = Object.values(methods).some(Boolean);
                setExpressReady(true);
                setExpressAvailable(hasExpress);
                if (onWalletStatus) onWalletStatus({ mounted: true, ready: true, available: hasExpress, methods });
              }}
              onLoadError={(err) => {
                const errorMessage = err?.error?.message || 'load_error';
                console.error('[ExpressCheckout] onLoadError:', err);
                setExpressReady(true);
                setExpressAvailable(false);
                if (onWalletStatus) onWalletStatus({ mounted: false, ready: true, available: false, methods: {}, error: errorMessage });
              }}
              options={{
                buttonType: { applePay: 'buy', googlePay: 'buy' },
                layout: { maxColumns: 1, maxRows: 3, overflow: 'auto' },
                paymentMethods: { applePay: 'always', googlePay: 'always', link: 'auto' },
              }}
            />
          </div>
        </div>
      )}

      {/* Divider — only shown when express wallets are available */}
      {expressAvailable && (
        <div className="flex items-center gap-3 my-1">
          <div className="flex-1 h-px bg-border" />
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">or pay with card</span>
          <div className="flex-1 h-px bg-border" />
        </div>
      )}

      {showWalletDiagnostics && expressReady && !expressAvailable && (
        <div className="rounded-xl border border-amber-300/70 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-950">
          <p className="font-semibold">Admin wallet diagnostic: Stripe reported no eligible wallet buttons for this checkout environment.</p>
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px]">
            <span>apple_pay</span>
            <span>{formatDiagnosticBool(false)}</span>
            <span>google_pay</span>
            <span>{formatDiagnosticBool(false)}</span>
            <span>link</span>
            <span>{formatDiagnosticBool(false)}</span>
            <span>native_apple_pay</span>
            <span>{nativeApplePayStatus.ready ? formatDiagnosticBool(nativeApplePayStatus.available) : 'checking'}</span>
            <span>native_reason</span>
            <span>{formatDiagnosticText(nativeApplePayStatus.reason)}</span>
            <span>native_device</span>
            <span>{formatDiagnosticBool(nativeApplePayStatus.deviceSupportsApplePay)}</span>
            <span>native_wallet</span>
            <span>{formatDiagnosticBool(nativeApplePayStatus.canMakePayments)}</span>
            <span>native_card</span>
            <span>{formatDiagnosticBool(nativeApplePayStatus.canMakeCardPayments)}</span>
            <span>native_merchant</span>
            <span>{formatDiagnosticBool(nativeApplePayStatus.merchantIdentifierConfigured)}</span>
            <span>native_google_pay</span>
            <span>{nativeGooglePayStatus.ready ? formatDiagnosticBool(nativeGooglePayStatus.available) : 'checking'}</span>
            <span>google_pay_reason</span>
            <span>{formatDiagnosticText(nativeGooglePayStatus.reason)}</span>
          </div>
          <p className="mt-2 text-amber-900/80">Card checkout remains active. Verify Stripe mode, wallet setup, and the eligible native or browser environment before releasing wallet messaging.</p>
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

        <CheckoutAction><button
          type="submit"
          disabled={!stripe || isSubmitting}
          className="w-full h-12 rounded-xl font-semibold text-sm inline-flex items-center justify-center bg-primary text-primary-foreground shadow hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
        >
          {isSubmitting ? 'Processing…' : (confirmLabel || `Pay $${total.toFixed(2)}`)}
        </button></CheckoutAction>

        <p className="text-center text-[10px] text-muted-foreground">
          {nativeApplePayStatus.available || nativeGooglePayStatus.available || expressAvailable
            ? `${nativeApplePayStatus.available ? 'Apple Pay · ' : ''}${nativeGooglePayStatus.available ? 'Google Pay · ' : ''}Card — Secured by Stripe`
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
export default function EmbeddedPayment({
  clientSecret,
  publishableKey,
  total,
  customerName = '',
  customerEmail = '',
  customerPhone = '',
  onSuccess,
  onError,
  isSubmitting,
  setIsSubmitting,
  onPaymentAttempt = undefined,
  confirmLabel = undefined,
  showWalletDiagnostics = false,
}) {
  const stripePromise = useMemo(() => publishableKey ? loadStripe(publishableKey) : null, [publishableKey]);
  const [walletStatus, setWalletStatus] = useState(null); // { mounted: bool, methods: { applePay, googlePay, link, ... } }

  const isIframe = typeof window !== 'undefined' && window.self !== window.top;
  const origin = typeof window !== 'undefined' ? window.location.origin : 'unknown';
  const protocol = typeof window !== 'undefined' ? window.location.protocol : 'unknown';
  const isNative = Capacitor.isNativePlatform?.() === true;
  const showDebug = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debug') === '1';

  // Early return AFTER all hooks
  if (!clientSecret || !stripePromise) return null;

  /** @type {import('@stripe/stripe-js').Appearance} */
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
      {/* Debug bar — hidden in production, visible with ?debug=1 in URL */}
      {showDebug && (
        <div className="mb-3 rounded-xl border border-cyan-400 bg-cyan-50 px-3 py-2 text-[11px] text-cyan-800 space-y-0.5">
          <div><span className="font-semibold">Origin:</span> {origin}</div>
          <div><span className="font-semibold">Protocol:</span> {protocol}</div>
          <div><span className="font-semibold">Native shell:</span> {isNative ? 'YES' : 'No'}</div>
          <div><span className="font-semibold">In iframe:</span> {isIframe ? 'YES ⚠️' : 'No'}</div>
          <div><span className="font-semibold">PaymentIntent client secret:</span> present</div>
          <div><span className="font-semibold">Key mode:</span> {publishableKey?.startsWith('pk_live') ? 'LIVE ✅' : 'TEST ⚠️'}</div>
          <div><span className="font-semibold">ExpressCheckout mounted:</span> {walletStatus ? 'true ✅' : 'false ❌'}</div>
          <div><span className="font-semibold">Apple Pay available:</span> {fmt(walletStatus?.methods?.applePay)}</div>
          <div><span className="font-semibold">Google Pay available:</span> {fmt(walletStatus?.methods?.googlePay)}</div>
          <div><span className="font-semibold">Link available:</span> {fmt(walletStatus?.methods?.link)}</div>
        </div>
      )}

      <Elements
        stripe={stripePromise}
        options={{ clientSecret, appearance, locale: 'en' }}
      >
        <PaymentForm
          total={total}
          clientSecret={clientSecret}
          publishableKey={publishableKey}
          customerName={customerName}
          customerEmail={customerEmail}
          customerPhone={customerPhone}
          onSuccess={onSuccess}
          onError={onError}
          isSubmitting={isSubmitting}
          setIsSubmitting={setIsSubmitting}
          onWalletStatus={setWalletStatus}
          onPaymentAttempt={onPaymentAttempt}
          confirmLabel={confirmLabel}
          showWalletDiagnostics={showWalletDiagnostics}
        />
      </Elements>
    </div>
  );
}
