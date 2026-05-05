import React, { useState, useEffect, useRef } from 'react';
import SEO from '@/components/SEO';
import GoogleCustomerReviewsOptIn from '@/components/GoogleCustomerReviewsOptIn';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { CheckCircle, Truck, ArrowRight, Home, Clock, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import { motion } from 'framer-motion';

const POLLING_TIMEOUT_MS = 60000;
const POLL_INTERVAL_MS = 3000;

/**
 * OrderConfirmation — lookup priority:
 * 1. ?session_id=cs_xxx  → calls getOrderBySession backend (handles webhook delay gracefully)
 * 2. ?order_number=NV-XX → direct entity filter (legacy / fast path)
 * 3. /order-confirmation/:id → entity ID lookup (legacy path)
 * 4. No params → friendly "check your orders" fallback
 *
 * NEVER navigates back to /checkout after a successful payment.
 */
export default function OrderConfirmation() {
  const queryParams = new URLSearchParams(window.location.search);
  const sessionId   = queryParams.get('session_id');
  const orderNumber = queryParams.get('order_number');

  const rawPathParam = window.location.pathname.split('/').pop();
  const pathId = rawPathParam && rawPathParam !== 'order-confirmation' ? rawPathParam : null;

  const lookupMode = sessionId ? 'session_id' : orderNumber ? 'order_number' : pathId ? 'path_id' : 'none';

  const [order, setOrder]         = useState(null);
  const [loading, setLoading]     = useState(lookupMode !== 'none');
  const [timedOut, setTimedOut]   = useState(false);
  const [paymentOk, setPaymentOk] = useState(false);
  const [resolvedOrderNumber, setResolvedOrderNumber] = useState(orderNumber || null);

  const pollRef    = useRef(null);
  const timeoutRef = useRef(null);
  const startTime  = useRef(Date.now());

  useEffect(() => {
    if (lookupMode === 'none') return;

    const poll = async () => {
      try {
        if (lookupMode === 'session_id') {
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
            setOrder(orders[0]);
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

  // ── Case 1: No params ──────────────────────────────────────────────────────
  if (lookupMode === 'none') {
    return (
      <div className="min-h-[80vh] flex flex-col items-center justify-center px-4 pb-8 text-center">
        <SEO title="Order Processing" noindex={true} />
        <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mb-5">
          <Mail className="w-10 h-10 text-primary" />
        </div>
        <h1 className="font-heading text-2xl font-bold mb-2">Check Your Orders</h1>
        <p className="text-sm text-muted-foreground max-w-xs mb-6 leading-relaxed">
          We're processing your order. Please check your account orders — your order will appear there shortly. If you don't see it within a few minutes, contact us.
        </p>
        <div className="space-y-2.5 w-full max-w-sm">
          <Link to="/account/orders" className="block">
            <Button className="w-full h-11 rounded-xl font-semibold text-sm">
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
      <div className="min-h-screen flex flex-col items-center justify-center px-4 text-center">
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
      <div className="min-h-[80vh] flex flex-col items-center justify-center px-4 pb-8 text-center">
        <SEO title="Order Received" noindex={true} />
        <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mb-5">
          <Clock className="w-10 h-10 text-primary" />
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
            <Button className="w-full h-11 rounded-xl font-semibold text-sm">
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

  if (!order) return null;

  // ── Case 4: Order confirmed ────────────────────────────────────────────────
  return (
    <>
    <GoogleCustomerReviewsOptIn order={order} />
    <div className="min-h-[80vh] flex flex-col items-center justify-center px-4 pb-8">
      <SEO title="Order Confirmed" description="Your NuVira Juice order has been confirmed." noindex={true} />
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 15 }}
        className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mb-5"
      >
        <CheckCircle className="w-10 h-10 text-primary" />
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
        <div className="bg-primary/5 rounded-xl p-4 flex items-center gap-3 mb-4">
          <Truck className="w-5 h-5 text-primary shrink-0" />
          <div>
            <p className="text-sm font-semibold text-primary">
              {order.fulfillment_type === 'pickup' ? 'Ready for pickup' : 'Estimated delivery'}
            </p>
            <p className="text-xs text-muted-foreground">
              {order.estimated_delivery_date
                ? format(new Date(order.estimated_delivery_date + 'T00:00:00'), 'EEEE, MMMM d')
                : 'Included in our next fresh batch'}
            </p>
          </div>
        </div>

        {/* Order Summary */}
        <div className="bg-secondary/40 rounded-xl p-4 mb-6">
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
          <Link to={`/order-tracker/${order.order_number || order.id}`} className="block">
            <Button className="w-full h-11 rounded-xl font-semibold text-sm">
              Track Your Order <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </Link>
          <Link to="/account/orders" className="block">
            <Button variant="outline" className="w-full h-11 rounded-xl font-semibold text-sm">
              View All Orders
            </Button>
          </Link>
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