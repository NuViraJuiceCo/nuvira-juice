import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { format } from 'date-fns';
import { ChevronRight, ChevronDown, Package, Truck, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';

const DELIVERY_STAGES = [
  { key: 'order_received', label: 'Order Received' },
  { key: 'scheduled_for_juicing', label: 'Scheduled for Juicing' },
  { key: 'in_production', label: 'In Production' },
  { key: 'bottled_packed', label: 'Bottled & Packed' },
  { key: 'out_for_delivery', label: 'Out for Delivery' },
  { key: 'arriving_soon', label: 'Arriving Soon' },
  { key: 'delivered', label: 'Delivered' },
];

const PICKUP_STAGES = [
  { key: 'order_received', label: 'Order Received' },
  { key: 'scheduled_for_juicing', label: 'Scheduled for Juicing' },
  { key: 'in_production', label: 'In Production' },
  { key: 'bottled_packed', label: 'Bottled & Packed' },
  { key: 'ready_for_pickup', label: 'Ready for Pickup' },
  { key: 'picked_up', label: 'Picked Up' },
];

const STATUS_COLORS = {
  order_received: 'bg-blue-100 text-blue-700',
  scheduled_for_juicing: 'bg-purple-100 text-purple-700',
  in_production: 'bg-amber-100 text-amber-700',
  bottled_packed: 'bg-orange-100 text-orange-700',
  out_for_delivery: 'bg-cyan-100 text-cyan-700',
  arriving_soon: 'bg-teal-100 text-teal-700',
  delivered: 'bg-green-100 text-green-700',
  ready_for_pickup: 'bg-teal-100 text-teal-700',
  picked_up: 'bg-green-100 text-green-700',
};

const ACTIVE_STATUSES = ['order_received', 'scheduled_for_juicing', 'in_production', 'bottled_packed', 'out_for_delivery', 'arriving_soon', 'ready_for_pickup'];

function OrderCard({ order, onAdvance, isAdvancing }) {
  const [expanded, setExpanded] = useState(false);
  const stages = order.fulfillment_type === 'pickup' ? PICKUP_STAGES : DELIVERY_STAGES;
  const currentIndex = stages.findIndex(s => s.key === order.status);
  const nextStage = stages[currentIndex + 1];
  const isComplete = !nextStage;

  return (
    <div className="bg-card rounded-2xl border border-border/50 overflow-hidden">
      {/* Header */}
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center gap-3 p-4 text-left">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-bold">#{order.order_number}</p>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[order.status] || 'bg-muted text-muted-foreground'}`}>
              {stages.find(s => s.key === order.status)?.label || order.status}
            </span>
            {order.fulfillment_type === 'pickup' ? (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground">Pickup</span>
            ) : (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground">Delivery</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{order.customer_email}</p>
          <p className="text-xs text-muted-foreground">{format(new Date(order.created_date), 'MMM d, yyyy · h:mm a')}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <p className="text-sm font-bold">${order.total?.toFixed(2)}</p>
          {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t border-border/40 px-4 pb-4 pt-3 space-y-3">
              {/* Items */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Items</p>
                <div className="space-y-1">
                  {order.items?.map((item, i) => (
                    <div key={i} className="flex justify-between text-xs">
                      <span className="text-foreground">{item.title} × {item.quantity}</span>
                      <span className="font-medium">${(item.price * item.quantity).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Contact / Address */}
              {(order.contact_phone || order.delivery_address) && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Details</p>
                  {order.contact_phone && <p className="text-xs">{order.contact_phone}</p>}
                  {order.delivery_address && <p className="text-xs text-muted-foreground">{order.delivery_address}</p>}
                </div>
              )}

              {/* Stage Progress */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Progress</p>
                <div className="flex gap-1 flex-wrap">
                  {stages.map((stage, i) => (
                    <div key={stage.key} className={`h-1.5 flex-1 rounded-full ${i <= currentIndex ? 'bg-primary' : 'bg-border'}`} />
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-1">Step {currentIndex + 1} of {stages.length}</p>
              </div>

              {/* Advance Button */}
              {!isComplete ? (
                <button
                  onClick={() => onAdvance(order, nextStage)}
                  disabled={isAdvancing}
                  className="w-full py-3 bg-primary text-primary-foreground rounded-xl text-sm font-semibold disabled:opacity-50 active:scale-95 transition-transform"
                >
                  {isAdvancing ? 'Updating...' : `→ Mark as "${nextStage.label}"`}
                </button>
              ) : (
                <div className="w-full py-3 bg-green-50 text-green-700 rounded-xl text-sm font-semibold text-center border border-green-200">
                  ✓ Order Complete
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function AdminOrders() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState('active');
  const [advancingId, setAdvancingId] = useState(null);

  if (user?.role !== 'admin') {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <p className="text-muted-foreground text-sm">Access denied. Admins only.</p>
      </div>
    );
  }

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['admin-orders', filter],
    queryFn: () => base44.entities.Order.list('-created_date', 100),
  });

  const filtered = filter === 'active'
    ? orders.filter(o => ACTIVE_STATUSES.includes(o.status))
    : orders.filter(o => ['delivered', 'picked_up'].includes(o.status));

  const advanceMutation = useMutation({
    mutationFn: ({ order, nextStage }) => {
      const newHistory = [
        ...(order.status_history || []),
        { status: nextStage.key, timestamp: new Date().toISOString(), message: nextStage.label }
      ];
      return base44.entities.Order.update(order.id, {
        status: nextStage.key,
        status_history: newHistory,
      });
    },
    onSuccess: (_, { nextStage }) => {
      queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
      toast.success(`Order advanced to "${nextStage.label}"`);
      setAdvancingId(null);
    },
  });

  const handleAdvance = (order, nextStage) => {
    setAdvancingId(order.id);
    advanceMutation.mutate({ order, nextStage });
  };

  return (
    <div className="min-h-screen bg-background pb-10">
      {/* Header */}
      <div className="bg-primary px-4 pt-10 pb-5">
        <button onClick={() => navigate('/account')} className="w-9 h-9 bg-white/20 rounded-full flex items-center justify-center mb-3">
          <ArrowLeft className="w-4 h-4 text-white" />
        </button>
        <h1 className="font-heading text-2xl font-bold text-primary-foreground">Order Management</h1>
        <p className="text-primary-foreground/70 text-xs mt-0.5">Tap an order to update its status</p>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 px-4 mt-4 mb-4">
        {[
          { key: 'active', label: 'Active' },
          { key: 'completed', label: 'Completed' },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors ${
              filter === tab.key ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Orders List */}
      <div className="px-4 space-y-3">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-muted-foreground text-sm">No {filter} orders</p>
          </div>
        ) : (
          filtered.map(order => (
            <OrderCard
              key={order.id}
              order={order}
              onAdvance={handleAdvance}
              isAdvancing={advancingId === order.id}
            />
          ))
        )}
      </div>
    </div>
  );
}