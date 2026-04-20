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

  const isOnRoute = ['out_for_delivery', 'arriving_soon'].includes(order?.status)
    && order?.fulfillment_type === 'delivery';

  const { data: etaData } = useQuery({
    queryKey: ['delivery-eta', orderId],
    queryFn: async () => {
      const res = await base44.functions.invoke('getDeliveryEta', { order_id: orderId });
      return res.data;
    },
    enabled: !!orderId && !!order && isOnRoute,
    refetchInterval: 3 * 60 * 1000, // refresh every 3 min for live accuracy
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
  const isDelivery = order.fulfillment_type !== 'pickup';

  return (
    <div className="pb-8 min-h-screen bg-background">
      {/* Header */}
      <div className="bg-primary px-4 pt-10 pb-6">
        <button onClick={() => navigate(-1)} className="w-9 h-9 bg-white/20 rounded-full flex items-center justify-center mb-4">
          <ArrowLeft className="w-4 h-4 text-white" />
        </button>
        <p className="text-primary-foreground/70 text-xs font-medium uppercase tracking-wider">Order #{order.order_number}</p>
        <h1 className="font-heading text-2xl font-bold text-primary-foreground mt-0.5">Track Your Order</h1>

        {/* ETA / Date Card */}
        <div className="mt-4 bg-white/15 rounded-2xl p-4 flex items-start gap-3">
          <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center shrink-0 mt-0.5">
            {isDelivery ? <Truck className="w-5 h-5 text-white" /> : <Package className="w-5 h-5 text-white" />}
          </div>
          <div className="flex-1">
            <p className="text-primary-foreground/70 text-xs">
              {isOnRoute && etaData?.eta_window ? 'Estimated Arrival Window' : isDelivery ? 'Estimated Delivery' : 'Estimated Pickup'}
            </p>
            <p className="font-heading text-xl font-bold text-white">
              {isOnRoute && etaData?.eta_window
                ? etaData.eta_window
                : order.estimated_delivery_date
                  ? format(new Date(order.estimated_delivery_date), 'EEEE, MMMM d')
                  : 'Next fresh batch'}
            </p>
            {isOnRoute && etaData?.message && (
              <div className="flex items-center gap-1.5 mt-1.5">
                <div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse shrink-0" />
                <p className="text-white/80 text-xs font-medium">{etaData.message}</p>
              </div>
            )}
            {isOnRoute && etaData?.stops_total > 0 && (
              <p className="text-white/60 text-xs mt-0.5">
                {etaData.stops_delivered} of {etaData.stops_total} stops completed
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Live Delivery Progress Card */}
      {isOnRoute && etaData?.on_route && (
        <div className="mx-4 mt-4 bg-emerald-50 border border-emerald-200 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse shrink-0" />
            <p className="text-xs font-bold text-emerald-700 uppercase tracking-wide">Driver is on the way</p>
          </div>

          {/* Progress bar */}
          {etaData.stops_total > 1 && (
            <div className="mb-3">
              <div className="flex gap-1">
                {Array.from({ length: etaData.stops_total }).map((_, i) => {
                  const isDone = i < etaData.stops_delivered;
                  const isYours = i === etaData.stops_total - etaData.stops_remaining + etaData.stops_ahead;
                  return (
                    <div key={i} className={`h-2 flex-1 rounded-full transition-all ${
                      isDone ? 'bg-emerald-500'
                      : isYours ? 'bg-emerald-300 animate-pulse'
                      : 'bg-emerald-100'
                    }`} />
                  );
                })}
              </div>
              <div className="flex justify-between mt-1">
                <p className="text-[10px] text-emerald-600">Start</p>
                <p className="text-[10px] text-emerald-600">Your stop</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div className="bg-white rounded-xl p-2.5 text-center">
              <p className="text-lg font-bold font-heading text-emerald-700">{etaData.stops_ahead ?? 0}</p>
              <p className="text-[10px] text-muted-foreground">Stops ahead</p>
            </div>
            <div className="bg-white rounded-xl p-2.5 text-center">
              <p className="text-lg font-bold font-heading text-emerald-700">{etaData.stops_delivered ?? 0}</p>
              <p className="text-[10px] text-muted-foreground">Delivered so far</p>
            </div>
          </div>

          <p className="text-[10px] text-emerald-600/70 mt-2.5 text-center">
            ETA updates automatically · Driver location is private
          </p>
        </div>
      )}

      {/* Progress Tracker */}
      <div className="mx-4 mt-5">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">Status Updates</h2>
        <div className="space-y-0">
          {stages.map((stage, index) => {
            const isCompleted = index <= currentIndex;
            const isCurrent = index === currentIndex;
            return (
              <motion.div
                key={stage.key}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.06 }}
                className="flex gap-4"
              >
                <div className="flex flex-col items-center">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 border-2 transition-all ${
                    isCurrent
                      ? 'bg-primary border-primary text-white ring-4 ring-primary/20'
                      : isCompleted
                      ? 'bg-primary border-primary text-white'
                      : 'bg-background border-border text-muted-foreground'
                  }`}>
                    {isCompleted ? <Check className="w-4 h-4" /> : <div className="w-2 h-2 rounded-full bg-muted-foreground/30" />}
                  </div>
                  {index < stages.length - 1 && (
                    <div className={`w-0.5 h-12 transition-colors ${
                      index < currentIndex ? 'bg-primary' : 'bg-border'
                    }`} />
                  )}
                </div>
                <div className="pb-10 pt-1.5">
                  <p className={`text-sm font-semibold ${
                    isCurrent ? 'text-primary' : isCompleted ? 'text-foreground' : 'text-muted-foreground'
                  }`}>{stage.label}</p>
                  <p className={`text-xs mt-0.5 ${
                    isCurrent ? 'text-foreground/70' : 'text-muted-foreground'
                  }`}>{stage.desc}</p>
                  {isCurrent && (
                    <span className="inline-block mt-1.5 text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">In Progress</span>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Order Items */}
      <div className="mx-4 mt-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Your Items</h2>
        <div className="bg-card rounded-2xl border border-border/40 overflow-hidden divide-y divide-border/40">
          {order.items?.map((item, i) => (
            <div key={i} className="flex items-center gap-3 p-4">
              <div className="w-12 h-12 bg-secondary rounded-xl overflow-hidden shrink-0">
                {item.image_url ? (
                  <img src={item.image_url} alt={item.title} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-xl">🍊</div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{item.title}</p>
                <p className="text-xs text-muted-foreground">Qty: {item.quantity}</p>
              </div>
              <p className="text-sm font-bold">${(item.price * item.quantity).toFixed(2)}</p>
            </div>
          ))}
          <div className="px-4 py-3 flex justify-between">
            <p className="text-sm font-bold">Total</p>
            <p className="text-sm font-bold">${order.total?.toFixed(2)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}