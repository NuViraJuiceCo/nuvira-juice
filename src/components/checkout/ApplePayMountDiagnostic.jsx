import React, { useEffect, useMemo, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, ExpressCheckoutElement } from '@stripe/react-stripe-js';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { base44 } from '@/api/base44Client';

export const APPLE_PAY_MOUNT_DIAGNOSTIC_QUERY = 'apple_pay_mount_diagnostic';
export const APPLE_PAY_MOUNT_DIAGNOSTIC_AMOUNT = 1699;
export const APPLE_PAY_MOUNT_DIAGNOSTIC_CART = Object.freeze({
  product: 'AURA',
  quantity: 1,
  subtotal: 1300,
  deliveryFee: 399,
  tax: 0,
  total: APPLE_PAY_MOUNT_DIAGNOSTIC_AMOUNT,
});

const APPLE_PAY_PUBLIC_CONFIG_PREVIEW_MODE = 'APPLE_PAY_DIAGNOSTIC_PUBLIC_CONFIG';

function buildDiagnosticRequestId() {
  const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}`;
  return `g47f_patch1_public_config_${suffix}`;
}

function isLivePublishableKey(value) {
  return typeof value === 'string' && value.trim().startsWith('pk_live_');
}

function boolStatus(value) {
  if (value === true) return 'true';
  if (value === false) return 'false';
  return 'unavailable';
}

function DiagnosticStatusRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-white/70 px-3 py-2 text-xs">
      <span className="font-medium text-slate-600">{label}</span>
      <span className="font-mono text-slate-900">{value}</span>
    </div>
  );
}

function DiagnosticExpressCheckout({ onWalletStatus }) {
  const [message, setMessage] = useState('Diagnostic preview only. Do not submit payment.');
  const [ready, setReady] = useState(false);

  const handleConfirm = (event) => {
    event?.paymentFailed?.({
      reason: 'fail',
      message: 'Diagnostic preview only. No payment was processed.',
    });
    setMessage('Diagnostic preview only. No payment was processed.');
    onWalletStatus?.((previous) => ({
      ...(previous || {}),
      diagnostic_confirm_failed_closed: true,
      payment_submitted: false,
    }));
  };

  const handleReady = ({ availablePaymentMethods } = {}) => {
    const methods = availablePaymentMethods || {};
    setReady(true);
    onWalletStatus?.({
      express_checkout_mounted: true,
      available_payment_methods_present: Boolean(Object.values(methods).some(Boolean)),
      apple_pay_available: Boolean(methods.applePay),
      google_pay_available: Boolean(methods.googlePay),
      link_available: Boolean(methods.link),
      diagnostic_mode_active: true,
      payment_submitted: false,
    });
  };

  const handleLoadError = (error) => {
    setReady(false);
    setMessage('Express Checkout diagnostic failed to load.');
    onWalletStatus?.({
      express_checkout_mounted: false,
      available_payment_methods_present: false,
      apple_pay_available: false,
      google_pay_available: false,
      link_available: false,
      diagnostic_mode_active: true,
      mount_error: error?.message || 'load_error',
      payment_submitted: false,
    });
  };

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-amber-900">
        Diagnostic only — do not submit payment
      </div>
      <div className="relative min-h-[56px] rounded-xl border border-slate-200 bg-white p-2">
        <div style={{ minHeight: '48px', pointerEvents: ready ? 'none' : 'auto' }} aria-label="Diagnostic Express Checkout mount area">
          <ExpressCheckoutElement
            onConfirm={handleConfirm}
            onReady={handleReady}
            onLoadError={handleLoadError}
            options={{
              buttonType: { applePay: 'buy', googlePay: 'buy' },
              layout: { maxColumns: 1, maxRows: 3, overflow: 'auto' },
              wallets: { applePay: 'always', googlePay: 'always' },
            }}
          />
        </div>
        {ready && (
          <div className="pointer-events-auto absolute inset-0 rounded-xl border border-transparent" aria-hidden="true" />
        )}
      </div>
      <p className="text-xs text-slate-600">{message}</p>
    </div>
  );
}

export default function ApplePayMountDiagnostic({ isAuthLoading = false, isAuthorized = false }) {
  const [publicConfig, setPublicConfig] = useState({ status: 'idle', publishableKey: '', error: null });
  const stripePromise = useMemo(() => (isLivePublishableKey(publicConfig.publishableKey) ? loadStripe(publicConfig.publishableKey) : null), [publicConfig.publishableKey]);
  const [walletStatus, setWalletStatus] = useState({ diagnostic_mode_active: true });

  useEffect(() => {
    if (isAuthLoading || !isAuthorized) return undefined;
    let cancelled = false;
    setPublicConfig({ status: 'loading', publishableKey: '', error: null });
    base44.functions.invoke('previewNativeOrderCutoverReadiness', {
      preview_mode: APPLE_PAY_PUBLIC_CONFIG_PREVIEW_MODE,
      request_id: buildDiagnosticRequestId(),
    })
      .then((response) => {
        if (cancelled) return;
        const data = response?.data || {};
        const publishableKey = typeof data.stripe_publishable_key === 'string' ? data.stripe_publishable_key.trim() : '';
        if (data.success === true && data.writes_performed === false && data.stripe_mode === 'live' && data.key_type === 'publishable' && isLivePublishableKey(publishableKey)) {
          setPublicConfig({ status: 'ready', publishableKey, error: null });
          return;
        }
        setPublicConfig({ status: 'error', publishableKey: '', error: data.error_code || 'invalid_public_config_response' });
      })
      .catch((error) => {
        if (cancelled) return;
        setPublicConfig({
          status: 'error',
          publishableKey: '',
          error: error?.response?.data?.error_code || error?.message || 'public_config_request_failed',
        });
      });
    return () => { cancelled = true; };
  }, [isAuthLoading, isAuthorized]);

  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-[calc(env(safe-area-inset-top)+24px)] text-slate-900">
        <div className="mx-auto max-w-md rounded-2xl border bg-white p-5 shadow-sm">
          <p className="text-sm font-semibold">Checking diagnostic access…</p>
        </div>
      </div>
    );
  }

  if (!isAuthorized) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-[calc(env(safe-area-inset-top)+24px)] text-slate-900">
        <div className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Admin diagnostic</p>
          <h1 className="mt-2 text-xl font-bold">Access restricted</h1>
          <p className="mt-2 text-sm text-slate-600">This Apple Pay mount diagnostic is restricted to owner/admin accounts and is not available to customer checkout sessions.</p>
          <Button type="button" variant="outline" className="mt-4" onClick={() => { window.location.href = '/checkout'; }}>
            Return to checkout
          </Button>
        </div>
      </div>
    );
  }

  if (publicConfig.status === 'loading' || publicConfig.status === 'idle') {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-[calc(env(safe-area-inset-top)+24px)] text-slate-900">
        <div className="mx-auto max-w-md rounded-2xl border bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Admin diagnostic</p>
          <h1 className="mt-2 text-xl font-bold">Loading Stripe public config…</h1>
          <p className="mt-2 text-sm text-slate-600">Fetching the live publishable key through the read-only public config preview. No PaymentIntent or Order is created.</p>
          <DiagnosticStatusRow label="diagnostic_mode_active" value="true" />
          <DiagnosticStatusRow label="express_checkout_mounted" value="false" />
        </div>
      </div>
    );
  }

  if (!stripePromise) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-[calc(env(safe-area-inset-top)+24px)] text-slate-900">
        <div className="mx-auto max-w-md rounded-2xl border border-amber-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Admin diagnostic</p>
          <h1 className="mt-2 text-xl font-bold">Publishable key unavailable</h1>
          <p className="mt-2 text-sm text-slate-600">Diagnostic mode failed closed because the read-only public config preview did not return a live Stripe publishable key.</p>
          <DiagnosticStatusRow label="diagnostic_mode_active" value="true" />
          <DiagnosticStatusRow label="express_checkout_mounted" value="false" />
          <DiagnosticStatusRow label="public_config_loaded" value="false" />
        </div>
      </div>
    );
  }

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
    <div className="min-h-screen bg-slate-50 px-4 py-[calc(env(safe-area-inset-top)+24px)] text-slate-900">
      <div className="mx-auto max-w-md space-y-4">
        <button type="button" onClick={() => { window.location.href = '/checkout'; }} className="inline-flex h-11 items-center gap-2 rounded-full px-2 text-sm font-medium text-slate-700">
          <ArrowLeft className="h-4 w-4" />
          Checkout
        </button>

        <div className="rounded-2xl border border-amber-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Admin diagnostic</p>
          <h1 className="mt-2 text-xl font-bold">Apple Pay mount diagnostic</h1>
          <p className="mt-2 text-sm text-slate-600">Side-effect-free Express Checkout mount. The only backend call is the read-only public config preview for the Stripe publishable key. No PaymentIntent, Order, Checkout Session, payment submission, Hub action, notification, or loyalty mutation is created by this diagnostic.</p>
        </div>

        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold">Diagnostic cart context</h2>
          <div className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between"><span>AURA x1</span><span>$13.00</span></div>
            <div className="flex justify-between text-slate-600"><span>Delivery fee</span><span>$3.99</span></div>
            <div className="flex justify-between text-slate-600"><span>Tax</span><span>$0.00</span></div>
            <div className="flex justify-between border-t pt-2 font-semibold"><span>Total</span><span>$16.99</span></div>
          </div>
        </div>

        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <Elements
            stripe={stripePromise}
            options={{
              mode: 'payment',
              currency: 'usd',
              amount: APPLE_PAY_MOUNT_DIAGNOSTIC_AMOUNT,
              appearance,
              locale: 'en',
            }}
          >
            <DiagnosticExpressCheckout onWalletStatus={setWalletStatus} />
          </Elements>
        </div>

        <div className="rounded-2xl border bg-white p-4 shadow-sm space-y-2">
          <DiagnosticStatusRow label="diagnostic_mode_active" value={boolStatus(walletStatus?.diagnostic_mode_active)} />
          <DiagnosticStatusRow label="public_config_loaded" value="true" />
          <DiagnosticStatusRow label="express_checkout_mounted" value={boolStatus(walletStatus?.express_checkout_mounted)} />
          <DiagnosticStatusRow label="available_payment_methods_present" value={boolStatus(walletStatus?.available_payment_methods_present)} />
          <DiagnosticStatusRow label="apple_pay_available" value={boolStatus(walletStatus?.apple_pay_available)} />
          <DiagnosticStatusRow label="google_pay_available" value={boolStatus(walletStatus?.google_pay_available)} />
          <DiagnosticStatusRow label="link_available" value={boolStatus(walletStatus?.link_available)} />
        </div>
      </div>
    </div>
  );
}
