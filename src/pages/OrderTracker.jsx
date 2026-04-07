import React from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Truck, Package, Check } from 'lucide-react';
import { format } from 'date-fns';
import { motion } from 'framer-motion';

const DELIVERY_STAGES = [
  { key: 'order_received', label: 'Order Received', desc: "We've received your order" },
  { key: 'scheduled_for_juicing', label: 'Scheduled for Juicing', desc: 'Your juice is scheduled for our next fresh batch' },
  { key: 'in_production', label: 'In Production', desc: "We're currently preparing your order" },
  { key: 'bottled_packed', label: 'Bottled & Packed', desc: 'Your juice has been bottled and packed' },
  { key: 'out_for_delivery', label: 'Out for Delivery', desc: 'Your driver is on the way' },
  { key: 'arriving_soon', label: 'Arriving Soon', desc: 'Your order is almost there' },
  { key: 'delivered', label: 'Delivered', desc: 'Your juice has been delivered' },
];

const PICKUP_STAGES = [
  { key: 'order_received', label: 'Order Received', desc: "We've received your order" },
  { key: 'scheduled_for_juicing', label: 'Scheduled for Juicing', desc: 'Your juice is scheduled for our next fresh batch' },
  { key: 'in_production', label: 'In Production', desc: "We're currently preparing your order" },
  { key: 'bottled_packed', label: 'Bottled & Packed', desc: 'Your juice has been bottled and packed' },
  { key: 'ready_for_pickup', label: 'Ready for Pickup', desc: 'Your order is ready for pickup' },
  { key: 'picked_up', label: 'Picked Up', desc: 'Your order has been picked up' },
];

export default function OrderTracker() {
  const orderId = window.location.pathname.split('/').pop();
  const navigate = useNavigate();

  const { data: order, isLoading } = useQuery({
    queryKey: ['order', orderId],
    queryFn: async () => {
      const orders = await base44.entities.Order.filter({ id: orderId });
      return orders[0];
    },
    enabled: !!orderId,
    refetchInterval: 30000,
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
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Order not found</p>
      </div>
    );
  }

  const stages = order.fulfillment_type === 'pickup' ? PICKUP_STAGES : DELIVERY_STAGES;
  const currentIndex = stages.findIndex(s => s.key === order.status);

  return (
    <div className="pb-8">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-4 pb-3">
        <button onClick={() => navigate(-1)} className="w-9 h-9 bg-secondary rounded-full flex items-center justify-center">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="font-heading text-lg font-bold">Order Tracker</h1>
          <p className="text-xs text-muted-foreground">#{order.order_number}</p>
        </div>
      </div>

      {/* Delivery Estimate */}
      <div className="mx-4 mb-6 bg-primary/5 rounded-2xl p-5 text-center">
        <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-3">
          {order.fulfillment_type === 'pickup' ? (
            <Package className="w-5 h-5 text-primary" />
          ) : (
            <Truck className="w-5 h-5 text-primary" />
          )}
        </div>
        <p className="text-xs text-muted-foreground mb-0.5">
          {order.fulfillment_type === 'pickup' ? 'Estimated pickup' : 'Estimated delivery'}
        </p>
        <p className="font-heading text-lg font-bold text-primary">
          {order.estimated_delivery_date
            ? format(new Date(order.estimated_delivery_date), 'EEEE, MMMM d')
            : 'Next fresh batch'}
        </p>
      </div>

      {/* Progress Tracker */}
      <div className="mx-4">
        <div className="space-y-0">
          {stages.map((stage, index) => {
            const isCompleted = index <= currentIndex;
            const isCurrent = index === currentIndex;

            return (
              <motion.div
                key={stage.key}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05 }}
                className="flex gap-3"
              >
                {/* Indicator */}
                <div className="flex flex-col items-center">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                    isCompleted
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary text-muted-foreground'
                  } ${isCurrent ? 'ring-4 ring-primary/20' : ''}`}>
                    {isCompleted ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      <div className="w-2 h-2 rounded-full bg-muted-foreground/30" />
                    )}
                  </div>
                  {index < stages.length - 1 && (
                    <div className={`w-0.5 h-10 transition-colors ${
                      index < currentIndex ? 'bg-primary' : 'bg-border'
                    }`} />
                  )}
                </div>

                {/* Content */}
                <div className="pb-8 pt-1">
                  <p className={`text-sm font-medium ${
                    isCompleted ? 'text-foreground' : 'text-muted-foreground'
                  }`}>
                    {stage.label}
                  </p>
                  {isCurrent && (
                    <p className="text-xs text-primary mt-0.5">{stage.desc}</p>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Order Items */}
      <div className="mx-4 mt-2 bg-secondary/40 rounded-xl p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Items</h3>
        {order.items?.map((item, i) => (
          <div key={i} className="flex items-center gap-2.5 mb-2 last:mb-0">
            <div className="w-10 h-10 bg-secondary rounded-lg overflow-hidden shrink-0">
              {item.image_url ? (
                <img src={item.image_url} alt={item.title} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-lg">🍊</div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{item.title}</p>
              <p className="text-xs text-muted-foreground">Qty: {item.quantity}</p>
            </div>
            <p className="text-sm font-medium">${(item.price * item.quantity).toFixed(2)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}