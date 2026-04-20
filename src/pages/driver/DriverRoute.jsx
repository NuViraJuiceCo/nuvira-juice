import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { motion, AnimatePresence } from 'framer-motion';
import { format } from 'date-fns';
import {
  Leaf, MapPin, Navigation, Package, CheckCircle2, ChevronDown, ChevronRight,
  RefreshCw, Clock, Route, XCircle, ArrowLeft, Recycle
} from 'lucide-react';
import { toast } from 'sonner';

const DELIVERY_STAGES = [
  { key: 'bottled_packed', label: 'Packed' },
  { key: 'out_for_delivery', label: 'Out for Delivery' },
  { key: 'arriving_soon', label: 'Arriving Soon' },
  { key: 'delivered', label: 'Delivered' },
];

function mapsUrl(address) {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}&travelmode=driving`;
}

function formatDuration(seconds) {
  if (!seconds) return null;
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

function StopCard({ order, bagReturns, onMarkDelivered, onMarkStatus, isUpdating }) {
  const [expanded, setExpanded] = useState(false);
  const pendingReturn = bagReturns.find(
    r => r.customer_email === order.customer_email && r.verification_status === 'requested'
  );
  const isDelivered = order.status === 'delivered';
  const currentStageIndex = DELIVERY_STAGES.findIndex(s => s.key === order.status);
  const nextStage = DELIVERY_STAGES[currentStageIndex + 1];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`bg-card border rounded-2xl overflow-hidden ${isDelivered ? 'border-green-200 opacity-70' : pendingReturn ? 'border-amber-300' : 'border-border/50'}`}
    >
      {/* Header row */}
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center gap-3 p-4 text-left active:bg-secondary/30 transition-colors">
        {/* Stop indicator */}
        <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 font-heading font-bold text-sm ${isDelivered ? 'bg-green-100 text-green-600' : 'bg-primary/10 text-primary'}`}>
          {isDelivered ? <CheckCircle2 className="w-4 h-4" /> : <MapPin className="w-4 h-4" />}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-sm font-semibold">#{order.order_number}</p>
            {isDelivered && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700">Delivered ✓</span>}
            {!isDelivered && nextStage && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">{DELIVERY_STAGES.find(s => s.key === order.status)?.label || order.status}</span>}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{order.delivery_address}</p>
          {pendingReturn && (
            <div className="flex items-center gap-1 mt-1">
              <Recycle className="w-3 h-3 text-amber-600" />
              <p className="text-[10px] font-semibold text-amber-600">Bag return to collect</p>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {order.leg_duration_seconds && (
            <span className="text-[10px] text-muted-foreground">{formatDuration(order.leg_duration_seconds)}</span>
          )}
          {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="border-t border-border/40 px-4 pb-4 pt-3 space-y-3">
              {/* Customer */}
              <div className="space-y-0.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Customer</p>
                <p className="text-xs">{order.customer_email}</p>
                {order.contact_phone && <p className="text-xs font-semibold">{order.contact_phone}</p>}
              </div>

              {/* Items */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Items</p>
                <div className="space-y-0.5">
                  {order.items?.map((item, i) => (
                    <p key={i} className="text-xs">{item.title} × {item.quantity}</p>
                  ))}
                </div>
              </div>

              {/* Bag return notice */}
              {pendingReturn && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Recycle className="w-4 h-4 text-amber-600" />
                    <p className="text-xs font-semibold text-amber-700">Bag Return Pending</p>
                  </div>
                  <p className="text-[11px] text-amber-600">
                    {[
                      pendingReturn.small_bags_requested > 0 && `${pendingReturn.small_bags_requested} small bag(s)`,
                      pendingReturn.tote_bags_requested > 0 && `${pendingReturn.tote_bags_requested} tote(s)`,
                    ].filter(Boolean).join(' + ')}
                    {' '}to collect at drop-off
                  </p>
                  <Link to="/driver/returns">
                    <button className="mt-2 w-full py-2 bg-amber-500 text-white rounded-lg text-xs font-semibold">
                      Verify Return Now →
                    </button>
                  </Link>
                </div>
              )}

              {/* Navigate button */}
              <a
                href={mapsUrl(order.delivery_address)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full py-3 bg-blue-500 text-white rounded-xl text-sm font-semibold active:scale-95 transition-transform"
              >
                <Navigation className="w-4 h-4" />
                Navigate to Stop
              </a>

              {/* Status advancement */}
              {!isDelivered && (
                <div className="flex gap-2">
                  {nextStage && (
                    <button
                      onClick={() => onMarkStatus(order, nextStage.key)}
                      disabled={isUpdating}
                      className="flex-1 py-3 bg-primary text-primary-foreground rounded-xl text-sm font-semibold disabled:opacity-50 active:scale-95 transition-transform"
                    >
                      {isUpdating ? 'Updating...' : nextStage.key === 'delivered' ? '✓ Mark Delivered' : `→ ${nextStage.label}`}
                    </button>
                  )}
                </div>
              )}
              {isDelivered && (
                <div className="py-3 bg-green-50 text-green-700 rounded-xl text-sm font-semibold text-center border border-green-200">
                  ✓ Delivered
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function DriverRoute() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [routeData, setRouteData] = useState(null);
  const [loadingRoute, setLoadingRoute] = useState(false);
  const [updatingId, setUpdatingId] = useState(null);

  const isAuthorized = user?.role === 'driver' || user?.role === 'admin';

  const { data: bagReturns = [] } = useQuery({
    queryKey: ['driver-bag-returns-route'],
    queryFn: () => base44.entities.BagReturn.filter({ verification_status: 'requested' }, '-created_date', 200),
    enabled: isAuthorized,
    refetchInterval: 60000,
  });

  const fetchRoute = async () => {
    setLoadingRoute(true);
    try {
      const res = await base44.functions.invoke('optimizeDeliveryRoute', { date });
      setRouteData(res.data);
      if (res.data?.optimized_orders?.length === 0) {
        toast('No delivery orders found for this date');
      }
    } catch (err) {
      toast.error('Failed to load route: ' + err.message);
    } finally {
      setLoadingRoute(false);
    }
  };

  useEffect(() => {
    if (isAuthorized) fetchRoute();
  }, [date, isAuthorized]);

  const updateStatusMutation = useMutation({
    mutationFn: ({ order, status }) => {
      const newHistory = [
        ...(order.status_history || []),
        { status, timestamp: new Date().toISOString(), message: DELIVERY_STAGES.find(s => s.key === status)?.label || status },
      ];
      return base44.entities.Order.update(order.id, { status, status_history: newHistory });
    },
    onSuccess: () => {
      toast.success('Status updated');
      setUpdatingId(null);
      fetchRoute();
    },
    onError: () => { toast.error('Update failed'); setUpdatingId(null); },
  });

  const handleMarkStatus = (order, status) => {
    setUpdatingId(order.id);
    updateStatusMutation.mutate({ order, status });
  };

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background px-6 text-center">
        <Leaf className="w-10 h-10 text-primary mb-4" />
        <h1 className="font-heading text-xl font-bold mb-2">Sign In Required</h1>
        <p className="text-sm text-muted-foreground mb-6">Please sign in with your driver account.</p>
        <button
          onClick={() => base44.auth.redirectToLogin('/driver/route')}
          className="px-6 py-3 bg-primary text-primary-foreground rounded-xl text-sm font-semibold"
        >
          Sign In
        </button>
      </div>
    );
  }

  if (!isAuthorized) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background px-6 text-center">
        <XCircle className="w-10 h-10 text-destructive mb-4" />
        <h1 className="font-heading text-xl font-bold mb-2">Access Restricted</h1>
        <p className="text-sm text-muted-foreground">This area is for NuVira drivers only.</p>
      </div>
    );
  }

  const orders = routeData?.optimized_orders || [];
  const delivered = orders.filter(o => o.status === 'delivered').length;
  const remaining = orders.length - delivered;
  const bagReturnCount = bagReturns.filter(r => orders.some(o => o.customer_email === r.customer_email)).length;

  return (
    <div className="min-h-screen bg-background pb-10">
      {/* Header */}
      <div className="bg-primary px-4 pb-6" style={{ paddingTop: 'max(2.5rem, env(safe-area-inset-top))' }}>
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Route className="w-5 h-5 text-primary-foreground/70" />
            <h1 className="font-heading text-2xl font-bold text-primary-foreground">Route Planner</h1>
          </div>
          <button
            onClick={fetchRoute}
            disabled={loadingRoute}
            className="w-9 h-9 bg-white/20 rounded-full flex items-center justify-center active:scale-95 transition-transform"
          >
            <RefreshCw className={`w-4 h-4 text-white ${loadingRoute ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <p className="text-primary-foreground/60 text-xs">{user.email}</p>

        {/* Date picker */}
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          className="mt-3 w-full bg-white/20 text-white text-sm px-3 py-2 rounded-xl border border-white/30 focus:outline-none"
        />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 divide-x divide-border border-b border-border bg-card">
        {[
          { label: 'Stops', value: orders.length, color: 'text-foreground' },
          { label: 'Done', value: delivered, color: 'text-green-600' },
          { label: 'Left', value: remaining, color: 'text-primary' },
          { label: 'Returns', value: bagReturnCount, color: 'text-amber-600' },
        ].map(s => (
          <div key={s.label} className="py-3 text-center">
            <p className={`text-xl font-bold font-heading ${s.color}`}>{s.value}</p>
            <p className="text-[10px] text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Route summary */}
      {routeData?.total_distance_miles && (
        <div className="mx-4 mt-4 bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 flex items-center gap-3">
          <Clock className="w-4 h-4 text-blue-600 shrink-0" />
          <p className="text-xs text-blue-700 font-medium">
            ~{routeData.total_duration_minutes} min · {routeData.total_distance_miles} mi total route
          </p>
        </div>
      )}

      {/* Bag returns shortcut */}
      {bagReturnCount > 0 && (
        <div className="mx-4 mt-3">
          <Link to="/driver/returns">
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Recycle className="w-4 h-4 text-amber-600" />
                <p className="text-xs font-semibold text-amber-700">{bagReturnCount} bag return{bagReturnCount > 1 ? 's' : ''} to verify today</p>
              </div>
              <ChevronRight className="w-4 h-4 text-amber-600" />
            </div>
          </Link>
        </div>
      )}

      {/* Stop list */}
      <div className="px-4 mt-4 space-y-3">
        {loadingRoute ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-muted-foreground">Optimizing route...</p>
          </div>
        ) : orders.length === 0 ? (
          <div className="text-center py-16">
            <CheckCircle2 className="w-10 h-10 text-primary mx-auto mb-3" />
            <p className="text-sm font-semibold">No deliveries for this date</p>
            <p className="text-xs text-muted-foreground mt-1">Try selecting a different date above.</p>
          </div>
        ) : (
          <>
            <p className="text-xs text-muted-foreground font-medium px-1">
              {orders.length} stop{orders.length > 1 ? 's' : ''} · optimized route
            </p>
            {orders.map((order, idx) => (
              <div key={order.id} className="flex gap-2">
                <div className="flex flex-col items-center pt-4 shrink-0">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold ${order.status === 'delivered' ? 'bg-green-100 text-green-600' : 'bg-primary text-primary-foreground'}`}>
                    {order.status === 'delivered' ? '✓' : idx + 1}
                  </div>
                  {idx < orders.length - 1 && <div className="w-0.5 flex-1 bg-border mt-1" />}
                </div>
                <div className="flex-1 pb-2">
                  <StopCard
                    order={order}
                    bagReturns={bagReturns}
                    onMarkStatus={handleMarkStatus}
                    isUpdating={updatingId === order.id}
                  />
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}