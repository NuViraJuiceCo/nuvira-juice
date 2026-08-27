import React, { useState, useEffect, useRef } from 'react';
import SEO from '@/components/SEO';
import BrowserAppPrompt from '@/components/BrowserAppPrompt';
import GoogleCustomerReviewsOptIn from '@/components/GoogleCustomerReviewsOptIn';
import { HEALTH_ADVISORY_CONFIG } from '@/components/HealthAdvisory';
import { SAFE_TOP_PADDING } from '@/components/layout/MobilePageHeader';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { CheckCircle, Truck, ArrowRight, Home, Clock, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import { motion } from 'framer-motion';
import { redirectToLogin } from '@/lib/nativeAuthRedirect';
import {
  ANALYTICS_CONSENT_EVENT,
  trackGooglePurchase,
} from '@/lib/googleAnalytics';
import { MARKETING_CONSENT_EVENT } from '@/lib/metaPixel';
import { trackSnapPurchase } from '@/lib/snapPixel';

const POLLING_TIMEOUT_MS = 60000;
const POLL_INTERVAL_MS = 3000;

/**
 * OrderConfirmation — lookup priority:
 * 1. Guest order + session-scoped token → token-authorized sanitized lookup
 * 2. ?session_id=cs_xxx  → calls getOrderBySession backend (handles webhook delay gracefully)
 * 3. ?order_number=NV-XX → direct entity filter (legacy / fast path)
 * 4. /order-confirmation/:id → entity ID lookup (legacy path)
 * 5. No params → friendly "check your orders" fallback
 *
 * NEVER navigates back to /checkout after a successful payment.
 */
export default function OrderConfirmation() {
  const queryParams = new URLSearchParams(window.location.search);
  const sessionId   = queryParams.get('session_id');
  const orderNumber = queryParams.get('order_number');
  // pi= param from embedded checkout — treat same as order_number lookup
  const piParam     = queryParams.get('pi');
  const isGuestCheckout = queryParams.get('guest_checkout') === '1';

  const rawPathParam = window.location.pathname.split('/').pop();
  const pathId = rawPathParam && rawPathParam !== 'order-confirmation' ? rawPathParam : null;

  const lookupMode = isGuestCheckout && orderNumber
    ? 'guest_order'
    : sessionId ? 'session_id' : orderNumber ? 'order_number' : pathId ? 'path_id' : 'none';

  const [order, setOrder]         = useState(null);
  const [loading, setLoading]     = useState(lookupMode !== 'none');
  const [timedOut, setTimedOut]   = useState(false);
  const [paymentOk, setPaymentOk] = useState(false);
  const [resolvedOrderNumber, setResolvedOrderNumber] = useState(orderNumber || null);

  const pollRef    = useRef(null);
  const timeoutRef = useRef(null);
  const startTime  = useRef(Date.now());
  const snapPurchaseTrackedRef = useRef('');

  useEffect(() => {
    if (lookupMode === 'none') return;

    const poll = async () => {
      try {
        if (lookupMode === 'guest_order') {
          let guestConfirmation = null;
          try {
            guestConfirmation = JSON.parse(sessionStorage.getItem('nuvira_guest_order_confirmation') || 'null');
          } catch {
            guestConfirmation = null;
          }
          const tokenIsFresh = guestConfirmation?.timestamp && Date.now() - Number(guestConfirmation.timestamp) < 24 * 60 * 60 * 1000;
          if (!tokenIsFresh || guestConfirmation?.order_number !== orderNumber || !guestConfirmation?.token) {
            setPaymentOk(true);
            setLoading(false);
            clearInterval(pollRef.current);
            clearTimeout(timeoutRef.current);
            return;
          }
          const res = await base44.functions.invoke('createPaymentIntent', {
            mode: 'guest_order_status',
            order_number: orderNumber,
            guest_order_token: guestConfirmation.token,
          });
          const data = res?.data || res;
          setPaymentOk(true);
          if (data?.found && data?.order) {
            setOrder(data.order);
            setLoading(false);
            sessionStorage.removeItem('nuvira_guest_order_confirmation');
            clearInterval(pollRef.current);
            clearTimeout(timeoutRef.current);
            return;
          }
        } else if (lookupMode === 'session_id') {
          const res = await base44.functions.invoke('getOrderBySession', { session_id: sessionId });
          const data = res.data;

          // If Stripe confirms payment but order not created yet, keep polling
          if (data.payment_status === 'paid' || data.session_status === 'complete') {
            setPaymentOk(true);
          }

          if (data.order_number) {
            setResolvedOrderNumber(data.order_number);
          }

          if (data.found && data.order) {
            setOrder(data.order);
            setLoading(false);
            clearInterval(pollRef.current);
            clearTimeout(timeoutRef.current);
            return;
          }

        } else if (lookupMode === 'order_number') {
          const orders = await base44.entities.Order.filter({ order_number: orderNumber });
          if (orders && orders.length > 0) {
            const o = orders[0];
            // For embedded flow: if order exists but payment still pending, keep polling briefly
            if (o.payment_status === 'pending' && !o.payment_captured) {
              setPaymentOk(true); // show "finalizing" message
              return; // keep polling
            }
            setOrder(o);
            setLoading(false);
            clearInterval(pollRef.current);
            clearTimeout(timeoutRef.current);
            return;
          }

        } else if (lookupMode === 'path_id') {
          const orders = await base44.entities.Order.filter({ id: pathId });
          if (orders && orders.length > 0) {
            setOrder(orders[0]);
            setLoading(false);
            clearInterval(pollRef.current);
            clearTimeout(timeoutRef.current);
            return;
          }
        }
      } catch (e) {
        if (lookupMode === 'guest_order' && [400, 403].includes(Number(e?.status))) {
          setPaymentOk(true);
          setLoading(false);
          clearInterval(pollRef.current);
          clearTimeout(timeoutRef.current);
          return;
        }
        console.warn('[OrderConfirmation] Poll error:', e.message);
      }
    };

    // Start polling immediately then every POLL_INTERVAL_MS
    poll();
    pollRef.current = setInterval(poll, POLL_INTERVAL_MS);

    // Timeout after POLLING_TIMEOUT_MS
    timeoutRef.current = setTimeout(() => {
      clearInterval(pollRef.current);
      setTimedOut(true);
      setLoading(false);
    }, POLLING_TIMEOUT_MS);

    return () => {
      clearInterval(pollRef.current);
      clearTimeout(timeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (!order || (lookupMode !== 'session_id' && lookupMode !== 'order_number')) return undefined;

    const trackPurchase = () => {
      void trackGooglePurchase(order);
    };
    const trackSnap = async () => {
      const trackingKey = String(order?.order_number || order?.id || '');
      if (!trackingKey || snapPurchaseTrackedRef.current === trackingKey) return;
      const tracked = await trackSnapPurchase(order);
      if (tracked) snapPurchaseTrackedRef.current = trackingKey;
    };
    trackPurchase();
    void trackSnap();
    window.addEventListener(ANALYTICS_CONSENT_EVENT, trackPurchase);
    window.addEventListener(MARKETING_CONSENT_EVENT, trackSnap);
    return () => {
      window.removeEventListener(ANALYTICS_CONSENT_EVENT, trackPurchase);
      window.removeEventListener(MARKETING_CONSENT_EVENT, trackSnap);
    };
  }, [lookupMode, order]);

  // ── Case 1: No params ──────────────────────────────────────────────────────
  if (lookupMode === 'none') {
    return (
      <div
        className="min-h-[80vh] flex flex-col items-center justify-center px-4 pb-8 text-center"
        style={{ paddingTop: SAFE_TOP_PADDING }}
      >
        <SEO title="Order Processing" noindex={true} />
        <div className="nuvira-icon-badge w-20 h-20 rounded-full flex items-center justify-center mb-5">
          <Mail className="w-10 h-10" />
        </div>
        <h1 className="font-heading text-2xl font-bold mb-2">Check Your Orders</h1>
        <p className="text-sm text-muted-foreground max-w-xs mb-6 leading-relaxed">
          We're processing your order. Please check your account orders — your order will appear there shortly. If you don't see it within a few minutes, contact us.
        </p>
        <div className="space-y-2.5 w-full max-w-sm">
          <Link to="/account/orders" className="block">
            <Button className="nuvira-gradient-button w-full h-11 rounded-xl font-semibold text-sm">
              View My Orders <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </Link>
          <Link to="/" className="block">
            <Button variant="outline" className="w-full h-11 rounded-xl font-semibold text-sm">
              <Home className="w-4 h-4 mr-2" /> Back to Home
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  // ── Case 2: Still polling ──────────────────────────────────────────────────
  if (loading) {
    const elapsed = Math.floor((Date.now() - startTime.current) / 1000);
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4 text-center" style={{ paddingTop: SAFE_TOP_PADDING }}>
        <SEO title="Order Processing" noindex={true} />
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1.5, ease: 'linear' }}
          className="w-16 h-16 border-4 border-primary/20 border-t-primary rounded-full mb-6"
        />
        <h2 className="font-heading text-xl font-bold mb-2">
          {paymentOk ? 'Payment confirmed — finalizing your order…' : 'Processing your order…'}
        </h2>
        <p className="text-sm text-muted-foreground max-w-xs">
          {paymentOk
            ? 'Your payment was received. We\'re creating your order — this usually takes a few seconds.'
            : 'Your payment was received. Confirming your order details — this usually takes a few seconds.'}
        </p>
        {elapsed > 10 && (
          <p className="text-xs text-muted-foreground mt-3 opacity-60">Still working… ({elapsed}s)</p>
        )}
        <p className="text-xs text-muted-foreground mt-4 opacity-50">Please do not place another order.</p>
      </div>
    );
  }

  // ── Case 3: Timed out ──────────────────────────────────────────────────────
  if (timedOut && !order) {
    return (
      <div
        className="min-h-[80vh] flex flex-col items-center justify-center px-4 pb-8 text-center"
        style={{ paddingTop: SAFE_TOP_PADDING }}
      >
        <SEO title="Order Received" noindex={true} />
        <div className="nuvira-icon-badge w-20 h-20 rounded-full flex items-center justify-center mb-5">
          <Clock className="w-10 h-10" />
        </div>
        <h1 className="font-heading text-2xl font-bold mb-2">Order Received!</h1>
        {(resolvedOrderNumber) && (
          <p className="text-sm text-muted-foreground mb-1">Order #{resolvedOrderNumber}</p>
        )}
        <p className="text-sm text-muted-foreground max-w-xs mb-6 leading-relaxed">
          Your payment was confirmed. We're finalizing your order — you'll receive a confirmation email shortly.
          <strong className="block mt-2 text-foreground">Please do not place another order.</strong>
        </p>
        <div className="space-y-2.5 w-full max-w-sm">
          <Link to="/account/orders" className="block">
            <Button className="nuvira-gradient-button w-full h-11 rounded-xl font-semibold text-sm">
              View My Orders <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </Link>
          <Link to="/" className="block">
            <Button variant="outline" className="w-full h-11 rounded-xl font-semibold text-sm">
              <Home className="w-4 h-4 mr-2" /> Back to Home
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  if (!order && lookupMode === 'guest_order' && paymentOk) {
    return (
      <div className="min-h-[80vh] flex flex-col items-center justify-center px-4 pb-8 text-center" style={{ paddingTop: SAFE_TOP_PADDING }}>
        <SEO title="Order Confirmed" noindex={true} />
        <div className="nuvira-icon-badge w-20 h-20 rounded-full flex items-center justify-center mb-5">
          <CheckCircle className="w-10 h-10" />
        </div>
        <h1 className="font-heading text-2xl font-bold mb-2">Your Order is Confirmed!</h1>
        {resolvedOrderNumber && <p className="text-sm text-muted-foreground mb-2">Order #{resolvedOrderNumber}</p>}
        <p className="text-sm text-muted-foreground max-w-sm mb-6 leading-relaxed">
          Your receipt and delivery updates are being sent to the email you provided. Create an account with that same email whenever you want to track this order in NuVira.
        </p>
        <div className="space-y-2.5 w-full max-w-sm">
          <Button onClick={() => redirectToLogin('/account/orders')} className="nuvira-gradient-button w-full h-11 rounded-xl font-semibold text-sm">
            Create Account / Sign In <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
          <Link to="/" className="block">
            <Button variant="outline" className="w-full h-11 rounded-xl font-semibold text-sm"><Home className="w-4 h-4 mr-2" /> Back to Home</Button>
          </Link>
        </div>
      </div>
    );
  }

  if (!order) return null;

  // ── Case 4: Order confirmed ────────────────────────────────────────────────
  return (
    <>
    <BrowserAppPrompt pageRoute="/account/orders" />
    <GoogleCustomerReviewsOptIn order={order} />
    <div
      className="min-h-[80vh] flex flex-col items-center justify-center px-4 pb-8"
      style={{ paddingTop: SAFE_TOP_PADDING }}
    >
      <SEO title="Order Confirmed" description="Your NuVira Juice order has been confirmed." noindex={true} />
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 15 }}
        className="nuvira-icon-badge w-20 h-20 rounded-full flex items-center justify-center mb-5"
      >
        <CheckCircle className="w-10 h-10" />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="text-center"
      >
        <h1 className="font-heading text-2xl font-bold mb-1">Your Order is Confirmed!</h1>
        <p className="text-sm text-muted-foreground mb-1">Order #{order.order_number}</p>
        <p className="text-xs text-muted-foreground">We've received your NuVira order</p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="w-full max-w-sm mt-6"
      >
        {/* Delivery Info */}
        <div className="bg-nuvira-gradient-soft border border-nuvira rounded-xl p-4 flex items-center gap-3 mb-4">
          <Truck className="w-5 h-5 text-primary shrink-0" />
          <div>
            <p className="text-sm font-semibold text-primary">
              Estimated delivery
            </p>
            <p className="text-xs text-muted-foreground">
              {order.estimated_delivery_date
                ? format(new Date(order.estimated_delivery_date + 'T00:00:00'), 'EEEE, MMMM d')
                : 'Included in our next fresh batch'}
            </p>
          </div>
        </div>

        {/* Health Advisory Reminder */}
         <div className="rounded-2xl p-3.5 border mb-6 flex items-start gap-3" style={{ background: 'rgba(11, 61, 46, 0.06)', borderColor: 'rgba(218, 165, 32, 0.25)' }}>
           <svg className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'rgba(218, 165, 32, 0.6)' }} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
           <p className="text-xs text-foreground/70 leading-relaxed">
             {HEALTH_ADVISORY_CONFIG.confirmationNotice}
           </p>
         </div>

        {/* Order Summary */}
         <div className="nuvira-premium-card rounded-xl p-4 mb-6">
           <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
             Order Summary
           </h3>
          {order.items?.map((item, i) => (
            <div key={i} className="flex justify-between text-sm mb-1">
              <span>{item.quantity}x {item.title}</span>
              <span className="font-medium">${(item.price * item.quantity).toFixed(2)}</span>
            </div>
          ))}
          <div className="border-t border-border/50 mt-2 pt-2 flex justify-between text-sm font-bold">
            <span>Total</span>
            <span>${order.total?.toFixed(2)}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="space-y-2.5">
          {isGuestCheckout ? (
            <Button onClick={() => redirectToLogin('/account/orders')} className="nuvira-gradient-button w-full h-11 rounded-xl font-semibold text-sm">
              Create Account to Track <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          ) : (
            <>
              <Link to={`/order-tracker/${order.order_number || order.id}`} className="block">
                <Button className="nuvira-gradient-button w-full h-11 rounded-xl font-semibold text-sm">
                  Track Your Order <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </Link>
              <Link to="/account/orders" className="block">
                <Button variant="outline" className="w-full h-11 rounded-xl font-semibold text-sm">View All Orders</Button>
              </Link>
            </>
          )}
          <Link to="/" className="block">
            <Button variant="ghost" className="w-full h-11 rounded-xl font-semibold text-sm">
              <Home className="w-4 h-4 mr-2" /> Back to Home
            </Button>
          </Link>
        </div>
      </motion.div>
    </div>
    </>
  );
}
