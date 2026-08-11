import React from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { redirectToLogin } from '@/lib/nativeAuthRedirect';
import { useAuth } from '@/lib/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Truck, Package, Check, AlertCircle, XCircle, Clock3, ChevronDown, CircleCheckBig, Sparkles } from 'lucide-react';
import { SAFE_TOP_PADDING } from '@/components/layout/MobilePageHeader';
import BrowserAppPrompt from '@/components/BrowserAppPrompt';
import OrderItemThumbnail from '@/components/orders/OrderItemThumbnail';
import { buildCustomerJourneyTimeline, getCustomerOrderJourney, resolveCustomerJourneyFulfillmentType } from '@/lib/customer-order-journey';
import { format } from 'date-fns';
import { motion } from 'framer-motion';
import { orderContainsProgram } from '@/lib/program-catalog';

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
    <div className="pb-10 min-h-screen bg-background">
      <BrowserAppPrompt pageRoute={`/order-tracker/${displayNum || ''}`} />
      <div className="bg-nuvira-gradient px-4 pb-10" style={{ paddingTop: SAFE_TOP_PADDING }}>
        <div className="flex items-center justify-between mb-7 mt-3">
          <button onClick={() => navigate(-1)} className="w-10 h-10 bg-white/15 border border-white/15 rounded-full flex items-center justify-center active:scale-95 transition-transform" aria-label="Back">
            <ArrowLeft className="w-4 h-4 text-white" />
          </button>
          <div className="text-right">
            <p className="text-white/60 text-[10px] uppercase tracking-[0.18em]">Order #{displayNum}</p>
            <p className="text-white/85 text-xs font-medium">{resolveCustomerName()}</p>
          </div>
        </div>

        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex items-center gap-2 mb-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white">
              <span className={`w-1.5 h-1.5 rounded-full ${journey.isTerminal ? 'bg-white' : 'bg-lime-300 animate-pulse'}`} />
              {journey.isTerminal ? 'Complete' : 'Live status'}
            </span>
            {lastUpdatedLabel && <span className="text-[10px] text-white/55">Updated {lastUpdatedLabel}</span>}
          </div>
          <h1 className="font-heading text-[2rem] leading-tight font-bold text-white">{journey.statusLabel}</h1>
          <p className="text-sm leading-relaxed text-white/75 mt-2 max-w-sm">{journey.statusDescription}</p>
        </motion.div>

        <div className="mt-6 rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur-sm flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-white/15 flex items-center justify-center shrink-0">
            {isDelivery ? <Truck className="w-5 h-5 text-white" /> : <Package className="w-5 h-5 text-white" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-wider text-white/60">{fulfillmentMomentLabelTitle}</p>
            <p className="font-heading text-lg font-bold text-white leading-snug">{fulfillmentMomentLabel}</p>
            {displayOrder.delivery_window_label && !isOnRoute && !journey.isTerminal && (
              <p className="text-xs text-white/65 mt-0.5">{displayOrder.delivery_window_label}</p>
            )}
          </div>
        </div>
      </div>

      <section className="mx-4 -mt-5 rounded-3xl border border-border/50 bg-card p-5 shadow-[0_18px_50px_rgba(9,56,36,0.10)]">
        <div className="flex items-end justify-between gap-3 mb-5">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-bold">Freshness journey</p>
            <p className="font-heading text-lg font-bold mt-0.5">
              {currentIndex >= 0 ? `Step ${currentIndex + 1} of ${stages.length}` : 'Processing your order'}
            </p>
          </div>
          <span className="text-xs font-bold text-primary">{journey.progressPercent}%</span>
        </div>

        <div className="relative px-2">
          <div className="absolute left-5 right-5 top-3 h-1 rounded-full bg-secondary" />
          <motion.div
            className="absolute left-5 top-3 h-1 rounded-full bg-nuvira-gradient"
            initial={{ width: 0 }}
            animate={{ width: `calc((100% - 2.5rem) * ${journey.progressPercent / 100})` }}
            transition={{ duration: 0.55, ease: 'easeOut' }}
          />
          <div className="relative grid gap-1" style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }}>
            {stages.map(stage => {
              const isCurrent = stage.state === 'current';
              const isComplete = stage.state === 'complete';
              return (
                <div key={stage.key} className="flex min-w-0 flex-col items-center text-center">
                  <div className={`z-10 flex h-7 w-7 items-center justify-center rounded-full border-2 transition-all ${
                    isCurrent ? 'border-primary bg-primary text-primary-foreground ring-4 ring-primary/15'
                      : isComplete ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-card text-muted-foreground'
                  }`}>
                    {isComplete || (isCurrent && journey.isTerminal)
                      ? <Check className="h-3.5 w-3.5" />
                      : <span className={`h-1.5 w-1.5 rounded-full ${isCurrent ? 'bg-primary-foreground' : 'bg-muted-foreground/35'}`} />}
                  </div>
                  <p className={`mt-2 text-[9px] leading-tight font-semibold ${isCurrent ? 'text-primary' : isComplete ? 'text-foreground/75' : 'text-muted-foreground/65'}`}>{stage.label}</p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-5 rounded-2xl bg-primary/[0.07] p-4 flex gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            {journey.isTerminal ? <CircleCheckBig className="w-4 h-4 text-primary" /> : <Sparkles className="w-4 h-4 text-primary" />}
          </div>
          <div>
            <p className="text-xs font-bold text-primary uppercase tracking-wide">{journey.isTerminal ? 'Journey complete' : "What's happening now"}</p>
            <p className="text-sm text-foreground/75 mt-1 leading-relaxed">{journey.statusDescription}</p>
          </div>
        </div>
      </section>

      {isOnRoute && etaData?.on_route && (
        <section className="mx-4 mt-4 bg-emerald-50 border border-emerald-200 rounded-3xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse shrink-0" />
            <div>
              <p className="text-xs font-bold text-emerald-700 uppercase tracking-wide">Driver is on the way</p>
              {etaData?.message && <p className="text-xs text-emerald-700/75 mt-0.5">{etaData.message}</p>}
            </div>
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
        </section>
      )}

      {journey.normalizedStatus === 'delivered' && (deliveryStatus?.delivery_photo_url || deliveryStatus?.delivery_drop_location) && (
        <section className="mx-4 mt-4 rounded-3xl border border-border/50 bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-foreground/55">Delivery confirmation</h2>
            <Check className="w-4 h-4 text-primary" />
          </div>
          {deliveryStatus?.delivery_photo_url && <div className="rounded-2xl overflow-hidden border border-border/40">
            <img src={deliveryStatus.delivery_photo_url} alt="Delivery proof" className="w-full object-cover max-h-56" />
          </div>}
          {deliveryStatus?.delivery_drop_location && (
            <p className="mt-3 text-sm text-muted-foreground">Left at <span className="font-semibold text-foreground">{deliveryStatus.delivery_drop_location}</span></p>
          )}
        </section>
      )}

      <div className="mx-4 mt-4 space-y-3">
        <details className="group rounded-2xl border border-border/50 bg-card overflow-hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between p-4 active:bg-secondary/40">
            <div className="flex items-center gap-3">
              <Clock3 className="w-4 h-4 text-primary" />
              <div>
                <p className="text-sm font-semibold">Status history</p>
                <p className="text-[11px] text-muted-foreground">See when each milestone was reached</p>
              </div>
            </div>
            <ChevronDown className="w-4 h-4 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="border-t border-border/40 px-4 py-2">
            {stages.filter(stage => stage.state !== 'upcoming').map((stage, index, visibleStages) => {
              const event = timelineByStage[stage.key];
              const timestamp = formatStatusTimestamp(event?.timestamp);
              return (
                <div key={stage.key} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className={`mt-3 w-6 h-6 rounded-full flex items-center justify-center ${stage.state === 'current' ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary'}`}>
                      {stage.state === 'complete' ? <Check className="w-3 h-3" /> : <span className="w-1.5 h-1.5 rounded-full bg-current" />}
                    </div>
                    {index < visibleStages.length - 1 && <div className="w-px flex-1 bg-border min-h-6" />}
                  </div>
                  <div className="py-3 flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-sm font-semibold">{stage.label}</p>
                      <p className="text-[10px] text-muted-foreground shrink-0">{timestamp || (stage.state === 'current' ? 'Current' : 'Completed')}</p>
                    </div>
                    {(event?.message || stage.state === 'current') && (
                      <p className="text-xs text-muted-foreground mt-0.5">{event?.message || journey.statusDescription}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </details>

        <details className="group rounded-2xl border border-border/50 bg-card overflow-hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between p-4 active:bg-secondary/40">
            <div className="flex items-center gap-3">
              <Package className="w-4 h-4 text-primary" />
              <div>
                <p className="text-sm font-semibold">Order details</p>
                <p className="text-[11px] text-muted-foreground">{displayOrder.items?.length || 0} items · ${(displayOrder.total || 0).toFixed(2)}</p>
              </div>
            </div>
            <ChevronDown className="w-4 h-4 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="border-t border-border/40 divide-y divide-border/40">
            {displayOrder.items?.map((item, i) => (
              <div key={i} className="flex items-center gap-3 p-4">
                <OrderItemThumbnail item={item} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{item.title}</p>
                  <p className="text-xs text-foreground/55">Qty: {item.quantity}</p>
                </div>
                <p className="text-sm font-bold">${((item.price || 0) * (item.quantity || 1)).toFixed(2)}</p>
              </div>
            ))}
            <div className="px-4 py-3 flex justify-between bg-secondary/25">
              <p className="text-sm font-bold">Total</p>
              <p className="text-sm font-bold">${(displayOrder.total || 0).toFixed(2)}</p>
            </div>
          </div>
        </details>
      </div>

      {hasDeliveredProgram && (
        <section className="mx-4 mt-4 overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-br from-primary/12 via-card to-accent/10 p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Sparkles className="h-4 w-4" /></div>
            <div className="flex-1">
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-primary">Your next chapter</p>
              <h2 className="mt-1 font-heading text-xl font-bold">Your program journey is ready</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Choose a start date that fits the refrigerated freshness window, then follow your private program guide.</p>
            </div>
          </div>
          <button type="button" onClick={() => navigate('/account/programs')} className="nuvira-gradient-button mt-4 h-11 w-full rounded-xl text-xs font-black">Open My Program Journey</button>
        </section>
      )}

      {journey.isTerminal && !['cancelled', 'refunded', 'failed'].includes(journey.normalizedStatus) && (
        <section className="mx-4 mt-4 rounded-3xl bg-primary/[0.07] p-5 text-center">
          <CircleCheckBig className="w-8 h-8 text-primary mx-auto" />
          <h2 className="font-heading text-lg font-bold mt-2">Thank you for choosing NuVira</h2>
          <p className="text-xs text-muted-foreground mt-1">Return your NuVira bags and earn rewards toward a future order.</p>
          <div className="grid grid-cols-2 gap-2 mt-4">
            <button onClick={() => navigate('/return-reward')} className="rounded-xl bg-primary px-3 py-2.5 text-xs font-bold text-primary-foreground active:scale-95 transition-transform">Return + Reward</button>
            <button onClick={() => navigate('/account/orders')} className="rounded-xl bg-card border border-border px-3 py-2.5 text-xs font-bold active:scale-95 transition-transform">View Orders</button>
          </div>
        </section>
      )}

      <p className="mx-4 mt-6 text-center text-[11px] text-muted-foreground">
        Need help? <a href="mailto:support@nuvirajuice.com" className="font-semibold text-primary">Contact NuVira Support</a>
      </p>
    </div>
  );
}
