import React from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { redirectToLogin } from '@/lib/nativeAuthRedirect';
import { useAuth } from '@/lib/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Truck, Car, Package, Check, AlertCircle, XCircle, Clock3, ChevronDown, CircleCheckBig, Sparkles, Navigation, ShieldCheck } from 'lucide-react';
import { SAFE_TOP_PADDING } from '@/components/layout/MobilePageHeader';
import BrowserAppPrompt from '@/components/BrowserAppPrompt';
import OrderItemThumbnail from '@/components/orders/OrderItemThumbnail';
import { buildCustomerJourneyTimeline, getCustomerOrderJourney, resolveCustomerJourneyFulfillmentType } from '@/lib/customer-order-journey';
import { format } from 'date-fns';
import { motion } from 'framer-motion';
import { orderContainsProgram } from '@/lib/program-catalog';
import { syncDeliveryLiveActivity } from '@/lib/deliveryLiveActivity';

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

function formatStatusTimestamp(value) {
  const date = parseLocalDate(value);
  if (!date || Number.isNaN(date.getTime())) return null;
  return format(date, 'MMM d · h:mm a');
}

function LiveDeliveryPanel({ etaData }) {
  const progress = Math.max(0, Math.min(100, Number(etaData?.progress_percent ?? 8)));
  const markerProgress = Math.max(3, Math.min(97, progress));
  const stopsAhead = Math.max(0, Number(etaData?.stops_ahead ?? 0));
  const statusLabel = etaData?.status_label || 'Out for delivery';
  const message = etaData?.message || 'Your NuVira delivery is moving your way.';

  return (
    <section className="mx-auto -mt-6 w-[calc(100%-2rem)] max-w-5xl overflow-hidden rounded-2xl border border-emerald-300/25 bg-[#062d21] text-white shadow-[0_20px_50px_rgba(0,0,0,0.28)]">
      <div className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-lime-300 text-[#063b2a]">
              <Navigation className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 animate-pulse rounded-full bg-lime-300" />
                <p className="text-[10px] font-black uppercase tracking-normal text-emerald-200">Live delivery</p>
              </div>
              <p className="mt-1 text-sm font-semibold text-white/85">{statusLabel}</p>
            </div>
          </div>
          <Truck className="h-5 w-5 text-emerald-200/80" />
        </div>

        <div className="mt-6 grid gap-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-normal text-white/50">Expected arrival</p>
            <p className="mt-1 font-heading text-3xl font-bold leading-none tracking-normal text-white sm:text-4xl">
              {etaData?.eta_window || 'Calculating now'}
            </p>
          </div>
          <div className="min-w-40 rounded-xl border border-white/10 bg-white/[0.06] px-4 py-3 sm:text-right">
            <p className="text-[9px] font-bold uppercase tracking-normal text-white/45">Route position</p>
            <p className="mt-1 font-heading text-xl font-bold text-white">
              {stopsAhead === 0 ? "You're next" : `${stopsAhead} stop${stopsAhead === 1 ? '' : 's'} ahead`}
            </p>
          </div>
        </div>

        <div className="mt-6 px-3">
          <div className="relative h-2 rounded-full bg-white/10">
            <motion.div
              className="absolute inset-y-0 left-0 rounded-full bg-lime-300"
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.55, ease: 'easeOut' }}
            />
            <motion.div
              aria-label={`Delivery route ${Math.round(progress)} percent complete`}
              className="absolute top-1/2 z-10 flex h-6 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-lg border-2 border-[#062d21] bg-lime-300 text-[#063b2a] shadow-[0_3px_12px_rgba(0,0,0,0.35)]"
              initial={{ left: '3%' }}
              animate={{ left: `${markerProgress}%` }}
              transition={{ duration: 0.55, ease: 'easeOut' }}
            >
              <Car className="h-3.5 w-4" strokeWidth={2.5} />
            </motion.div>
          </div>
        </div>
        <div className="mt-3 flex items-start justify-between gap-4 text-[11px] text-emerald-50/55">
          <p className="leading-relaxed">{message}</p>
          <span className="shrink-0">Updated live</span>
        </div>
        <div className="mt-4 flex items-center gap-2 border-t border-white/10 pt-3 text-[10px] text-emerald-100/55">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-300" />
          <span>ETA updates automatically. Precise driver location stays private.</span>
        </div>
      </div>
    </section>
  );
}

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

  const { data: detail, isLoading, isError, refetch, dataUpdatedAt } = useQuery({
    queryKey: ['order-detail', rawParam, sessionId, paymentIntentId, user?.email],
    queryFn: async () => {
      const res = await base44.functions.invoke('getCustomerOrderDetail', lookupPayload);
      return res.data;
    },
    enabled: !!user?.email && hasLookupKey,
    staleTime: 30 * 1000,
    refetchInterval: (query) => {
      const currentDetail = query.state.data;
      if (source === 'post_checkout' && currentDetail && !currentDetail.found) return 5000;
      if (currentDetail?.found && !currentDetail?.is_terminal) return 45000;
      return false;
    },
    refetchIntervalInBackground: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
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
  const currentStatus = deliveryStatus?.status || order?.status || hubOrder?.status || hubOrder?.production_status || 'order_received';
  const trackerFulfillmentType = resolveCustomerJourneyFulfillmentType({
    orderFulfillmentType: order?.fulfillment_type,
    hubFulfillmentMethod: hubOrder?.fulfillment_method,
    status: currentStatus,
  });
  const journey = getCustomerOrderJourney({
    status: currentStatus,
    fulfillmentType: trackerFulfillmentType,
    fallbackLabel: detail?.customer_visible_status,
  });

  // Resolve customer name
  const resolveCustomerName = () => {
    if (order?.customer_name) return order.customer_name;
    if (hubOrder?.customer_name) return hubOrder.customer_name;
    if (userProfile?.first_name && userProfile?.last_name) return `${userProfile.first_name} ${userProfile.last_name}`;
    if (userProfile?.first_name) return userProfile.first_name;
    return order?.customer_email || hubOrder?.customer_email || 'Customer';
  };

  const isOnRoute = ['out_for_delivery', 'arriving_soon'].includes(journey.normalizedStatus)
    && trackerFulfillmentType === 'delivery';

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

  React.useEffect(() => {
    if (!order?.id || !order?.order_number) return;
    if (etaData?.order_id && isOnRoute) {
      syncDeliveryLiveActivity(etaData).catch(() => null);
      return;
    }
    if (journey.normalizedStatus === 'delivered') {
      syncDeliveryLiveActivity({
        order_id: order.id,
        order_number: order.order_number,
        deep_link: `/order-tracker/${encodeURIComponent(order.order_number)}`,
        status: 'delivered',
        status_label: 'Delivered',
        activity_state: 'delivered',
        progress_percent: 100,
        sequence: Math.floor(Date.now() / 1000),
        message: 'Your NuVira delivery is complete.',
      }).catch(() => null);
    }
  }, [etaData, isOnRoute, journey.normalizedStatus, order?.id, order?.order_number]);

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
          <a href="mailto:support@nuvirajuice.com" className="block w-full px-6 py-2.5 border border-border rounded-xl font-medium text-sm text-center active:scale-95 transition-transform">
            Contact Support
          </a>
        </div>
      </div>
    );
  }

  // ── Terminal / cancelled / refunded status views ───────────────────────────
  if (['cancelled', 'refunded', 'failed'].includes(journey.normalizedStatus)) {
    const isCancelled = journey.normalizedStatus === 'cancelled';
    const isRefunded = journey.normalizedStatus === 'refunded';
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
            <a href="mailto:support@nuvirajuice.com" className="block w-full px-6 py-2.5 border border-border rounded-xl font-medium text-sm text-center">
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
                  <OrderItemThumbnail item={item} size="small" />
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
  const isPickupOrder = trackerFulfillmentType === 'pickup';
  const displayOrder = order || {
    order_number: hubOrder?.shopify_order_number || orderNumberParam,
    status: hubOrder?.status || hubOrder?.production_status || 'order_received',
    fulfillment_type: isPickupOrder ? 'pickup' : 'delivery',
    items: hubOrder?.line_items?.map(li => ({
      title: li.title,
      quantity: li.quantity,
      price: li.price,
      image_url: li.image_url || null,
      product_id: li.product_id || null,
    })) || [],
    total: hubOrder?.total_price || 0,
    estimated_delivery_date: hubOrder?.requested_delivery_date || null,
    delivery_window_label: hubOrder?.requested_time_window || null,
  };

  const stages = journey.stages;
  const currentIndex = journey.currentIndex;
  const isDelivery = displayOrder.fulfillment_type !== 'pickup';
  const displayNum = displayOrder.order_number || hubOrder?.shopify_order_number || orderNumberParam || rawParam;
  const deliveredTimelineTimestamp = [...(detail?.status_timeline || [])]
    .reverse()
    .find(entry => entry?.status === 'delivered')?.timestamp;
  const timelineByStage = buildCustomerJourneyTimeline(detail?.status_timeline, displayOrder.fulfillment_type);
  const lastUpdatedLabel = dataUpdatedAt
    ? new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(dataUpdatedAt))
    : null;
  const fulfillmentMomentLabel = journey.normalizedStatus === 'delivered'
    ? formatDeliveredAt(
        deliveryStatus?.delivered_at || order?.delivered_at || displayOrder.delivered_at || deliveredTimelineTimestamp,
        order?.assigned_delivery_date || displayOrder.estimated_delivery_date,
      )
    : journey.normalizedStatus === 'picked_up'
      ? 'Order complete'
      : isOnRoute && etaData?.eta_window
        ? etaData.eta_window
        : (displayOrder.assigned_delivery_date || displayOrder.estimated_delivery_date)
          ? formatLocalDate(displayOrder.assigned_delivery_date || displayOrder.estimated_delivery_date)
          : displayOrder.delivery_window_label || 'Next fresh batch';
  const fulfillmentMomentLabelTitle = journey.normalizedStatus === 'delivered'
    ? 'Delivered on'
    : journey.normalizedStatus === 'picked_up'
      ? 'Order status'
      : isOnRoute && etaData?.eta_window
        ? 'Estimated arrival'
        : isDelivery ? 'Expected delivery' : 'Order timing';
  const hasDeliveredProgram = journey.normalizedStatus === 'delivered' && orderContainsProgram(displayOrder);

  return (
    <div className="min-h-screen bg-[#07130f] pb-10 text-[#f3f7f2]">
      <BrowserAppPrompt pageRoute={`/order-tracker/${displayNum || ''}`} />
      <div className="border-b border-emerald-300/10 bg-[#063b2a] px-4 pb-12" style={{ paddingTop: SAFE_TOP_PADDING }}>
        <div className="mx-auto max-w-5xl">
        <div className="mb-8 mt-3 flex items-center justify-between">
          <button onClick={() => navigate(-1)} className="w-10 h-10 bg-white/15 border border-white/15 rounded-full flex items-center justify-center active:scale-95 transition-transform" aria-label="Back">
            <ArrowLeft className="w-4 h-4 text-white" />
          </button>
          <div className="text-right">
            <p className="text-white/60 text-[10px] uppercase tracking-[0.18em]">Order #{displayNum}</p>
            <p className="text-white/85 text-xs font-medium">{resolveCustomerName()}</p>
          </div>
        </div>

        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-lime-300/25 bg-lime-300/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-lime-200">
              <span className={`w-1.5 h-1.5 rounded-full bg-lime-300 ${journey.isTerminal ? '' : 'animate-pulse'}`} />
              {journey.isTerminal ? 'Complete' : 'Live status'}
            </span>
            {lastUpdatedLabel && <span className="text-[10px] text-white/55">Updated {lastUpdatedLabel}</span>}
          </div>
          <h1 className="max-w-2xl font-heading text-[2.15rem] font-bold leading-[1.05] text-white sm:text-[2.75rem]">{journey.statusLabel}</h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-emerald-50/70 sm:text-base">{journey.statusDescription}</p>
        </motion.div>

        {!isOnRoute && <div className="mt-8 flex items-center gap-4 border-t border-white/10 pt-5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-lime-300 text-[#063b2a] shadow-[0_8px_24px_rgba(163,230,53,0.16)]">
            {isDelivery ? <Truck className="w-5 h-5" /> : <Package className="w-5 h-5" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-100/55">{fulfillmentMomentLabelTitle}</p>
            <p className="font-heading text-xl font-bold leading-snug text-white sm:text-2xl">{fulfillmentMomentLabel}</p>
            {displayOrder.delivery_window_label && !isOnRoute && !journey.isTerminal && (
              <p className="mt-1 text-xs text-emerald-50/60">{displayOrder.delivery_window_label}</p>
            )}
          </div>
        </div>}
        </div>
      </div>

      {isOnRoute && <LiveDeliveryPanel etaData={etaData} />}

      <section className={`mx-auto w-[calc(100%-2rem)] max-w-5xl rounded-2xl border border-[#1d4635] bg-[#0b1d16] p-5 shadow-[0_20px_50px_rgba(0,0,0,0.24)] sm:p-6 ${isOnRoute ? 'mt-4' : '-mt-6'}`}>
        <div className="flex items-end justify-between gap-3 mb-5">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-200/55">Freshness journey</p>
            <p className="mt-0.5 font-heading text-xl font-bold text-white">
              {currentIndex >= 0 ? `Step ${currentIndex + 1} of ${stages.length}` : 'Processing your order'}
            </p>
          </div>
          <span className="text-sm font-bold text-lime-300">{journey.progressPercent}%</span>
        </div>

        <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
          <motion.div
            className="h-full rounded-full bg-lime-300"
            initial={{ width: 0 }}
            animate={{ width: `${journey.progressPercent}%` }}
            transition={{ duration: 0.55, ease: 'easeOut' }}
          />
        </div>
        <div className="mt-4 grid gap-1" style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }}>
            {stages.map(stage => {
              const isCurrent = stage.state === 'current';
              const isComplete = stage.state === 'complete';
              return (
                <div key={stage.key} className="flex min-w-0 flex-col items-center text-center">
                  <div className={`flex h-7 w-7 items-center justify-center rounded-full border transition-all ${
                    isCurrent ? 'border-lime-300 bg-lime-300 text-[#063b2a] ring-4 ring-lime-300/10'
                      : isComplete ? 'border-emerald-300/70 bg-emerald-300/15 text-emerald-200'
                      : 'border-white/10 bg-white/[0.04] text-white/30'
                  }`}>
                    {isComplete || (isCurrent && journey.isTerminal)
                      ? <Check className="h-3.5 w-3.5" />
                      : <span className={`h-1.5 w-1.5 rounded-full ${isCurrent ? 'bg-[#063b2a]' : 'bg-white/25'}`} />}
                  </div>
                  <p className={`mt-2 text-[9px] font-semibold leading-tight ${isCurrent ? 'text-lime-200' : isComplete ? 'text-emerald-50/70' : 'text-white/35'}`}>{stage.label}</p>
                </div>
              );
            })}
        </div>

        <div className="mt-5 flex gap-3 border-t border-white/10 pt-5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-300/10">
            {journey.isTerminal ? <CircleCheckBig className="w-4 h-4 text-emerald-200" /> : <Sparkles className="w-4 h-4 text-emerald-200" />}
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-emerald-200">{journey.isTerminal ? 'Journey complete' : "What's happening now"}</p>
            <p className="mt-1 text-sm leading-relaxed text-emerald-50/65">{journey.statusDescription}</p>
          </div>
        </div>
      </section>

      {journey.normalizedStatus === 'delivered' && (deliveryStatus?.delivery_photo_url || deliveryStatus?.delivery_drop_location) && (
        <section className="mx-auto mt-4 w-[calc(100%-2rem)] max-w-5xl rounded-2xl border border-[#1d4635] bg-[#0b1d16] p-4 sm:p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-emerald-200/60">Delivery confirmation</h2>
            <Check className="w-4 h-4 text-lime-300" />
          </div>
          {deliveryStatus?.delivery_photo_url && <div className="rounded-2xl overflow-hidden border border-border/40">
            <img src={deliveryStatus.delivery_photo_url} alt="Delivery proof" className="max-h-[28rem] w-full object-cover" />
          </div>}
          {deliveryStatus?.delivery_drop_location && (
            <p className="mt-3 text-sm text-emerald-50/60">Left at <span className="font-semibold text-white">{deliveryStatus.delivery_drop_location}</span></p>
          )}
        </section>
      )}

      <div className="mx-auto mt-4 w-[calc(100%-2rem)] max-w-5xl space-y-3 sm:grid sm:grid-cols-2 sm:gap-3 sm:space-y-0">
        <details className="group overflow-hidden rounded-2xl border border-[#1d4635] bg-[#0b1d16]">
          <summary className="flex cursor-pointer list-none items-center justify-between p-4 active:bg-white/[0.04]">
            <div className="flex items-center gap-3">
              <Clock3 className="w-4 h-4 text-emerald-200" />
              <div>
                <p className="text-sm font-semibold">Status history</p>
                <p className="text-[11px] text-emerald-50/45">See when each milestone was reached</p>
              </div>
            </div>
            <ChevronDown className="w-4 h-4 text-emerald-50/45 transition-transform group-open:rotate-180" />
          </summary>
          <div className="border-t border-white/10 px-4 py-2">
            {stages.filter(stage => stage.state !== 'upcoming').map((stage, index, visibleStages) => {
              const event = timelineByStage[stage.key];
              const timestamp = formatStatusTimestamp(event?.timestamp);
              return (
                <div key={stage.key} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className={`mt-3 w-6 h-6 rounded-full flex items-center justify-center ${stage.state === 'current' ? 'bg-lime-300 text-[#063b2a]' : 'bg-emerald-300/10 text-emerald-200'}`}>
                      {stage.state === 'complete' ? <Check className="w-3 h-3" /> : <span className="w-1.5 h-1.5 rounded-full bg-current" />}
                    </div>
                    {index < visibleStages.length - 1 && <div className="min-h-6 w-px flex-1 bg-white/10" />}
                  </div>
                  <div className="py-3 flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-sm font-semibold">{stage.label}</p>
                      <p className="shrink-0 text-[10px] text-emerald-50/40">{timestamp || (stage.state === 'current' ? 'Current' : 'Completed')}</p>
                    </div>
                    {(event?.message || stage.state === 'current') && (
                      <p className="mt-0.5 text-xs text-emerald-50/50">{event?.message || journey.statusDescription}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </details>

        <details className="group overflow-hidden rounded-2xl border border-[#1d4635] bg-[#0b1d16]">
          <summary className="flex cursor-pointer list-none items-center justify-between p-4 active:bg-white/[0.04]">
            <div className="flex items-center gap-3">
              <Package className="w-4 h-4 text-emerald-200" />
              <div>
                <p className="text-sm font-semibold">Order details</p>
                <p className="text-[11px] text-emerald-50/45">{displayOrder.items?.length || 0} items · ${(displayOrder.total || 0).toFixed(2)}</p>
              </div>
            </div>
            <ChevronDown className="w-4 h-4 text-emerald-50/45 transition-transform group-open:rotate-180" />
          </summary>
          <div className="divide-y divide-white/10 border-t border-white/10">
            {displayOrder.items?.map((item, i) => (
              <div key={i} className="flex items-center gap-3 p-4">
                <OrderItemThumbnail item={item} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{item.title}</p>
                  <p className="text-xs text-emerald-50/45">Qty: {item.quantity}</p>
                </div>
                <p className="text-sm font-bold">${((item.price || 0) * (item.quantity || 1)).toFixed(2)}</p>
              </div>
            ))}
            <div className="flex justify-between bg-white/[0.035] px-4 py-3">
              <p className="text-sm font-bold">Total</p>
              <p className="text-sm font-bold">${(displayOrder.total || 0).toFixed(2)}</p>
            </div>
          </div>
        </details>
      </div>

      {hasDeliveredProgram && (
        <section className="mx-auto mt-4 w-[calc(100%-2rem)] max-w-5xl overflow-hidden rounded-2xl border border-lime-300/20 bg-[#0b1d16] p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Sparkles className="h-4 w-4" /></div>
            <div className="flex-1">
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-lime-300">Your next chapter</p>
              <h2 className="mt-1 font-heading text-xl font-bold">Your program journey is ready</h2>
              <p className="mt-1 text-xs leading-relaxed text-emerald-50/50">Choose a start date that fits the refrigerated freshness window, then follow your private program guide.</p>
            </div>
          </div>
          <button type="button" onClick={() => navigate('/account/programs')} className="nuvira-gradient-button mt-4 h-11 w-full rounded-xl text-xs font-black">Open My Program Journey</button>
        </section>
      )}

      {journey.isTerminal && !['cancelled', 'refunded', 'failed'].includes(journey.normalizedStatus) && (
        <section className="mx-auto mt-4 w-[calc(100%-2rem)] max-w-5xl rounded-2xl border border-[#1d4635] bg-[#0b1d16] p-5 text-center">
          <CircleCheckBig className="mx-auto w-8 h-8 text-lime-300" />
          <h2 className="font-heading text-lg font-bold mt-2">Thank you for choosing NuVira</h2>
          <p className="mt-1 text-xs text-emerald-50/50">Return your NuVira bags and earn rewards toward a future order.</p>
          <div className="grid grid-cols-2 gap-2 mt-4">
            <button onClick={() => navigate('/return-reward')} className="rounded-xl bg-primary px-3 py-2.5 text-xs font-bold text-primary-foreground active:scale-95 transition-transform">Return + Reward</button>
            <button onClick={() => navigate('/account/orders')} className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-xs font-bold active:scale-95 transition-transform">View Orders</button>
          </div>
        </section>
      )}

      <p className="mx-4 mt-6 text-center text-[11px] text-emerald-50/40">
        Need help? <a href="mailto:support@nuvirajuice.com" className="font-semibold text-emerald-200">Contact NuVira Support</a>
      </p>
    </div>
  );
}
