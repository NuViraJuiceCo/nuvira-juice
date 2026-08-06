import React from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { redirectToLogin } from '@/lib/nativeAuthRedirect';
import { useAuth } from '@/lib/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Truck, Package, Check, AlertCircle, XCircle } from 'lucide-react';
import { SAFE_TOP_PADDING } from '@/components/layout/MobilePageHeader';
import BrowserAppPrompt from '@/components/BrowserAppPrompt';
import { format } from 'date-fns';
import { motion } from 'framer-motion';

// Parse a date string safely as a LOCAL calendar date (never UTC).
// "2026-05-09" → May 9 in local time, not May 8 at UTC midnight.
// Full ISO timestamps (containing 'T') are passed directly to Date() which is correct.
function parseLocalDate(dateStr) {
  if (!dateStr) return null;
  const s = String(dateStr);
  // Date-only: YYYY-MM-DD — parse as local to avoid off-by-one
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  // Full ISO timestamp — use native parsing (already tz-aware)
  return new Date(s);
}

function formatLocalDate(dateStr, fmt = 'EEEE, MMMM d') {
  const d = parseLocalDate(dateStr);
  if (!d) return null;
  return format(d, fmt);
}

// Format a delivered_at ISO timestamp with time for the tracker header
function formatDeliveredAt(deliveredAt, fallbackDateStr) {
  // Full ISO timestamp → show date + time
  if (deliveredAt && deliveredAt.includes('T')) {
    try {
      const d = new Date(deliveredAt);
      if (!isNaN(d.getTime())) {
        return new Intl.DateTimeFormat('en-US', {
          weekday: 'long', month: 'long', day: 'numeric',
          hour: 'numeric', minute: '2-digit',
          timeZone: 'America/Chicago',
        }).format(d) + ' CT';
      }
    } catch { /* fall through */ }
  }
  // Date-only fallback
  return formatLocalDate(deliveredAt || fallbackDateStr) || 'Delivered';
}

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
  const rawParam = window.location.pathname.split('/').pop();
  const urlParams = new URLSearchParams(window.location.search);

  // Source context: 'post_checkout' restricts finalizing screen; everything else never shows it
  const source = urlParams.get('source') || (rawParam?.startsWith('NV-') ? 'order_history' : 'order_history');
  const sessionId = urlParams.get('session_id');
  const paymentIntentId = urlParams.get('payment_intent');

  const isStripeIdentifier = rawParam?.startsWith('cs_') || rawParam?.startsWith('pi_');
  const isBase44EntityId = /^[a-f0-9]{24}$/i.test(rawParam || '');
  const isOrderNumber = Boolean(rawParam && !isStripeIdentifier && !isBase44EntityId);
  const orderId = isBase44EntityId ? rawParam : null;
  const orderNumberParam = isOrderNumber ? rawParam.replace(/^#/, '') : null;

  const navigate = useNavigate();
  const { user } = useAuth();

  // Build lookup payload
  const lookupPayload = {
    source,
    ...(orderNumberParam && { order_number: orderNumberParam }),
    ...(orderId && !orderId.startsWith('cs_') && !orderId.startsWith('pi_') && { order_id: orderId }),
    ...(sessionId && { stripe_checkout_session_id: sessionId }),
    ...(paymentIntentId && { stripe_payment_intent_id: paymentIntentId }),
    // If the rawParam looks like a Stripe session
    ...(rawParam?.startsWith('cs_') && { stripe_checkout_session_id: rawParam }),
    ...(rawParam?.startsWith('pi_') && { stripe_payment_intent_id: rawParam }),
  };

  const hasLookupKey = !!(lookupPayload.order_number || lookupPayload.order_id || lookupPayload.stripe_checkout_session_id || lookupPayload.stripe_payment_intent_id);

  const { data: detail, isLoading, isError, refetch } = useQuery({
    queryKey: ['order-detail', rawParam, sessionId, paymentIntentId, user?.email],
    queryFn: async () => {
      const res = await base44.functions.invoke('getCustomerOrderDetail', lookupPayload);
      return res.data;
    },
    enabled: !!user?.email && hasLookupKey,
    staleTime: 60 * 1000,  // 1 min — order status doesn't change faster than syncHubDeliveryStatuses (30 min)
    refetchInterval: (data) => {
      // Only poll during post_checkout sync window (waiting for webhook), stop once found
      if (source === 'post_checkout' && data && !data.found) return 5000;
      return false;
    },
    refetchIntervalInBackground: false, // stop polling when tab is inactive
    retry: 1,
  });

  const { data: userProfile } = useQuery({
    queryKey: ['order-tracker-profile', user?.email],
    queryFn: async () => {
      if (!user?.email) return null;
      const profiles = await base44.entities.UserProfile.filter({ customer_email: user.email });
      return profiles[0] || null;
    },
    enabled: !!user?.email,
    staleTime: 5 * 60 * 1000,
  });

  const order = detail?.order;
  const hubOrder = detail?.hub_order;
  const deliveryStatus = detail?.delivery_status;

  // Resolve customer name
  const resolveCustomerName = () => {
    if (order?.customer_name) return order.customer_name;
    if (hubOrder?.customer_name) return hubOrder.customer_name;
    if (userProfile?.first_name && userProfile?.last_name) return `${userProfile.first_name} ${userProfile.last_name}`;
    if (userProfile?.first_name) return userProfile.first_name;
    return order?.customer_email || hubOrder?.customer_email || 'Customer';
  };

  const isOnRoute = ['out_for_delivery', 'arriving_soon'].includes(order?.status) && order?.fulfillment_type === 'delivery';

  const { data: etaData } = useQuery({
    queryKey: ['delivery-eta', order?.id],
    queryFn: async () => {
      const res = await base44.functions.invoke('getDeliveryEta', { order_id: order.id });
      return res.data;
    },
    enabled: !!order?.id && isOnRoute,
    staleTime: 3 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,   // every 5 min (was 3 min) — only fires when isOnRoute
    refetchIntervalInBackground: false, // pause when tab inactive
  });

  // ── Error state (network/5xx failure only — lookup errors now return found:false) ──
  if (isError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
        <AlertCircle className="w-10 h-10 text-muted-foreground mb-3" />
        <h2 className="font-heading text-lg font-bold mb-2">Connection Problem</h2>
        <p className="text-sm text-muted-foreground mb-4">We couldn't reach the server. Check your connection and try again.</p>
        <button onClick={() => refetch()} className="px-6 py-2.5 nuvira-gradient-button rounded-xl font-medium text-sm mb-3">
          Try Again
        </button>
        <button onClick={() => navigate('/account/orders')} className="px-6 py-2.5 bg-secondary text-foreground rounded-xl font-medium text-sm">
          Back to Orders
        </button>
      </div>
    );
  }

  // ── Loading state ──────────────────────────────────────────────────────────
  if (isLoading || (!detail && user?.email && hasLookupKey)) {
    return (
      <div className="min-h-screen bg-background">
        <div className="bg-nuvira-gradient px-4 pb-6" style={{ paddingTop: SAFE_TOP_PADDING }}>
          <button onClick={() => navigate(-1)} className="w-9 h-9 bg-white/20 rounded-full flex items-center justify-center mb-4 mt-3">
            <ArrowLeft className="w-4 h-4 text-white" />
          </button>
          <div className="h-4 w-32 bg-white/20 rounded animate-pulse mb-2" />
          <div className="h-7 w-48 bg-white/20 rounded animate-pulse" />
        </div>
        <div className="mx-4 mt-6 space-y-3">
          {[1,2,3,4].map(i => <div key={i} className="h-14 bg-secondary/50 rounded-xl animate-pulse" />)}
        </div>
      </div>
    );
  }

  // ── Not authenticated ──────────────────────────────────────────────────────
  if (!user?.email) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
        <AlertCircle className="w-10 h-10 text-muted-foreground mb-3" />
        <h2 className="font-heading text-lg font-bold mb-2">Sign In Required</h2>
        <p className="text-sm text-muted-foreground mb-4">Please sign in to view your order.</p>
        <button onClick={() => redirectToLogin(window.location.pathname)} className="px-6 py-2.5 nuvira-gradient-button rounded-xl font-medium text-sm">
          Sign In
        </button>
      </div>
    );
  }

  // ── Order not found ────────────────────────────────────────────────────────
  if (detail && !detail.found) {
    // HARD GUARD: Finalizing is ONLY allowed when ALL three are true:
    // 1. source is explicitly 'post_checkout'
    // 2. a Stripe session or payment intent was provided
    // 3. backend confirmed is_recent_checkout_pending
    const hasStripeIdentifier = !!(sessionId || paymentIntentId || rawParam?.startsWith('cs_') || rawParam?.startsWith('pi_'));
    const isPostCheckoutPending = source === 'post_checkout' && hasStripeIdentifier && detail.is_recent_checkout_pending === true;
    const displayOrderNum = orderNumberParam || rawParam;

    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
        <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
          {isPostCheckoutPending
            ? <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            : <AlertCircle className="w-8 h-8 text-muted-foreground" />
          }
        </div>
        <h2 className="font-heading text-lg font-bold mb-1">
          {isPostCheckoutPending ? 'Finalizing Your Order…' : 'Order Not Found'}
        </h2>
        <p className="text-sm text-muted-foreground mb-6 max-w-xs leading-relaxed">
          {isPostCheckoutPending
            ? 'Your order was placed successfully. Details are still syncing — please check back in a moment.'
            : detail?.reason === 'ORDER_LOOKUP_ERROR'
              ? 'There was a problem loading this order. Please try again or contact support.'
              : `This order is no longer available${displayOrderNum ? ` (${displayOrderNum})` : ''}. It may have been removed or was never fully placed. Contact NuVira Support if you believe this is an error.`
          }
        </p>

        <div className="space-y-2.5 w-full max-w-xs">
          {isPostCheckoutPending && (
            <button onClick={() => refetch()} className="w-full px-6 py-2.5 nuvira-gradient-button rounded-xl font-medium text-sm active:scale-95 transition-transform">
              Try Again
            </button>
          )}
          <button onClick={() => navigate('/account/orders')} className="w-full px-6 py-2.5 bg-secondary text-foreground rounded-xl font-medium text-sm active:scale-95 transition-transform">
            Back to Orders
          </button>
          <a href="mailto:info@nuvirajuice.com" className="block w-full px-6 py-2.5 border border-border rounded-xl font-medium text-sm text-center active:scale-95 transition-transform">
            Contact Support
          </a>
        </div>
      </div>
    );
  }

  // ── Terminal / cancelled / refunded status views ───────────────────────────
  const currentStatus = order?.status || hubOrder?.status || hubOrder?.production_status || 'unknown';

  if (['cancelled', 'refunded', 'failed'].includes(currentStatus)) {
    const isCancelled = currentStatus === 'cancelled';
    const isRefunded = currentStatus === 'refunded';
    const displayNum = order?.order_number || hubOrder?.shopify_order_number || orderNumberParam || rawParam;

    return (
      <div className="min-h-screen bg-background pb-8">
        <div className="bg-muted px-4 pb-6" style={{ paddingTop: SAFE_TOP_PADDING }}>
          <button onClick={() => navigate(-1)} className="w-9 h-9 bg-background/50 rounded-full flex items-center justify-center mb-4 mt-3">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">Order #{displayNum} • {resolveCustomerName()}</p>
          <h1 className="font-heading text-2xl font-bold mt-0.5">{isCancelled ? 'Order Cancelled' : isRefunded ? 'Order Refunded' : 'Payment Failed'}</h1>
        </div>

        <div className="mx-4 mt-6 bg-card border border-border/50 rounded-2xl p-5 text-center">
          <XCircle className="w-10 h-10 mx-auto mb-3 text-destructive/70" />
          <p className="font-semibold text-sm mb-1">
            {isCancelled ? 'This order was cancelled.' : isRefunded ? 'A refund has been issued for this order.' : 'Payment was not completed.'}
          </p>
          <p className="text-xs text-muted-foreground mb-4">
            {isRefunded
              ? 'Refunds typically appear within 5–10 business days depending on your bank.'
              : 'If you believe this is an error, please contact NuVira support.'}
          </p>
          {order?.created_date && (
            <p className="text-xs text-muted-foreground mb-4">
              Order date: {formatLocalDate(order.created_date, 'MMMM d, yyyy')}
            </p>
          )}
          <div className="space-y-2">
            <button onClick={() => navigate('/account/orders')} className="w-full px-6 py-2.5 bg-secondary text-foreground rounded-xl font-medium text-sm">
              Back to Orders
            </button>
            <a href="mailto:info@nuvirajuice.com" className="block w-full px-6 py-2.5 border border-border rounded-xl font-medium text-sm text-center">
              Contact Support
            </a>
          </div>
        </div>

        {/* Show items if available */}
        {order?.items?.length > 0 && (
          <div className="mx-4 mt-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground/55 mb-3">Items in This Order</h2>
            <div className="bg-card rounded-2xl border border-border/40 overflow-hidden divide-y divide-border/40">
              {order.items.map((item, i) => (
                <div key={i} className="flex items-center gap-3 p-4">
                  <div className="w-10 h-10 bg-secondary rounded-xl overflow-hidden shrink-0">
                    {item.image_url ? <img src={item.image_url} alt={item.title} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-lg">🍊</div>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{item.title}</p>
                    <p className="text-xs text-foreground/55">Qty: {item.quantity}</p>
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
        )}
      </div>
    );
  }

  // ── Normal order detail view ───────────────────────────────────────────────
  const isPickupOrder = order?.fulfillment_type === 'pickup'
    || hubOrder?.fulfillment_method === 'pickup'
    || ['ready_for_pickup', 'picked_up'].includes(currentStatus);
  const displayOrder = order || {
    order_number: hubOrder?.shopify_order_number || orderNumberParam,
    status: hubOrder?.status || hubOrder?.production_status || 'order_received',
    fulfillment_type: isPickupOrder ? 'pickup' : 'delivery',
    items: hubOrder?.line_items?.map(li => ({
      title: li.title,
      quantity: li.quantity,
      price: li.price,
      image_url: null,
    })) || [],
    total: hubOrder?.total_price || 0,
    estimated_delivery_date: hubOrder?.requested_delivery_date || null,
    delivery_window_label: hubOrder?.requested_time_window || null,
  };

  const stages = displayOrder.fulfillment_type === 'pickup' ? PICKUP_STAGES : DELIVERY_STAGES;
  const currentIndex = stages.findIndex(s => s.key === displayOrder.status);
  const isDelivery = displayOrder.fulfillment_type !== 'pickup';
  const displayNum = displayOrder.order_number || hubOrder?.shopify_order_number || orderNumberParam || rawParam;

  return (
    <div className="pb-8 min-h-screen bg-background">
      <BrowserAppPrompt pageRoute={`/order-tracker/${displayNum || ''}`} />
      {/* Header — G40D: safe-area-inset-top so back button never sits under iOS status bar */}
      <div className="bg-nuvira-gradient px-4 pb-6" style={{ paddingTop: SAFE_TOP_PADDING }}>
        <button onClick={() => navigate(-1)} className="w-9 h-9 bg-white/20 rounded-full flex items-center justify-center mb-4 mt-3">
          <ArrowLeft className="w-4 h-4 text-white" />
        </button>
        <p className="text-white/70 text-xs font-medium uppercase tracking-wider">Order #{displayNum} • {resolveCustomerName()}</p>
        <h1 className="font-heading text-2xl font-bold text-white mt-0.5">
          {currentStatus === 'delivered' ? 'Order Delivered' : currentStatus === 'picked_up' ? 'Order Picked Up' : 'Track Your Order'}
        </h1>

        {/* ETA / Date Card */}
        <div className="mt-4 bg-white/15 rounded-2xl p-4 flex items-start gap-3">
          <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center shrink-0 mt-0.5">
            {isDelivery ? <Truck className="w-5 h-5 text-white" /> : <Package className="w-5 h-5 text-white" />}
          </div>
          <div className="flex-1">
            <p className="text-primary-foreground/70 text-xs">
              {currentStatus === 'delivered' ? 'Delivered On'
                : currentStatus === 'picked_up' ? 'Pickup Status'
                : isOnRoute && etaData?.eta_window ? 'Estimated Arrival Window'
                : isDelivery ? 'Estimated Delivery'
                : 'Estimated Pickup'}
            </p>
            <p className="font-heading text-xl font-bold text-white">
              {currentStatus === 'delivered'
              // Priority: delivered_at (full timestamp with time) → assigned_delivery_date → estimated_delivery_date
              ? formatDeliveredAt(deliveryStatus?.delivered_at, order?.assigned_delivery_date || displayOrder.estimated_delivery_date)
                : currentStatus === 'picked_up'
                  ? 'Pickup complete'
                : isOnRoute && etaData?.eta_window
                  ? etaData.eta_window
                  : (displayOrder.assigned_delivery_date || displayOrder.estimated_delivery_date)
                    ? formatLocalDate(displayOrder.assigned_delivery_date || displayOrder.estimated_delivery_date)
                    : displayOrder.delivery_window_label
                      ? displayOrder.delivery_window_label
                      : 'Next fresh batch'}
            </p>
            {isOnRoute && etaData?.message && (
              <div className="flex items-center gap-1.5 mt-1.5">
                <div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse shrink-0" />
                <p className="text-white/80 text-xs font-medium">{etaData.message}</p>
              </div>
            )}
          </div>
        </div>

        {/* Delivery proof for delivered orders */}
        {currentStatus === 'delivered' && deliveryStatus?.delivery_drop_location && (
          <div className="mt-3 bg-white/10 rounded-xl px-4 py-2.5">
            <p className="text-white/70 text-xs">Left at: <span className="text-white font-medium">{deliveryStatus.delivery_drop_location}</span></p>
          </div>
        )}
      </div>

      {/* Live Delivery Progress Card */}
      {isOnRoute && etaData?.on_route && (
        <div className="mx-4 mt-4 bg-emerald-50 border border-emerald-200 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse shrink-0" />
            <p className="text-xs font-bold text-emerald-700 uppercase tracking-wide">Driver is on the way</p>
          </div>
          {etaData.stops_total > 1 && (
            <div className="mb-3">
              <div className="flex gap-1">
                {Array.from({ length: etaData.stops_total }).map((_, i) => {
                  const isDone = i < etaData.stops_delivered;
                  const isYours = i === etaData.stops_total - etaData.stops_remaining + etaData.stops_ahead;
                  return (
                    <div key={i} className={`h-2 flex-1 rounded-full transition-all ${isDone ? 'bg-emerald-500' : isYours ? 'bg-emerald-300 animate-pulse' : 'bg-emerald-100'}`} />
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
          <p className="text-[10px] text-emerald-600/70 mt-2.5 text-center">ETA updates automatically · Driver location is private</p>
        </div>
      )}

      {/* Delivery proof photo */}
      {currentStatus === 'delivered' && deliveryStatus?.delivery_photo_url && (
        <div className="mx-4 mt-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground/55 mb-2">Delivery Photo</h2>
          <div className="rounded-2xl overflow-hidden border border-border/40">
            <img src={deliveryStatus.delivery_photo_url} alt="Delivery proof" className="w-full object-cover max-h-56" />
          </div>
        </div>
      )}

      {/* Progress Tracker */}
      <div className="mx-4 mt-5">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground/55 mb-4">Status Updates</h2>
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
                    isCurrent ? 'bg-nuvira-gradient border-transparent text-white ring-4 ring-primary/20'
                    : isCompleted ? 'bg-nuvira-gradient border-transparent text-white'
                    : 'bg-background border-border text-muted-foreground'
                  }`}>
                    {isCompleted ? <Check className="w-4 h-4" /> : <div className="w-2 h-2 rounded-full bg-muted-foreground/30" />}
                  </div>
                  {index < stages.length - 1 && (
                    <div className={`w-0.5 h-12 transition-colors ${index < currentIndex ? 'bg-nuvira-gradient' : 'bg-border'}`} />
                  )}
                </div>
                <div className="pb-10 pt-1.5">
                  <p className={`text-sm font-semibold ${isCurrent ? 'text-primary' : isCompleted ? 'text-foreground' : 'text-muted-foreground'}`}>{stage.label}</p>
                  <p className={`text-xs mt-0.5 ${isCurrent ? 'text-foreground/70' : 'text-muted-foreground'}`}>{stage.desc}</p>
                  {isCurrent && !detail?.is_terminal && (
                    <span className="inline-block mt-1.5 text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">In Progress</span>
                  )}
                  {isCurrent && detail?.is_terminal && currentStatus === 'delivered' && (
                    <span className="inline-block mt-1.5 text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">✓ Complete</span>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Order Items */}
      <div className="mx-4 mt-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground/55 mb-3">Your Items</h2>
        <div className="bg-card rounded-2xl border border-border/40 overflow-hidden divide-y divide-border/40">
          {displayOrder.items?.map((item, i) => (
            <div key={i} className="flex items-center gap-3 p-4">
              <div className="w-12 h-12 bg-secondary rounded-xl overflow-hidden shrink-0">
                {item.image_url
                  ? <img src={item.image_url} alt={item.title} className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center text-xl">🍊</div>}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{item.title}</p>
                <p className="text-xs text-foreground/55">Qty: {item.quantity}</p>
              </div>
              <p className="text-sm font-bold">${((item.price || 0) * (item.quantity || 1)).toFixed(2)}</p>
            </div>
          ))}
          <div className="px-4 py-3 flex justify-between">
            <p className="text-sm font-bold">Total</p>
            <p className="text-sm font-bold">${(displayOrder.total || 0).toFixed(2)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
