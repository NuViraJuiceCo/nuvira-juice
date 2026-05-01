import React from 'react';
import SEO from '@/components/SEO';
import { Link, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { CheckCircle, Truck, ArrowRight, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import { motion } from 'framer-motion';

export default function OrderConfirmation() {
  const navigate = useNavigate();
  const { user } = useAuth();
  
  // Support both old path-based and new query param-based lookups
  const pathOrderId = window.location.pathname.split('/').pop();
  const queryParams = new URLSearchParams(window.location.search);
  const orderNumber = queryParams.get('order_number');
  
  const lookupKey = orderNumber || pathOrderId;

  const { data: order, isLoading } = useQuery({
    queryKey: ['order-confirmation', lookupKey, user?.email],
    queryFn: async () => {
      if (!lookupKey) return null;
      
      // Try by ID first (old path-based), then by order_number (new Stripe success URL)
      let orders = [];
      if (orderNumber) {
        // New: query by order_number + customer_email
        orders = await base44.entities.Order.filter({ order_number: orderNumber, customer_email: user?.email || '' });
      } else {
        // Old: query by ID
        orders = await base44.entities.Order.filter({ id: lookupKey });
      }
      return orders[0] || null;
    },
    enabled: !!lookupKey && !!user?.email,
    retry: 3, // Retry up to 3 times in case webhook is still processing
    retryDelay: (attemptIndex) => Math.min(1000 * Math.pow(2, attemptIndex), 5000), // exponential backoff
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <p className="text-muted-foreground">Order not found</p>
      </div>
    );
  }

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
        <h1 className="font-heading text-2xl font-bold mb-1">{user?.full_name ? `Thanks, ${user.full_name}!` : 'Order Confirmed!'}</h1>
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
                ? format(new Date(order.estimated_delivery_date), 'EEEE, MMMM d')
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