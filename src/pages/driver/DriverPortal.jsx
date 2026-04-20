import React, { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { motion, AnimatePresence } from 'framer-motion';
import { format } from 'date-fns';
import {
  Leaf, MapPin, Navigation, CheckCircle2, ChevronDown, ChevronRight,
  RefreshCw, Clock, Route, XCircle, Recycle, Package, Camera, X
} from 'lucide-react';
import { toast } from 'sonner';

// ─── Shared ────────────────────────────────────────────────────────────────

const DELIVERY_STAGES = [
  { key: 'bottled_packed', label: 'Packed' },
  { key: 'out_for_delivery', label: 'Out for Delivery' },
  { key: 'arriving_soon', label: 'Arriving Soon' },
  { key: 'delivered', label: 'Delivered' },
];

const RETURN_STATUS_COLOR = {
  requested: 'bg-amber-50 text-amber-700',
  verified: 'bg-primary/10 text-primary',
  partially_verified: 'bg-amber-50 text-amber-700',
  not_found: 'bg-secondary text-muted-foreground',
  not_eligible: 'bg-red-50 text-red-600',
};

const REJECTION_REASONS = [
  { key: 'dirty_stained', label: 'Dirty / Stained' },
  { key: 'odor', label: 'Odor' },
  { key: 'damaged', label: 'Damaged' },
  { key: 'other', label: 'Other' },
];

function mapsUrl(address) {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}&travelmode=driving`;
}

function formatDuration(seconds) {
  if (!seconds) return null;
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

function bagSummary(r) {
  const parts = [];
  if ((r.small_bags_requested || 0) > 0) parts.push(`${r.small_bags_requested} Small`);
  if ((r.tote_bags_requested || 0) > 0) parts.push(`${r.tote_bags_requested} Tote`);
  return parts.join(' + ') || '—';
}

// ─── Route Tab ─────────────────────────────────────────────────────────────

function StopCard({ order, bagReturns, onMarkStatus, isUpdating, onSwitchToReturns }) {
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
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center gap-3 p-4 text-left active:bg-secondary/30 transition-colors">
        <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 font-heading font-bold text-sm ${isDelivered ? 'bg-green-100 text-green-600' : 'bg-primary/10 text-primary'}`}>
          {isDelivered ? <CheckCircle2 className="w-4 h-4" /> : <MapPin className="w-4 h-4" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-sm font-semibold">#{order.order_number}</p>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${isDelivered ? 'bg-green-100 text-green-700' : 'bg-primary/10 text-primary'}`}>
              {isDelivered ? 'Delivered ✓' : DELIVERY_STAGES.find(s => s.key === order.status)?.label || order.status}
            </span>
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
          {order.leg_duration_seconds && <span className="text-[10px] text-muted-foreground">{formatDuration(order.leg_duration_seconds)}</span>}
          {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="border-t border-border/40 px-4 pb-4 pt-3 space-y-3">
              <div className="space-y-0.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Customer</p>
                <p className="text-xs">{order.customer_email}</p>
                {order.contact_phone && <p className="text-xs font-semibold">{order.contact_phone}</p>}
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Items</p>
                {order.items?.map((item, i) => (
                  <p key={i} className="text-xs">{item.title} × {item.quantity}</p>
                ))}
              </div>

              {pendingReturn && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Recycle className="w-4 h-4 text-amber-600" />
                    <p className="text-xs font-semibold text-amber-700">Bag Return — {bagSummary(pendingReturn)}</p>
                  </div>
                  <button onClick={onSwitchToReturns} className="mt-1 w-full py-2 bg-amber-500 text-white rounded-lg text-xs font-semibold">
                    Verify Return Now →
                  </button>
                </div>
              )}

              <a href={mapsUrl(order.delivery_address)} target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full py-3 bg-blue-500 text-white rounded-xl text-sm font-semibold active:scale-95 transition-transform">
                <Navigation className="w-4 h-4" />
                Navigate to Stop
              </a>

              {!isDelivered && nextStage && (
                <button onClick={() => onMarkStatus(order, nextStage.key)} disabled={isUpdating}
                  className="w-full py-3 bg-primary text-primary-foreground rounded-xl text-sm font-semibold disabled:opacity-50 active:scale-95 transition-transform">
                  {isUpdating ? 'Updating...' : nextStage.key === 'delivered' ? '✓ Mark Delivered' : `→ ${nextStage.label}`}
                </button>
              )}
              {isDelivered && (
                <div className="py-3 bg-green-50 text-green-700 rounded-xl text-sm font-semibold text-center border border-green-200">✓ Delivered</div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function RouteTab({ bagReturns, onSwitchToReturns }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [routeData, setRouteData] = useState(null);
  const [loadingRoute, setLoadingRoute] = useState(false);
  const [updatingId, setUpdatingId] = useState(null);
  const queryClient = useQueryClient();

  const fetchRoute = async () => {
    setLoadingRoute(true);
    try {
      const res = await base44.functions.invoke('optimizeDeliveryRoute', { date });
      setRouteData(res.data);
    } catch (err) {
      toast.error('Failed to load route');
    } finally {
      setLoadingRoute(false);
    }
  };

  useEffect(() => { fetchRoute(); }, [date]);

  const updateStatusMutation = useMutation({
    mutationFn: ({ order, status }) => {
      const newHistory = [
        ...(order.status_history || []),
        { status, timestamp: new Date().toISOString(), message: DELIVERY_STAGES.find(s => s.key === status)?.label || status },
      ];
      return base44.entities.Order.update(order.id, { status, status_history: newHistory });
    },
    onSuccess: () => { toast.success('Status updated'); setUpdatingId(null); fetchRoute(); },
    onError: () => { toast.error('Update failed'); setUpdatingId(null); },
  });

  const orders = routeData?.optimized_orders || [];
  const delivered = orders.filter(o => o.status === 'delivered').length;
  const bagReturnCount = bagReturns.filter(r => orders.some(o => o.customer_email === r.customer_email)).length;

  return (
    <div className="pb-10">
      {/* Date + refresh */}
      <div className="px-4 pt-4 flex gap-2">
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          className="flex-1 bg-card border border-border text-sm px-3 py-2 rounded-xl focus:outline-none focus:ring-1 focus:ring-primary" />
        <button onClick={fetchRoute} disabled={loadingRoute}
          className="w-10 h-10 bg-secondary rounded-xl flex items-center justify-center shrink-0">
          <RefreshCw className={`w-4 h-4 text-muted-foreground ${loadingRoute ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 divide-x divide-border border-y border-border bg-card mt-4">
        {[
          { label: 'Stops', value: orders.length, color: 'text-foreground' },
          { label: 'Done', value: delivered, color: 'text-green-600' },
          { label: 'Left', value: orders.length - delivered, color: 'text-primary' },
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
        <div className="mx-4 mt-4 bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 flex items-center gap-2">
          <Clock className="w-4 h-4 text-blue-600 shrink-0" />
          <p className="text-xs text-blue-700 font-medium">~{routeData.total_duration_minutes} min · {routeData.total_distance_miles} mi total</p>
        </div>
      )}

      {/* Returns shortcut */}
      {bagReturnCount > 0 && (
        <button onClick={onSwitchToReturns} className="mx-4 mt-3 w-[calc(100%-2rem)] bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Recycle className="w-4 h-4 text-amber-600" />
            <p className="text-xs font-semibold text-amber-700">{bagReturnCount} bag return{bagReturnCount > 1 ? 's' : ''} to verify</p>
          </div>
          <ChevronRight className="w-4 h-4 text-amber-600" />
        </button>
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
            <p className="text-xs text-muted-foreground mt-1">Try a different date above.</p>
          </div>
        ) : (
          <>
            <p className="text-xs text-muted-foreground font-medium px-1">{orders.length} stop{orders.length > 1 ? 's' : ''} · optimized order</p>
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
                    onMarkStatus={(order, status) => { setUpdatingId(order.id); updateStatusMutation.mutate({ order, status }); }}
                    isUpdating={updatingId === order.id}
                    onSwitchToReturns={onSwitchToReturns}
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

// ─── Returns Tab ────────────────────────────────────────────────────────────

function ReturnCard({ ret, allCredits, onVerify }) {
  const { user } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const [smallStatus, setSmallStatus] = useState('accepted');
  const [toteStatus, setToteStatus] = useState('accepted');
  const [reason, setReason] = useState('dirty_stained');
  const [notes, setNotes] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);

  const isPending = ret.verification_status === 'requested';
  const bagStatus = [['accepted', '✓ Accepted'], ['not_eligible', '✗ Not Eligible'], ['not_found', '? Not Found']];

  const calcCredit = () => {
    let c = 0;
    if (ret.small_bags_requested > 0 && smallStatus === 'accepted') c += ret.small_bags_requested;
    if (ret.tote_bags_requested > 0 && toteStatus === 'accepted') c += ret.tote_bags_requested * 2;
    return c;
  };

  const handlePhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setPhotoUrl(file_url);
    } catch { toast.error('Photo upload failed'); }
    setUploading(false);
  };

  const handleSubmit = async () => {
    setSaving(true);
    const credit = calcCredit();
    const smallAcc = smallStatus === 'accepted' ? ret.small_bags_requested : 0;
    const toteAcc = toteStatus === 'accepted' ? ret.tote_bags_requested : 0;
    let vStatus = 'verified';
    if (credit === 0) vStatus = (smallStatus === 'not_found' || toteStatus === 'not_found') ? 'not_found' : 'not_eligible';
    else if (smallAcc < ret.small_bags_requested || toteAcc < ret.tote_bags_requested) vStatus = 'partially_verified';

    await onVerify(ret, {
      small_bag_status: smallStatus, tote_bag_status: toteStatus,
      small_bags_accepted: smallAcc, tote_bags_accepted: toteAcc,
      rejection_reason: (smallStatus === 'not_eligible' || toteStatus === 'not_eligible') ? reason : '',
      driver_notes: notes, photo_url: photoUrl || '',
      verification_status: vStatus, credit_issued: credit,
      verified_by: user?.email, verified_at: new Date().toISOString(), credit_applied: credit > 0,
    }, allCredits);

    setSaving(false);
    setExpanded(false);
  };

  return (
    <div className="bg-card border border-border/50 rounded-2xl overflow-hidden">
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center gap-3.5 p-4 text-left active:bg-secondary/40 transition-colors">
        <div className="w-10 h-10 bg-primary/8 rounded-full flex items-center justify-center shrink-0">
          <Package className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{ret.customer_email}</p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-[10px] text-muted-foreground">{bagSummary(ret)}</span>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${RETURN_STATUS_COLOR[ret.verification_status] || ''}`}>
              {ret.verification_status?.replace(/_/g, ' ')}
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {ret.created_date ? format(new Date(ret.created_date), 'MMM d · h:mm a') : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {ret.credit_issued > 0 && <span className="text-xs font-semibold text-primary">+${ret.credit_issued.toFixed(2)}</span>}
          {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="p-4 border-t border-border/40 space-y-4">
              {!isPending ? (
                <div className="space-y-2 text-sm text-muted-foreground">
                  <p><span className="text-foreground font-medium">Small bags:</span> {ret.small_bags_accepted || 0} of {ret.small_bags_requested || 0} accepted</p>
                  <p><span className="text-foreground font-medium">Tote bags:</span> {ret.tote_bags_accepted || 0} of {ret.tote_bags_requested || 0} accepted</p>
                  {ret.rejection_reason && <p><span className="text-foreground font-medium">Reason:</span> {ret.rejection_reason}</p>}
                  {ret.driver_notes && <p><span className="text-foreground font-medium">Notes:</span> {ret.driver_notes}</p>}
                  {ret.photo_url && <img src={ret.photo_url} alt="Evidence" className="w-full max-w-xs rounded-xl border border-border mt-2" />}
                  {ret.verified_by && <p className="text-[10px]">Verified by {ret.verified_by}</p>}
                </div>
              ) : (
                <>
                  {ret.small_bags_requested > 0 && (
                    <div>
                      <p className="text-xs font-semibold mb-2">Small Bag ×{ret.small_bags_requested}</p>
                      <div className="flex gap-2 flex-wrap">
                        {bagStatus.map(([v, l]) => (
                          <button key={v} onClick={() => setSmallStatus(v)}
                            className={`text-[11px] font-medium px-3 py-2 rounded-xl border transition-colors ${smallStatus === v ? 'bg-primary text-primary-foreground border-primary' : 'border-border bg-background'}`}>
                            {l}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {ret.tote_bags_requested > 0 && (
                    <div>
                      <p className="text-xs font-semibold mb-2">Tote Bag ×{ret.tote_bags_requested}</p>
                      <div className="flex gap-2 flex-wrap">
                        {bagStatus.map(([v, l]) => (
                          <button key={v} onClick={() => setToteStatus(v)}
                            className={`text-[11px] font-medium px-3 py-2 rounded-xl border transition-colors ${toteStatus === v ? 'bg-primary text-primary-foreground border-primary' : 'border-border bg-background'}`}>
                            {l}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {(smallStatus === 'not_eligible' || toteStatus === 'not_eligible') && (
                    <div>
                      <p className="text-xs font-semibold mb-2">Reason</p>
                      <div className="flex gap-2 flex-wrap">
                        {REJECTION_REASONS.map(r => (
                          <button key={r.key} onClick={() => setReason(r.key)}
                            className={`text-[11px] px-3 py-1.5 rounded-xl border transition-colors ${reason === r.key ? 'bg-destructive/10 border-destructive/30 text-destructive' : 'border-border bg-background'}`}>
                            {r.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div>
                    <p className="text-xs font-semibold mb-2">Photo <span className="text-muted-foreground font-normal">(recommended)</span></p>
                    <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhoto} />
                    {photoUrl ? (
                      <div className="relative inline-block">
                        <img src={photoUrl} alt="Evidence" className="w-full max-w-xs rounded-xl border border-border" />
                        <button onClick={() => setPhotoUrl('')} className="absolute top-2 right-2 w-7 h-7 bg-black/50 rounded-full flex items-center justify-center">
                          <X className="w-3.5 h-3.5 text-white" />
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => fileRef.current?.click()} disabled={uploading}
                        className="flex items-center gap-2 px-4 py-3 border-2 border-dashed border-border rounded-xl text-sm text-muted-foreground w-full justify-center">
                        {uploading ? <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" /> : <Camera className="w-4 h-4" />}
                        {uploading ? 'Uploading...' : 'Take or Upload Photo'}
                      </button>
                    )}
                  </div>

                  <div>
                    <p className="text-xs font-semibold mb-1.5">Notes <span className="text-muted-foreground font-normal">(optional)</span></p>
                    <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Any notes..."
                      className="w-full text-xs border border-border rounded-xl px-3 py-2.5 bg-background resize-none focus:outline-none focus:ring-1 focus:ring-primary" />
                  </div>

                  <div className="bg-primary/5 border border-primary/15 rounded-xl p-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Leaf className="w-4 h-4 text-primary" />
                      <p className="text-sm font-semibold">Credit to Issue</p>
                    </div>
                    <p className="font-heading text-xl font-bold text-primary">${calcCredit().toFixed(2)}</p>
                  </div>

                  <button onClick={handleSubmit} disabled={saving || uploading}
                    className="w-full py-3.5 bg-primary text-primary-foreground rounded-xl text-sm font-semibold disabled:opacity-50 active:scale-[0.98] transition-transform">
                    {saving ? 'Submitting...' : 'Confirm & Submit'}
                  </button>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ReturnsTab({ returns, allCredits, isLoading, onVerify }) {
  const [filter, setFilter] = useState('pending');
  const pending = returns.filter(r => r.verification_status === 'requested');
  const completed = returns.filter(r => r.verification_status !== 'requested');
  const todayDone = completed.filter(r => r.verified_at?.startsWith(new Date().toISOString().slice(0, 10))).length;
  const displayed = filter === 'pending' ? pending : completed;

  return (
    <div className="pb-10">
      {/* Stats */}
      <div className="grid grid-cols-3 divide-x divide-border border-b border-border bg-card">
        {[
          { label: 'Pending', value: pending.length, color: 'text-amber-600' },
          { label: 'Done Today', value: todayDone, color: 'text-primary' },
          { label: 'All Done', value: completed.length, color: 'text-foreground' },
        ].map(s => (
          <div key={s.label} className="py-4 text-center">
            <p className={`text-xl font-bold font-heading ${s.color}`}>{s.value}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filter */}
      <div className="flex gap-2 px-4 mt-4 mb-3">
        {[
          { key: 'pending', label: `Pending (${pending.length})` },
          { key: 'done', label: `Done (${completed.length})` },
        ].map(tab => (
          <button key={tab.key} onClick={() => setFilter(tab.key)}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition-colors ${filter === tab.key ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'}`}>
            {tab.label}
          </button>
        ))}
      </div>

      <div className="px-4 space-y-2">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : displayed.length === 0 ? (
          <div className="text-center py-20">
            <CheckCircle2 className="w-10 h-10 text-primary mx-auto mb-3" />
            <p className="text-sm font-semibold">{filter === 'pending' ? 'All caught up.' : 'No completed returns yet.'}</p>
            <p className="text-xs text-muted-foreground mt-1">{filter === 'pending' ? 'No pending bag returns.' : 'Verified returns will appear here.'}</p>
          </div>
        ) : (
          displayed.map(ret => (
            <ReturnCard key={ret.id} ret={ret} allCredits={allCredits} onVerify={onVerify} />
          ))
        )}
      </div>
    </div>
  );
}

// ─── Main Portal ────────────────────────────────────────────────────────────

export default function DriverPortal() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('route');

  const isAuthorized = user?.role === 'driver' || user?.role === 'admin';

  const { data: bagReturns = [], isLoading: returnsLoading } = useQuery({
    queryKey: ['driver-bag-returns'],
    queryFn: () => base44.entities.BagReturn.list('-created_date', 200),
    enabled: isAuthorized,
    refetchInterval: 30000,
  });

  const { data: allCredits = [] } = useQuery({
    queryKey: ['driver-all-credits'],
    queryFn: () => base44.entities.NuViraCredit.list('-created_date', 500),
    enabled: isAuthorized,
  });

  const pendingReturns = bagReturns.filter(r => r.verification_status === 'requested');

  const verifyMutation = useMutation({
    mutationFn: async ({ ret, data }) => {
      await base44.entities.BagReturn.update(ret.id, data);
      if (data.credit_issued > 0) {
        const existing = allCredits.find(c => c.customer_email === ret.customer_email);
        const entry = {
          amount: data.credit_issued, type: 'earned',
          description: `Return + Reward${data.verification_status === 'partially_verified' ? ' (Partial)' : ''}`,
          bag_return_id: ret.id, order_id: ret.order_id, timestamp: new Date().toISOString(),
        };
        if (existing) {
          await base44.entities.NuViraCredit.update(existing.id, {
            balance: (existing.balance || 0) + data.credit_issued,
            lifetime_earned: (existing.lifetime_earned || 0) + data.credit_issued,
            history: [...(existing.history || []), entry],
          });
        } else {
          await base44.entities.NuViraCredit.create({
            customer_email: ret.customer_email, balance: data.credit_issued,
            lifetime_earned: data.credit_issued, lifetime_used: 0, history: [entry],
          });
        }
        await base44.integrations.Core.SendEmail({
          to: ret.customer_email,
          subject: 'Return Verified — NuVira Credits Added',
          body: `Your NuVira return has been verified and $${data.credit_issued.toFixed(2)} in NuVira Credits has been added to your account.\n\nSustainability, The NuVira Way.`,
        });
      } else if (data.verification_status === 'not_eligible') {
        await base44.integrations.Core.SendEmail({
          to: ret.customer_email,
          subject: 'Return Not Eligible',
          body: `Your bag was not eligible for reuse this time. Bags must be clean, odor-free, and free of damage to qualify.\n\nThank you for participating.`,
        });
      } else if (data.verification_status === 'not_found') {
        await base44.integrations.Core.SendEmail({
          to: ret.customer_email,
          subject: 'Return Not Located',
          body: `We were unable to locate a bag at your delivery address. If you believe this is an error, please contact us through the Support section.`,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['driver-bag-returns'] });
      queryClient.invalidateQueries({ queryKey: ['driver-all-credits'] });
      toast.success('Verification submitted');
    },
    onError: () => toast.error('Submission failed'),
  });

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
        <XCircle className="w-10 h-10 text-destructive mb-4" />
        <h1 className="font-heading text-xl font-bold mb-2">Access Restricted</h1>
        <p className="text-sm text-muted-foreground">This area is for NuVira drivers only.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-primary px-4 pb-4" style={{ paddingTop: 'max(2.5rem, env(safe-area-inset-top))' }}>
        <div className="flex items-center gap-2 mb-0.5">
          <Leaf className="w-5 h-5 text-primary-foreground/70" />
          <h1 className="font-heading text-2xl font-bold text-primary-foreground">Driver Portal</h1>
        </div>
        <p className="text-primary-foreground/50 text-[11px]">{user.email}</p>

        {/* Tabs */}
        <div className="flex gap-2 mt-4">
          <button onClick={() => setTab('route')}
            className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-colors ${tab === 'route' ? 'bg-white text-primary' : 'bg-white/20 text-white'}`}>
            <Route className="w-3.5 h-3.5 inline mr-1.5" />
            Route
          </button>
          <button onClick={() => setTab('returns')}
            className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-colors relative ${tab === 'returns' ? 'bg-white text-primary' : 'bg-white/20 text-white'}`}>
            <Recycle className="w-3.5 h-3.5 inline mr-1.5" />
            Bag Returns
            {pendingReturns.length > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-amber-400 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                {pendingReturns.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Tab content */}
      {tab === 'route' ? (
        <RouteTab bagReturns={pendingReturns} onSwitchToReturns={() => setTab('returns')} />
      ) : (
        <ReturnsTab
          returns={bagReturns}
          allCredits={allCredits}
          isLoading={returnsLoading}
          onVerify={(ret, data) => verifyMutation.mutateAsync({ ret, data })}
        />
      )}
    </div>
  );
}