import React, { useState, useEffect } from 'react';
import SEO from '@/components/SEO';
import { Link, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { CheckCircle, Truck, ArrowRight, Home, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import { motion } from 'framer-motion';

// Max time to poll for order before showing "received" fallback (60 seconds)
const PROCESSING_TIMEOUT_MS = 60000;
const RETRY_COUNT = 15;

export default function OrderConfirmation() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [startTime] = React.useState(() => Date.now());
  const [timedOut, setTimedOut] = React.useState(false);

  const pathOrderId = window.location.pathname.split('/').pop();
  const queryParams = new URLSearchParams(window.location.search);
  const orderNumber = queryParams.get('order_number');
  const lookupKey = orderNumber || pathOrderId;

  const { data: order, isLoading, failureCount } = useQuery({
    queryKey: ['order-confirmation', lookupKey],
    queryFn: async () => {
      if (!lookupKey) return null;
      let orders = [];
      if (orderNumber) {
        orders = await base44.entities.Order.filter({ order_number: orderNumber });
      } else {
        orders = await base44.entities.Order.filter({ id: lookupKey });
      }
      // Throw so react-query retries — do NOT return null on empty
      if (!orders || orders.length === 0) throw new Error('Order not yet available');
      return orders[0];
    },
    enabled: !!lookupKey,
    retry: RETRY_COUNT,
    retryDelay: (attemptIndex) => {
      // Aggressive early retries: 1s, 2s, 3s, 4s, then 5s for remaining
      return Math.min(1000 * (attemptIndex + 1), 5000);
    },
  });

  // After 60s of polling with no result, show graceful fallback instead of navigating away
  React.useEffect(() => {
    if (order || !lookupKey) return;
    const timer = setTimeout(() => setTimedOut(true), PROCESSING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [order, lookupKey]);

  // Still polling — show processing state
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
          Your payment was received. We're confirming your order details — this usually takes a few seconds.
        </p>
        {elapsed > 10 && (
          <p className="text-xs text-muted-foreground mt-3 opacity-60">Still working… ({elapsed}s)</p>
        )}
      </div>
    );
  }

  // Timed out — order not found after 60s but payment succeeded; show graceful fallback
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
          Your payment was confirmed. We're finalizing your order — you'll receive a confirmation email shortly and can track your order from your account.
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

  // Should not reach here if still loading and not timed out
  if (!order) return null;

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
                ? `${format(new Date(order.estimated_delivery_date + 'T00:00:00Z'), 'EEEE, MMMM d')} Central Time`
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
          <Link to={`/order-tracker/${order.id}`} className="block">
            <Button className="w-full h-11 rounded-xl font-semibold text-sm">
              Track Your Order
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
      </motion.div>
    </div>
  );
}