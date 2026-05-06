import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { format } from 'date-fns';
import {
  Leaf, RefreshCw, ChevronDown, ChevronRight,
  MapPin, CheckCircle2, Truck, AlertTriangle,
  MessageSquare, X, Navigation, ArrowLeft,
  Clock, Package
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';

// ─── Helpers ────────────────────────────────────────────────────────────────

function todayStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function mapsUrl(address) {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}&travelmode=driving`;
}

const STATUS_CONFIG = {
  scheduled:        { label: 'Scheduled',       color: 'bg-blue-100 text-blue-700' },
  ready:            { label: 'Ready',            color: 'bg-amber-100 text-amber-700' },
  out_for_delivery: { label: 'Out for Delivery', color: 'bg-cyan-100 text-cyan-700' },
  delivered:        { label: 'Delivered',        color: 'bg-green-100 text-green-700' },
  unable_to_deliver:{ label: 'Unable',           color: 'bg-red-100 text-red-700' },
};

function statusConfig(status) {
  return STATUS_CONFIG[status] || { label: status || 'Unknown', color: 'bg-secondary text-muted-foreground' };
}

// ─── Task Card ───────────────────────────────────────────────────────────────

// A task_id is valid only if it's a non-empty 24-char hex string (MongoDB ObjectId format)
// and does NOT look like a synthetic composite (no underscore suffix like _f2)
function isValidHubTaskId(id) {
  if (!id || typeof id !== 'string') return false;
  return /^[a-f0-9]{24}$/.test(id.trim());
}

function TaskCard({ task, onAction, isActing }) {
  const [expanded, setExpanded] = useState(false);
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [showUnableForm, setShowUnableForm] = useState(false);
  const [note, setNote] = useState('');
  const [failureReason, setFailureReason] = useState('customer_not_home');

  // Real Hub FulfillmentTask.id — ONLY field sent to hubDriverAction
  const hubTaskId = task.task_id;
  const hasValidTaskId = isValidHubTaskId(hubTaskId);

  const isDelivered = task.status === 'delivered';
  const isUnable = task.status === 'unable_to_deliver';
  const isDone = isDelivered || isUnable;
  const cfg = statusConfig(task.status);

  const FAILURE_REASONS = [
    { key: 'customer_not_home', label: 'Not Home' },
    { key: 'wrong_address', label: 'Wrong Address' },
    { key: 'access_issue', label: 'Access Issue' },
    { key: 'refused_delivery', label: 'Refused' },
    { key: 'other', label: 'Other' },
  ];

  const handleAction = (action, extra = {}) => {
    if (!hasValidTaskId) return; // safety guard — never call with invalid ID
    onAction(hubTaskId, action, extra);
    setShowNoteForm(false);
    setShowUnableForm(false);
    setNote('');
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`bg-card border rounded-2xl overflow-hidden ${
        isDelivered ? 'border-green-200 opacity-80'
        : isUnable ? 'border-red-200 opacity-80'
        : 'border-border/50'
      }`}
    >
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-3.5 py-3 text-left active:bg-secondary/30"
      >
        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isDelivered ? 'bg-green-100 text-green-600' : 'bg-primary/10 text-primary'}`}>
          {isDelivered ? <CheckCircle2 className="w-4 h-4" /> : <MapPin className="w-4 h-4" />}
        </div>
        <div className="flex-1 min-w-0">
          {task.customer_name && (
            <p className="text-sm font-bold truncate">{task.customer_name}</p>
          )}
          <p className="text-xs text-muted-foreground truncate">{task.delivery_address || <span className="italic">No address</span>}</p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${cfg.color}`}>
              {cfg.label}
            </span>
            {task.delivery_window_label && (
              <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                <Clock className="w-3 h-3" />{task.delivery_window_label}
              </span>
            )}
          </div>
        </div>
        {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="border-t border-border/40 px-3.5 pb-4 pt-3 space-y-3">

              {/* Delivery info */}
              <div className="bg-secondary/40 rounded-xl p-3 space-y-1">
                {task.scheduled_date && (
                  <p className="text-xs text-primary font-medium">
                    📅 {task.scheduled_date}{task.delivery_window_label ? ` · ${task.delivery_window_label}` : ''}
                  </p>
                )}
                {task.delivery_address && (
                  <p className="text-xs text-muted-foreground">{task.delivery_address}</p>
                )}
                {task.notes && (
                  <p className="text-xs text-foreground/70 italic pt-1">{task.notes}</p>
                )}
              </div>

              {/* Items */}
              {task.items?.length > 0 && (
                <div className="bg-secondary/40 rounded-xl p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                    <Package className="w-3 h-3 inline mr-1" />Items
                  </p>
                  {task.items.map((item, i) => (
                    <p key={i} className="text-xs">{item.title} × {item.quantity ?? 1}</p>
                  ))}
                </div>
              )}

              {/* Navigate */}
              {task.delivery_address && (
                <a
                  href={mapsUrl(task.delivery_address)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full py-3 bg-blue-500 text-white rounded-xl text-sm font-semibold active:scale-95 transition-transform"
                >
                  <Navigation className="w-4 h-4" />
                  Navigate
                </a>
              )}

              {/* Action buttons */}
              {!isDone && !showNoteForm && !showUnableForm && (
                <div className="space-y-2">
                  {!hasValidTaskId ? (
                    <div className="w-full py-3 px-4 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700 text-center">
                      ⚠️ Missing Hub fulfillment task ID — cannot update delivery.
                    </div>
                  ) : (
                    <>
                      {task.status !== 'out_for_delivery' && (
                        <button
                          onClick={() => handleAction('mark_out_for_delivery')}
                          disabled={isActing}
                          className="w-full py-3 border border-primary text-primary rounded-xl text-sm font-semibold disabled:opacity-50 active:scale-95 transition-transform flex items-center justify-center gap-2"
                        >
                          <Truck className="w-4 h-4" /> Start Delivery
                        </button>
                      )}
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => handleAction('mark_delivered')}
                          disabled={isActing}
                          className="py-3 bg-primary text-primary-foreground rounded-xl text-sm font-semibold disabled:opacity-50 active:scale-95 transition-transform flex items-center justify-center gap-1.5"
                        >
                          <CheckCircle2 className="w-4 h-4" /> Delivered
                        </button>
                        <button
                          onClick={() => setShowUnableForm(true)}
                          disabled={isActing}
                          className="py-3 bg-red-50 text-red-600 border border-red-200 rounded-xl text-sm font-semibold disabled:opacity-50 active:scale-95 transition-transform flex items-center justify-center gap-1.5"
                        >
                          <AlertTriangle className="w-4 h-4" /> Unable
                        </button>
                      </div>
                      <button
                        onClick={() => setShowNoteForm(true)}
                        className="w-full py-2 text-xs text-muted-foreground border border-border rounded-xl flex items-center justify-center gap-1.5"
                      >
                        <MessageSquare className="w-3.5 h-3.5" /> Add Note
                      </button>
                    </>
                  )}
                </div>
              )}

              {/* Unable form */}
              {showUnableForm && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-bold text-red-700">Unable to Deliver</p>
                    <button onClick={() => setShowUnableForm(false)}><X className="w-4 h-4 text-red-400" /></button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {FAILURE_REASONS.map(r => (
                      <button key={r.key} onClick={() => setFailureReason(r.key)}
                        className={`text-[11px] px-3 py-1.5 rounded-xl border transition-colors ${failureReason === r.key ? 'bg-red-600 text-white border-red-600' : 'border-red-200 bg-white text-red-700'}`}>
                        {r.label}
                      </button>
                    ))}
                  </div>
                  <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
                    placeholder="Optional notes..."
                    className="w-full text-xs border border-red-200 rounded-xl px-3 py-2.5 bg-white resize-none focus:outline-none focus:ring-1 focus:ring-red-300 placeholder:text-red-300" />
                  <button
                    onClick={() => handleAction('mark_unable_to_deliver', { failure_reason: failureReason, note: note || undefined })}
                    disabled={isActing || !hasValidTaskId}
                    className="w-full py-3 bg-red-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50 active:scale-95 transition-transform"
                  >
                    {isActing ? 'Submitting...' : 'Confirm Unable to Deliver'}
                  </button>
                </div>
              )}

              {/* Note form */}
              {showNoteForm && (
                <div className="bg-secondary border border-border rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-bold">Add Note</p>
                    <button onClick={() => setShowNoteForm(false)}><X className="w-4 h-4 text-muted-foreground" /></button>
                  </div>
                  <textarea value={note} onChange={e => setNote(e.target.value)} rows={3}
                    placeholder="Driver note..."
                    className="w-full text-xs border border-border rounded-xl px-3 py-2.5 bg-card resize-none focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/50" />
                  <button
                    onClick={() => handleAction('add_note', { note })}
                    disabled={isActing || !note.trim() || !hasValidTaskId}
                    className="w-full py-3 bg-primary text-primary-foreground rounded-xl text-sm font-semibold disabled:opacity-50 active:scale-95 transition-transform"
                  >
                    {isActing ? 'Saving...' : 'Save Note'}
                  </button>
                </div>
              )}

              {/* Done state */}
              {isDone && (
                <div className={`py-3 rounded-xl text-sm font-semibold text-center border flex items-center justify-center gap-2 ${
                  isDelivered ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-600 border-red-200'
                }`}>
                  {isDelivered ? <><CheckCircle2 className="w-4 h-4" /> Delivered</> : <><AlertTriangle className="w-4 h-4" /> Unable to Deliver</>}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Main Portal ─────────────────────────────────────────────────────────────

export default function DriverPortal() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [date, setDate] = useState(todayStr());
  const [routeData, setRouteData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [optimizedOrder, setOptimizedOrder] = useState(null);
  const [actingTaskId, setActingTaskId] = useState(null);

  const isAuthorized = user?.role === 'driver' || user?.role === 'admin' || user?.role === 'operations';

  const loadRoute = useCallback(async (selectedDate) => {
    setLoading(true);
    setOptimizedOrder(null);
    try {
      const res = await base44.functions.invoke('getHubDriverRoute', { date: selectedDate });
      setRouteData(res.data);
    } catch (err) {
      console.error('[DriverPortal] loadRoute error:', err);
      toast.error('Failed to load route from Hub');
      setRouteData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleOptimizeRoute = async () => {
    const activeStops = [...(routeData?.ready_tasks || []), ...(routeData?.scheduled_tasks || [])];
    if (activeStops.length === 0) {
      toast.error('No active deliveries to optimize');
      return;
    }
    if (activeStops.length === 1) {
      toast.info('Only one delivery — no optimization needed');
      setOptimizedOrder(activeStops);
      return;
    }

    setOptimizing(true);
    console.group('[DriverPortal] Optimize Route Click');
    console.log('Selected date:', date);
    console.log('Total active stops:', activeStops.length);
    
    // Build payload matching contract: include task_id, addresses, customer names, etc.
    const stopsPayload = activeStops.map(t => ({
      task_id: t.task_id,
      customer_name: t.customer_name || 'Unknown',
      delivery_address: t.delivery_address,
      scheduled_date: date,
      delivery_window: t.delivery_window_label || '5 PM - 8 PM',
      phone: t.contact_phone || '',
      items_summary: t.items?.length ? `${t.items.length} items` : '',
      order_number: t.order_number || '',
      status: t.status,
    }));

    console.log('Payload stops count:', stopsPayload.length);
    stopsPayload.forEach((s, i) => {
      console.log(`  Stop ${i + 1}: task_id=${s.task_id}, addr=${s.delivery_address}, customer=${s.customer_name}`);
    });

    const payload = { date, optimize: true };
    console.log('Full payload:', JSON.stringify(payload, null, 2));

    try {
      const res = await base44.functions.invoke('optimizeDeliveryRoute', payload);
      console.log('Response status:', res.status);
      console.log('Response data:', JSON.stringify(res.data, null, 2));
      
      const optimized = res.data?.optimized_orders || [];
      console.log('Optimized stops returned:', optimized.length);
      optimized.forEach((s, i) => {
        console.log(`  Optimized ${i + 1}: task_id=${s.task_id}, addr=${s.delivery_address}`);
      });

      // Verify task_ids are preserved
      const originalTaskIds = new Set(activeStops.map(t => t.task_id));
      const optimizedTaskIds = new Set(optimized.map(t => t.task_id).filter(Boolean));
      const lostIds = [...originalTaskIds].filter(id => !optimizedTaskIds.has(id));
      if (lostIds.length > 0) {
        console.warn('⚠️ LOST TASK IDS:', lostIds);
      } else {
        console.log('✓ All task IDs preserved');
      }

      // Log Google Maps URL
      const mapsUrl = optimized.filter(t => t.delivery_address && !t.is_return_stop)
        .map(t => encodeURIComponent(t.delivery_address)).join('|');
      console.log('Google Maps URL generated:', !!mapsUrl, mapsUrl ? `(${mapsUrl.length} chars)` : '');

      setOptimizedOrder(optimized);
      toast.success(`Route optimized · ${optimized.length} stops`);
      console.log('✓ optimizedOrder state updated');
    } catch (err) {
      console.error('[DriverPortal] optimize error:', err);
      console.error('Error details:', { message: err.message, stack: err.stack });
      toast.error('Optimization failed — showing manual route');
      setOptimizedOrder(activeStops);
    } finally {
      console.groupEnd();
      setOptimizing(false);
    }
  };

  useEffect(() => {
    if (isAuthorized) loadRoute(date);
  }, [date, isAuthorized, loadRoute]);

  const handleAction = async (taskId, action, extra = {}) => {
    setActingTaskId(taskId);
    try {
      await base44.functions.invoke('hubDriverAction', {
        task_id: taskId,  // always the real Hub FulfillmentTask.id (task.task_id)
        action,
        ...extra,
      });
      toast.success(
        action === 'mark_delivered' ? 'Marked as delivered ✓'
        : action === 'mark_out_for_delivery' ? 'Delivery started'
        : action === 'mark_unable_to_deliver' ? 'Reported unable to deliver'
        : 'Note saved'
      );
      // Refresh from Hub after action
      await loadRoute(date);
    } catch (err) {
      console.error('[DriverPortal] action error:', err);
      toast.error('Action failed — please try again');
    } finally {
      setActingTaskId(null);
    }
  };

  // ── Auth gates ─────────────────────────────────────────────────────────────

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background px-6 text-center">
        <Leaf className="w-10 h-10 text-primary mb-4" />
        <h1 className="font-heading text-xl font-bold mb-2">Sign In Required</h1>
        <p className="text-sm text-muted-foreground mb-6">Please sign in with your driver account.</p>
        <button onClick={() => base44.auth.redirectToLogin('/driver')}
          className="px-6 py-3 bg-primary text-primary-foreground rounded-xl text-sm font-semibold">
          Sign In
        </button>
      </div>
    );
  }

  if (!isAuthorized) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background px-6 text-center">
        <h1 className="font-heading text-xl font-bold mb-2">Access Restricted</h1>
        <p className="text-sm text-muted-foreground">This area is for NuVira drivers only.</p>
      </div>
    );
  }

  // ── Route data ─────────────────────────────────────────────────────────────

  // Hub returns bucketed arrays: ready_tasks, scheduled_tasks, completed_tasks
  const ready = routeData?.ready_tasks || [];
  const scheduled = routeData?.scheduled_tasks || [];
  const done = routeData?.completed_tasks || [];
  const inProgress = [...ready, ...scheduled].filter(t => t.status === 'out_for_delivery');
  const queued = [...ready, ...scheduled].filter(t => t.status !== 'out_for_delivery');
  const tasks = [...ready, ...scheduled, ...done];
  const remaining = routeData?.counts?.left ?? (ready.length + scheduled.length);

  // Generate full-route Google Maps URL from optimized stops
  const getOptimizedMapsUrl = () => {
    if (!optimizedOrder || optimizedOrder.length === 0) return null;
    const stops = optimizedOrder.filter(t => t.delivery_address && !t.is_return_stop);
    if (stops.length === 0) return null;
    const waypoints = stops.map(t => encodeURIComponent(t.delivery_address)).join('|');
    const origin = encodeURIComponent('619 N Main St Unit 3, O\'Fallon, MO 63366');
    return `https://www.google.com/maps/dir/${origin}/${waypoints}/${origin}?travelmode=driving`;
  };

  // Copy optimized addresses to clipboard
  const handleCopyAddresses = () => {
    if (!optimizedOrder || optimizedOrder.length === 0) return;
    const stops = optimizedOrder
      .filter(t => t.delivery_address && !t.is_return_stop)
      .map((t, i) => `${i + 1}. ${t.delivery_address}`);
    const text = stops.join('\n');
    navigator.clipboard.writeText(text);
    toast.success('Addresses copied!');
  };

  return (
    <div className="min-h-screen bg-background overflow-x-hidden">
      {/* Header */}
      <div className="bg-primary px-4 pb-4" style={{ paddingTop: 'max(2.5rem, env(safe-area-inset-top))' }}>
        <div className="flex items-center gap-2 mb-0.5">
          {user?.role === 'admin' && (
            <button onClick={() => navigate('/admin/orders')}
              className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30 transition-colors">
              <ArrowLeft className="w-4 h-4 text-white" />
            </button>
          )}
          <Leaf className="w-5 h-5 text-primary-foreground/70" />
          <h1 className="font-heading text-2xl font-bold text-primary-foreground">Driver Portal</h1>
        </div>
        <p className="text-primary-foreground/50 text-[11px]">{user.email}</p>

        {/* Date selector */}
        <div className="flex gap-2 mt-4">
          <input
            type="date"
            value={date}
            onChange={e => { setDate(e.target.value); }}
            className="flex-1 bg-white/15 border border-white/30 text-white text-sm px-3 py-2.5 rounded-xl focus:outline-none focus:ring-1 focus:ring-white/50 [color-scheme:dark]"
          />
          <button onClick={() => loadRoute(date)} disabled={loading}
            className="w-11 h-11 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
            <RefreshCw className={`w-4 h-4 text-white ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-4 divide-x divide-border border-b border-border bg-card">
        {[
          { label: 'Total', value: routeData?.counts?.total ?? tasks.length, color: 'text-foreground' },
          { label: 'Queued', value: routeData?.counts?.scheduled ?? queued.length, color: 'text-amber-600' },
          { label: 'En Route', value: inProgress.length, color: 'text-cyan-600' },
          { label: 'Done', value: routeData?.counts?.completed ?? done.length, color: 'text-green-600' },
        ].map(s => (
          <div key={s.label} className="py-3 text-center">
            <p className={`text-xl font-bold font-heading ${s.color}`}>{s.value}</p>
            <p className="text-[10px] text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Route optimization & links */}
      {routeData && (
        <div className="px-4 pt-3 pb-2 space-y-2">
          <p className="text-[10px] text-muted-foreground">
            Route data from NuVira Hub · {remaining} stop{remaining !== 1 ? 's' : ''} remaining
          </p>
          {queued.length > 1 && !optimizedOrder && (
            <button
              onClick={handleOptimizeRoute}
              disabled={optimizing}
              className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2 active:scale-95 transition-transform"
            >
              <Navigation className={`w-4 h-4 ${optimizing ? 'animate-spin' : ''}`} />
              {optimizing ? 'Optimizing...' : 'Optimize Route'}
            </button>
          )}
          {optimizedOrder && optimizedOrder.length > 0 && (
            <div className="space-y-1.5">
              {getOptimizedMapsUrl() && (
                <a
                  href={getOptimizedMapsUrl()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full py-2.5 bg-blue-500 text-white rounded-xl text-sm font-semibold active:scale-95 transition-transform"
                >
                  <Navigation className="w-4 h-4" />
                  Open Full Route
                </a>
              )}
              <button
                onClick={handleCopyAddresses}
                className="w-full py-2 text-xs text-muted-foreground border border-border rounded-xl active:scale-95 transition-transform"
              >
                📋 Copy Addresses
              </button>
              <button
                onClick={() => setOptimizedOrder(null)}
                className="w-full py-1.5 text-xs text-muted-foreground underline"
              >
                Clear Optimization
              </button>
            </div>
          )}
        </div>
      )}

      {/* Task list */}
      <div className="px-4 pt-3 pb-10 space-y-3">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-muted-foreground">Loading route from Hub...</p>
          </div>
        ) : tasks.length === 0 ? (
          <div className="text-center py-16">
            <CheckCircle2 className="w-10 h-10 text-primary mx-auto mb-3" />
            <p className="text-sm font-semibold">No deliveries for {date}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {routeData ? 'Hub returned an empty route for this date.' : 'Select a date to load the route.'}
            </p>
          </div>
        ) : (
          <>
            {/* Optimized route display */}
            {optimizedOrder && optimizedOrder.length > 0 && (
              <Section label="Optimized Route" count={optimizedOrder.filter(t => !t.is_return_stop).length}>
                {optimizedOrder.map((t, idx) => (
                  <div key={`${t.task_id || t.id}-${idx}`} className="relative">
                    {!t.is_return_stop && (
                      <div className="absolute -left-4 top-3 w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">
                        {idx + 1}
                      </div>
                    )}
                    <div className="ml-2">
                      <TaskCard task={t} onAction={handleAction} isActing={actingTaskId === (t.task_id || t.id)} />
                    </div>
                  </div>
                ))}
              </Section>
            )}

            {/* Regular sections if no optimization */}
            {!optimizedOrder && (
              <>
                {/* In Progress */}
                {inProgress.length > 0 && (
                  <Section label="En Route" count={inProgress.length}>
                    {inProgress.map(t => (
                      <TaskCard key={t.id} task={t} onAction={handleAction} isActing={actingTaskId === t.id} />
                    ))}
                  </Section>
                )}

                {/* Queued (ready + scheduled, minus in-progress) */}
                {queued.length > 0 && (
                  <Section label="Queued" count={queued.length}>
                    {queued.map(t => (
                      <TaskCard key={t.id} task={t} onAction={handleAction} isActing={actingTaskId === t.id} />
                    ))}
                  </Section>
                )}
              </>
            )}

            {/* Done */}
            {done.length > 0 && (
              <Section label="Completed" count={done.length} muted>
                {done.map(t => (
                  <TaskCard key={t.id} task={t} onAction={handleAction} isActing={actingTaskId === t.id} />
                ))}
              </Section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Section({ label, count, muted = false, children }) {
  return (
    <div>
      <p className={`text-[10px] font-semibold uppercase tracking-wider mb-2 ${muted ? 'text-muted-foreground/60' : 'text-muted-foreground'}`}>
        {label} ({count})
      </p>
      <div className="space-y-2">{children}</div>
    </div>
  );
}