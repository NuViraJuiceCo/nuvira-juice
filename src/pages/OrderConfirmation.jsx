import React, { useState, useEffect } from 'react';
import SEO from '@/components/SEO';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle, Truck, ArrowRight, Home, Clock, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import { motion } from 'framer-motion';

// Max polling time before showing graceful fallback (60 seconds, 15 retries)
const POLLING_TIMEOUT_MS = 60000;
const RETRY_COUNT = 15;

/**
 * OrderConfirmation — source of truth for lookup priority:
 * 1. ?order_number=NV-XXXX  (primary — most reliable, set by createCheckoutSession)
 * 2. /order-confirmation/:id  (legacy path param — local entity ID only)
 * 3. No params  → show friendly "check your orders" fallback immediately
 *
 * NEVER navigates back to /checkout after a successful payment.
 * NEVER uses the literal path segment "order-confirmation" as a lookup key.
 */
export default function OrderConfirmation() {
  const queryParams = new URLSearchParams(window.location.search);
  const orderNumber = queryParams.get('order_number');

  // Path param: /order-confirmation/:id — only valid if it looks like a real ID (not the route segment itself)
  const rawPathParam = window.location.pathname.split('/').pop();
  const pathId = rawPathParam && rawPathParam !== 'order-confirmation' ? rawPathParam : null;

  // Determine lookup mode
  const lookupMode = orderNumber ? 'order_number' : pathId ? 'path_id' : 'none';

  const [startTime] = React.useState(() => Date.now());
  const [timedOut, setTimedOut] = React.useState(false);

  const { data: order, isLoading } = useQuery({
    queryKey: ['order-confirmation', lookupMode, orderNumber || pathId],
    queryFn: async () => {
      if (lookupMode === 'order_number') {
        const orders = await base44.entities.Order.filter({ order_number: orderNumber });
        if (!orders || orders.length === 0) throw new Error('Order not yet available');
        return orders[0];
      }
      if (lookupMode === 'path_id') {
        const orders = await base44.entities.Order.filter({ id: pathId });
        if (!orders || orders.length === 0) throw new Error('Order not yet available');
        return orders[0];
      }
      return null; // no params — don't query
    },
    enabled: lookupMode !== 'none',
    retry: RETRY_COUNT,
    retryDelay: (attemptIndex) => Math.min(1000 * (attemptIndex + 1), 5000),
  });

  // After 60s of polling with no result, show graceful fallback
  React.useEffect(() => {
    if (order || lookupMode === 'none') return;
    const timer = setTimeout(() => setTimedOut(true), POLLING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [order, lookupMode]);

  // ── Case 1: No params at all ──────────────────────────────────────────────
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
              View My Orders
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </Link>
          <Link to="/" className="block">
            <Button variant="outline" className="w-full h-11 rounded-xl font-semibold text-sm">
              <Home className="w-4 h-4 mr-2" />
              Back to Home
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  // ── Case 2: Still polling (not timed out) ─────────────────────────────────
  if (isLoading && !timedOut) {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4 text-center">
        <SEO title="Order Processing" noindex={true} />
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1.5, ease: 'linear' }}
          className="w-16 h-16 border-4 border-primary/20 border-t-primary rounded-full mb-6"
        />
        <h2 className="font-heading text-xl font-bold mb-2">Processing your order…</h2>
        <p className="text-sm text-muted-foreground max-w-xs">
          Your payment was received. Confirming your order details — this usually takes a few seconds.
        </p>
        {elapsed > 10 && (
          <p className="text-xs text-muted-foreground mt-3 opacity-60">Still working… ({elapsed}s)</p>
        )}
      </div>
    );
  }

  // ── Case 3: Timed out — payment succeeded but order not found in 60s ──────
  if (timedOut && !order) {
    return (
      <div className="min-h-[80vh] flex flex-col items-center justify-center px-4 pb-8 text-center">
        <SEO title="Order Received" noindex={true} />
        <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mb-5">
          <Clock className="w-10 h-10 text-primary" />
        </div>
        <h1 className="font-heading text-2xl font-bold mb-2">Order Received!</h1>
        {orderNumber && (
          <p className="text-sm text-muted-foreground mb-1">Order #{orderNumber}</p>
        )}
        <p className="text-sm text-muted-foreground max-w-xs mb-6 leading-relaxed">
          Your payment was confirmed. We're finalizing your order — you'll receive a confirmation email shortly. You can also check your account orders page.
        </p>
        <div className="space-y-2.5 w-full max-w-sm">
          <Link to="/account/orders" className="block">
            <Button className="w-full h-11 rounded-xl font-semibold text-sm">
              View My Orders
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </Link>
          <Link to="/" className="block">
            <Button variant="outline" className="w-full h-11 rounded-xl font-semibold text-sm">
              <Home className="w-4 h-4 mr-2" />
              Back to Home
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  // ── Case 4: Order not resolved yet (shouldn't normally render) ─────────────
  if (!order) return null;

  // ── Case 5: Order confirmed ────────────────────────────────────────────────
  return (
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
        <p className="text-xs text-muted-foreground">We've received your order</p>
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
                ? `${format(new Date(order.estimated_delivery_date + 'T00:00:00'), 'EEEE, MMMM d')}`
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

        {/* Actions — no back-to-checkout link */}
        <div className="space-y-2.5">
          <Link to={`/order-tracker/${order.id}`} className="block">
            <Button className="w-full h-11 rounded-xl font-semibold text-sm">
              Track Your Order
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </Link>
          <Link to="/account/orders" className="block">
            <Button variant="outline" className="w-full h-11 rounded-xl font-semibold text-sm">
              View All Orders
            </Button>
          </Link>
          <Link to="/" className="block">
            <Button variant="ghost" className="w-full h-11 rounded-xl font-semibold text-sm">
              <Home className="w-4 h-4 mr-2" />
              Back to Home
            </Button>
          </Link>
        </div>
      </motion.div>
    </div>
  );
}