import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { motion, AnimatePresence } from 'framer-motion';
import { format } from 'date-fns';
import {
  Leaf, MapPin, Navigation, CheckCircle2, ChevronDown, ChevronRight,
  RefreshCw, Clock, Route, XCircle, Recycle, Package, Camera, X,
  AlertTriangle, Truck, RotateCcw, ArrowLeft
} from 'lucide-react';
import { toast } from 'sonner';
import PreOptimizeOrderCard from '@/components/driver/PreOptimizeOrderCard';

// ─── Constants ──────────────────────────────────────────────────────────────

const DELIVERY_STAGES = [
  { key: 'bottled_packed', label: 'Packed' },
  { key: 'out_for_delivery', label: 'Out for Delivery' },
  { key: 'arriving_soon', label: 'Arriving Soon' },
  { key: 'delivered', label: 'Delivered' },
];

const UNABLE_TO_DELIVER_REASONS = [
  { key: 'customer_not_home', label: 'Customer Not Home' },
  { key: 'wrong_address', label: 'Wrong Address' },
  { key: 'access_issue', label: 'Access Issue' },
  { key: 'refused_delivery', label: 'Customer Refused' },
  { key: 'other', label: 'Other' },
];

const REJECTION_REASONS = [
  { key: 'dirty_stained', label: 'Dirty / Stained' },
  { key: 'odor', label: 'Odor' },
  { key: 'damaged', label: 'Damaged' },
  { key: 'customer_not_home', label: 'Customer Not Home' },
  { key: 'other', label: 'Other' },
];

const RETURN_STATUS_COLOR = {
  requested: 'bg-amber-50 text-amber-700',
  verified: 'bg-green-50 text-green-700',
  partially_verified: 'bg-amber-50 text-amber-700',
  not_found: 'bg-secondary text-muted-foreground',
  not_eligible: 'bg-red-50 text-red-600',
  unable_to_collect: 'bg-red-50 text-red-600',
};

const STATUS_LABEL = {
  order_received: 'Received', scheduled_for_juicing: 'Awaiting Production',
  in_production: 'In Production', bottled_packed: 'Packed',
  out_for_delivery: 'Out for Delivery', arriving_soon: 'Arriving Soon', delivered: 'Delivered',
};

const STATUS_COLOR = {
  order_received: 'bg-blue-100 text-blue-700', scheduled_for_juicing: 'bg-purple-100 text-purple-700',
  in_production: 'bg-amber-100 text-amber-700', bottled_packed: 'bg-orange-100 text-orange-700',
  out_for_delivery: 'bg-cyan-100 text-cyan-700', arriving_soon: 'bg-teal-100 text-teal-700',
  delivered: 'bg-green-100 text-green-700',
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function mapsUrl(address) {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}&travelmode=driving`;
}

const DEPOT = "619 N Main St Unit 3, O'Fallon, MO 63366";

function buildFullRouteUrl(orders) {
  const remaining = orders.filter(o => o.status !== 'delivered');
  if (remaining.length === 0) return null;
  const origin = encodeURIComponent(DEPOT);
  const destination = encodeURIComponent(remaining[remaining.length - 1].delivery_address);
  const waypoints = remaining.slice(0, -1).map(o => encodeURIComponent(o.delivery_address)).join('|');
  return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}${waypoints ? `&waypoints=${waypoints}` : ''}&travelmode=driving`;
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

// ─── Inline Bag Return Verifier (embedded inside StopCard) ──────────────────

function InlineBagReturn({ ret, user, onVerifyComplete }) {
  const [smallStatus, setSmallStatus] = useState('accepted');
  const [toteStatus, setToteStatus] = useState('accepted');
  const [smallAccepted, setSmallAccepted] = useState(ret.small_bags_requested || 0);
  const [toteAccepted, setToteAccepted] = useState(ret.tote_bags_requested || 0);
  const [reason, setReason] = useState('dirty_stained');
  const [notes, setNotes] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);

  const bagStatusOptions = [
    ['accepted', '✓ Accepted'],
    ['not_eligible', '✗ Not Eligible'],
    ['not_found', '? Not Found'],
  ];

  const calcCredit = () => {
    let c = 0;
    if (smallStatus === 'accepted') c += smallAccepted;
    if (toteStatus === 'accepted') c += toteAccepted * 2;
    return c;
  };

  const handlePhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setPhotoUrl(file_url);
    } catch (err) { 
      console.error('Photo upload error:', err);
      toast.error('Photo upload failed — submission may proceed without photo');
    }
    setUploading(false);
  };

  const handleSubmit = async () => {
    setSaving(true);
    const credit = calcCredit();
    let vStatus = 'verified';
    if (credit === 0) vStatus = (smallStatus === 'not_found' || toteStatus === 'not_found') ? 'not_found' : 'not_eligible';
    else if (smallAccepted < ret.small_bags_requested || toteAccepted < ret.tote_bags_requested) vStatus = 'partially_verified';

    onVerifyComplete(ret, {
      small_bag_status: smallStatus, tote_bag_status: toteStatus,
      small_bags_accepted: smallAccepted, tote_bags_accepted: toteAccepted,
      rejection_reason: (smallStatus === 'not_eligible' || toteStatus === 'not_eligible') ? reason : '',
      driver_notes: notes, photo_url: photoUrl || '',
      verification_status: vStatus, credit_issued: credit,
      verified_by: user?.email, verified_at: new Date().toISOString(), credit_applied: credit > 0,
    });
    setSaving(false);
  };

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Recycle className="w-4 h-4 text-amber-600 shrink-0" />
        <p className="text-sm font-bold text-amber-800">Bag Return — {bagSummary(ret)}</p>
      </div>

      {ret.small_bags_requested > 0 && (
        <div>
          <p className="text-xs font-semibold text-amber-800 mb-2">Small Bags</p>
          <div className="flex gap-2 flex-wrap mb-2">
            {bagStatusOptions.map(([v, l]) => (
              <button key={v} onClick={() => setSmallStatus(v)}
                className={`text-[11px] font-medium px-3 py-2 rounded-xl border transition-colors ${smallStatus === v ? 'bg-amber-600 text-white border-amber-600' : 'border-amber-300 bg-white text-amber-800'}`}>
                {l}
              </button>
            ))}
          </div>
          {smallStatus === 'accepted' && (
            <div className="flex items-center gap-2 bg-white border border-amber-300 rounded-xl px-3 py-2">
              <button onClick={() => setSmallAccepted(Math.max(0, smallAccepted - 1))} className="text-amber-700 font-bold text-lg">−</button>
              <span className="flex-1 text-center text-sm font-semibold text-amber-800">{smallAccepted} collected</span>
              <button onClick={() => setSmallAccepted(smallAccepted + 1)} className="text-amber-700 font-bold text-lg">+</button>
            </div>
          )}
        </div>
      )}

      {ret.tote_bags_requested > 0 && (
        <div>
          <p className="text-xs font-semibold text-amber-800 mb-2">Tote Bags</p>
          <div className="flex gap-2 flex-wrap mb-2">
            {bagStatusOptions.map(([v, l]) => (
              <button key={v} onClick={() => setToteStatus(v)}
                className={`text-[11px] font-medium px-3 py-2 rounded-xl border transition-colors ${toteStatus === v ? 'bg-amber-600 text-white border-amber-600' : 'border-amber-300 bg-white text-amber-800'}`}>
                {l}
              </button>
            ))}
          </div>
          {toteStatus === 'accepted' && (
            <div className="flex items-center gap-2 bg-white border border-amber-300 rounded-xl px-3 py-2">
              <button onClick={() => setToteAccepted(Math.max(0, toteAccepted - 1))} className="text-amber-700 font-bold text-lg">−</button>
              <span className="flex-1 text-center text-sm font-semibold text-amber-800">{toteAccepted} collected</span>
              <button onClick={() => setToteAccepted(toteAccepted + 1)} className="text-amber-700 font-bold text-lg">+</button>
            </div>
          )}
        </div>
      )}

      {(smallStatus === 'not_eligible' || toteStatus === 'not_eligible') && (
        <div>
          <p className="text-xs font-semibold text-amber-800 mb-2">Rejection Reason</p>
          <div className="flex gap-2 flex-wrap">
            {REJECTION_REASONS.map(r => (
              <button key={r.key} onClick={() => setReason(r.key)}
                className={`text-[11px] px-3 py-1.5 rounded-xl border transition-colors ${reason === r.key ? 'bg-red-100 border-red-300 text-red-700' : 'border-amber-300 bg-white text-amber-800'}`}>
                {r.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="text-xs font-semibold text-amber-800 mb-1.5">Photo <span className="font-normal text-amber-600">(optional)</span></p>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhoto} />
        {photoUrl ? (
          <div className="relative inline-block w-full">
            <img src={photoUrl} alt="Evidence" className="w-full max-w-xs rounded-xl border border-amber-200" />
            <button onClick={() => setPhotoUrl('')} className="absolute top-2 right-2 w-7 h-7 bg-black/50 rounded-full flex items-center justify-center">
              <X className="w-3.5 h-3.5 text-white" />
            </button>
          </div>
        ) : (
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
            className="flex items-center gap-2 px-4 py-2.5 border-2 border-dashed border-amber-300 rounded-xl text-xs text-amber-700 w-full justify-center bg-white">
            {uploading ? <div className="w-4 h-4 border-2 border-amber-600 border-t-transparent rounded-full animate-spin" /> : <Camera className="w-4 h-4" />}
            {uploading ? 'Uploading...' : 'Take or Upload Photo'}
          </button>
        )}
      </div>

      <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Driver notes (optional)"
        className="w-full text-xs border border-amber-300 rounded-xl px-3 py-2.5 bg-white resize-none focus:outline-none focus:ring-1 focus:ring-amber-400 text-amber-900 placeholder:text-amber-400" />

      <div className="bg-white border border-amber-200 rounded-xl p-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Leaf className="w-4 h-4 text-amber-600" />
          <p className="text-sm font-semibold text-amber-800">Credit to Issue</p>
        </div>
        <p className="font-heading text-xl font-bold text-amber-700">${calcCredit().toFixed(2)}</p>
      </div>

      <button onClick={handleSubmit} disabled={saving || uploading}
        className="w-full py-3 bg-amber-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50 active:scale-[0.98] transition-transform">
        {saving ? 'Submitting...' : 'Confirm Bag Return'}
      </button>
    </div>
  );
}

// ─── Stop Card ──────────────────────────────────────────────────────────────

const DROP_LOCATIONS = [
  'Front Door', 'Back Door', 'Garage', 'Side Door',
  'With Neighbor', 'Mailroom / Lobby', 'Left on Porch', 'Other',
];

function StopCard({ order, pendingReturn, onMarkDelivered, onMarkUnableToDeliver, onMarkStage, onReturnVerified, allCredits, user, isUpdating }) {
  const [expanded, setExpanded] = useState(false);
  const [showDeliverForm, setShowDeliverForm] = useState(false);
  const [showUnableForm, setShowUnableForm] = useState(false);
  const [unableReason, setUnableReason] = useState('customer_not_home');
  const [unableNotes, setUnableNotes] = useState('');
  const [proofPhotoUrl, setProofPhotoUrl] = useState('');
  const [dropLocation, setDropLocation] = useState('Front Door');
  const [uploadingProof, setUploadingProof] = useState(false);
  const proofFileRef = useRef(null);

  const isDelivered = order.status === 'delivered';
  const currentStageIndex = DELIVERY_STAGES.findIndex(s => s.key === order.status);
  const nextStage = DELIVERY_STAGES[currentStageIndex + 1];

  const handleUnableSubmit = () => {
    onMarkUnableToDeliver(order, unableReason, unableNotes);
    setShowUnableForm(false);
  };

  const handleProofPhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingProof(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setProofPhotoUrl(file_url);
    } catch { toast.error('Photo upload failed'); }
    setUploadingProof(false);
  };

  const handleConfirmDelivery = () => {
    if (!proofPhotoUrl) {
      toast.error('Please take a proof of delivery photo');
      return;
    }
    onMarkDelivered(order, proofPhotoUrl, dropLocation);
    setShowDeliverForm(false);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`bg-card border rounded-2xl overflow-hidden w-full min-w-0 ${
        isDelivered ? 'border-green-200 opacity-75'
        : pendingReturn ? 'border-amber-300'
        : 'border-border/50'
      }`}
    >
      {/* Header row */}
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center gap-3 px-3.5 py-3 text-left active:bg-secondary/30 transition-colors">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isDelivered ? 'bg-green-100 text-green-600' : 'bg-primary/10 text-primary'}`}>
          {isDelivered ? <CheckCircle2 className="w-4 h-4" /> : <MapPin className="w-4 h-4" />}
        </div>
        <div className="flex-1 min-w-0 overflow-hidden">
          <div className="flex items-center gap-1.5 mb-0.5 overflow-hidden">
            <p className="text-sm font-bold shrink-0">#{order.order_number}</p>
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${isDelivered ? 'bg-green-100 text-green-700' : 'bg-primary/10 text-primary'}`}>
              {isDelivered ? 'Done ✓' : DELIVERY_STAGES.find(s => s.key === order.status)?.label || order.status}
            </span>
          </div>
          <p className="text-xs text-muted-foreground truncate">{order.delivery_address}</p>
          {pendingReturn && (
            <div className="flex items-center gap-1 mt-0.5">
              <Recycle className="w-3 h-3 text-amber-600 shrink-0" />
              <p className="text-[10px] font-semibold text-amber-600 truncate">
                {pendingReturn.verification_status === 'requested' ? 'Bag return to collect' : 'Return handled ✓'}
              </p>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0 ml-1">
          {order.leg_duration_seconds && <span className="text-[10px] text-muted-foreground">{formatDuration(order.leg_duration_seconds)}</span>}
          {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="border-t border-border/40 px-3.5 pb-4 pt-3 space-y-3 overflow-hidden">

              {/* Customer info */}
              <div className="space-y-0.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Customer</p>
                <p className="text-xs break-all">{order.customer_email}</p>
                {order.contact_phone && <p className="text-xs font-semibold">{order.contact_phone}</p>}
              </div>

              {/* Items */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Items</p>
                {order.items?.map((item, i) => (
                  <p key={i} className="text-xs">{item.title} × {item.quantity}</p>
                ))}
              </div>

              {/* Inline bag return verifier — only if pending */}
              {pendingReturn && pendingReturn.verification_status === 'requested' && (
                <InlineBagReturn
                  ret={pendingReturn}
                  user={user}
                  onVerifyComplete={onReturnVerified}
                />
              )}

              {/* Return already handled */}
              {pendingReturn && pendingReturn.verification_status !== 'requested' && (
                <div className="bg-green-50 border border-green-200 rounded-xl p-3 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                  <div>
                    <p className="text-xs font-semibold text-green-700">Return Verified</p>
                    <p className="text-[10px] text-green-600">{pendingReturn.verification_status?.replace(/_/g, ' ')} · ${(pendingReturn.credit_issued || 0).toFixed(2)} credit issued</p>
                  </div>
                </div>
              )}

              {/* Navigate button */}
              <a href={mapsUrl(order.delivery_address)} target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full py-3 bg-blue-500 text-white rounded-xl text-sm font-semibold active:scale-95 transition-transform">
                <Navigation className="w-4 h-4" />
                Navigate to Stop
              </a>

              {/* Delivery actions */}
              {!isDelivered && (
                <>
                  {!showDeliverForm && !showUnableForm && (
                    <>
                      {/* Progressive stage button — let driver manually update as they progress */}
                      {nextStage && nextStage.key !== 'delivered' && (
                        <button onClick={() => onMarkStage(order, nextStage)} disabled={isUpdating}
                          className="w-full py-2.5 border border-primary text-primary rounded-xl text-xs font-semibold active:scale-95 transition-transform">
                          → Mark {nextStage.label}
                        </button>
                      )}

                      <div className="grid grid-cols-2 gap-2">
                        <button onClick={() => setShowDeliverForm(true)} disabled={isUpdating}
                          className="py-3 bg-primary text-primary-foreground rounded-xl text-sm font-semibold disabled:opacity-50 active:scale-95 transition-transform flex items-center justify-center gap-1.5">
                          <Truck className="w-4 h-4" />
                          Delivered
                        </button>
                        <button onClick={() => setShowUnableForm(true)} disabled={isUpdating}
                          className="py-3 bg-red-50 text-red-600 border border-red-200 rounded-xl text-sm font-semibold disabled:opacity-50 active:scale-95 transition-transform flex items-center justify-center gap-1.5">
                          <AlertTriangle className="w-4 h-4" />
                          Unable to Deliver
                        </button>
                      </div>
                      </>
                      )}

                  {/* ── Proof of Delivery Form ── */}
                  {showDeliverForm && (
                    <div className="bg-green-50 border border-green-200 rounded-xl p-4 space-y-4">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-bold text-green-800">Proof of Delivery</p>
                        <button onClick={() => setShowDeliverForm(false)} className="text-green-400">
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      {/* Photo capture */}
                      <div>
                        <p className="text-xs font-semibold text-green-800 mb-2">
                          Delivery Photo <span className="text-red-500">*</span>
                          <span className="font-normal text-green-600 ml-1">— required</span>
                        </p>
                        <input ref={proofFileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleProofPhoto} />
                        {proofPhotoUrl ? (
                          <div className="relative">
                            <img src={proofPhotoUrl} alt="Proof of delivery" className="w-full rounded-xl border-2 border-green-300 object-cover max-h-48" />
                            <button onClick={() => setProofPhotoUrl('')} className="absolute top-2 right-2 w-7 h-7 bg-black/60 rounded-full flex items-center justify-center">
                              <X className="w-3.5 h-3.5 text-white" />
                            </button>
                            <div className="absolute bottom-2 left-2 bg-green-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" /> Photo captured
                            </div>
                          </div>
                        ) : (
                          <button onClick={() => proofFileRef.current?.click()} disabled={uploadingProof}
                            className="flex flex-col items-center gap-2 w-full py-6 border-2 border-dashed border-green-300 rounded-xl bg-white text-green-700 active:scale-95 transition-transform">
                            {uploadingProof
                              ? <div className="w-6 h-6 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
                              : <Camera className="w-7 h-7" />}
                            <p className="text-sm font-semibold">{uploadingProof ? 'Uploading...' : 'Take Delivery Photo'}</p>
                            <p className="text-[10px] text-green-500">Show package at the door / drop location</p>
                          </button>
                        )}
                      </div>

                      {/* Drop location */}
                      <div>
                        <p className="text-xs font-semibold text-green-800 mb-2">Left At</p>
                        <div className="flex flex-wrap gap-2">
                          {DROP_LOCATIONS.map(loc => (
                            <button key={loc} onClick={() => setDropLocation(loc)}
                              className={`text-[11px] px-3 py-1.5 rounded-xl border transition-colors font-medium ${dropLocation === loc ? 'bg-green-600 text-white border-green-600' : 'border-green-200 bg-white text-green-800'}`}>
                              {loc}
                            </button>
                          ))}
                        </div>
                      </div>

                      <button onClick={handleConfirmDelivery} disabled={isUpdating || uploadingProof || !proofPhotoUrl}
                        className="w-full py-3.5 bg-green-600 text-white rounded-xl text-sm font-bold disabled:opacity-50 active:scale-[0.98] transition-transform flex items-center justify-center gap-2">
                        {isUpdating ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Confirming...</> : <><CheckCircle2 className="w-4 h-4" /> Confirm Delivery</>}
                      </button>
                    </div>
                  )}

                  {/* ── Unable to Deliver Form ── */}
                  {showUnableForm && (
                    <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-bold text-red-700">Unable to Deliver</p>
                        <button onClick={() => setShowUnableForm(false)} className="text-red-400"><X className="w-4 h-4" /></button>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-red-700 mb-2">Reason</p>
                        <div className="flex flex-wrap gap-2">
                          {UNABLE_TO_DELIVER_REASONS.map(r => (
                            <button key={r.key} onClick={() => setUnableReason(r.key)}
                              className={`text-[11px] px-3 py-1.5 rounded-xl border transition-colors ${unableReason === r.key ? 'bg-red-600 text-white border-red-600' : 'border-red-200 bg-white text-red-700'}`}>
                              {r.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <textarea value={unableNotes} onChange={e => setUnableNotes(e.target.value)} rows={2}
                        placeholder="Additional notes..."
                        className="w-full text-xs border border-red-200 rounded-xl px-3 py-2.5 bg-white resize-none focus:outline-none focus:ring-1 focus:ring-red-300 text-red-900 placeholder:text-red-300" />
                      <button onClick={handleUnableSubmit} disabled={isUpdating}
                        className="w-full py-3 bg-red-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50 active:scale-95 transition-transform">
                        {isUpdating ? 'Submitting...' : 'Submit & Move On'}
                      </button>
                    </div>
                  )}
                </>
              )}

              {/* Delivered — show proof */}
              {isDelivered && (
                <div className="space-y-2">
                  <div className="py-3 bg-green-50 text-green-700 rounded-xl text-sm font-semibold text-center border border-green-200 flex items-center justify-center gap-2">
                    <CheckCircle2 className="w-4 h-4" /> Delivered
                    {order.delivery_drop_location && <span className="font-normal text-xs text-green-600">· {order.delivery_drop_location}</span>}
                  </div>
                  {order.delivery_photo_url && (
                    <div className="relative rounded-xl overflow-hidden border border-green-200">
                      <img src={order.delivery_photo_url} alt="Proof of delivery" className="w-full object-cover max-h-40" />
                      <div className="absolute bottom-0 left-0 right-0 bg-black/50 px-3 py-1.5 flex items-center justify-between">
                        <p className="text-white text-[10px] font-semibold">Proof of Delivery</p>
                        {order.delivered_at && <p className="text-white/70 text-[10px]">{format(new Date(order.delivered_at), 'h:mm a')}</p>}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Route Tab ──────────────────────────────────────────────────────────────

// Get today's date in YYYY-MM-DD (local time)
function todayStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function RouteTab({ bagReturns, allCredits, user, onBagReturnVerified }) {
  const [date, setDate] = useState(todayStr());
  const [allOrders, setAllOrders] = useState(null); // all queued orders (no date filter)
  const [queuedOrders, setQueuedOrders] = useState(null); // filtered by selected date
  const [routeData, setRouteData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [updatingId, setUpdatingId] = useState(null);

  const loadQueue = async () => {
    setLoading(true);
    setRouteData(null);
    try {
      // Fetch all orders (no date filter) for multi-day overview
      const [allRes, dateRes] = await Promise.all([
        base44.functions.invoke('optimizeDeliveryRoute', { optimize: false }),
        base44.functions.invoke('optimizeDeliveryRoute', { date, optimize: false }),
      ]);
      setAllOrders(allRes.data?.orders || []);
      setQueuedOrders(dateRes.data?.orders || []);
    } catch {
      toast.error('Failed to load delivery queue');
    } finally {
      setLoading(false);
    }
  };

  const optimizeRoute = async () => {
    if (!queuedOrders?.length) return;
    setOptimizing(true);
    try {
      const res = await base44.functions.invoke('optimizeDeliveryRoute', { date, optimize: true });
      setRouteData(res.data);
      toast.success(`Route optimized! ${queuedOrders.length} stops`);
    } catch {
      toast.error('Optimization failed');
    } finally {
      setOptimizing(false);
    }
  };

  // Group all orders by delivery date for the multi-day overview
  const ordersByDate = useMemo(() => {
    if (!allOrders) return [];
    const map = {};
    for (const o of allOrders) {
      const d = o.estimated_delivery_date || o.assigned_delivery_date || 'unscheduled';
      if (!map[d]) map[d] = [];
      map[d].push(o);
    }
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([d, orders]) => ({ date: d, orders }));
  }, [allOrders]);

  useEffect(() => { loadQueue(); }, [date]);

  const handleMarkDelivered = async (order, proofPhotoUrl, dropLocation) => {
    setUpdatingId(order.id);
    const deliveredAt = new Date().toISOString();
    try {
      if (order.is_hub_order) {
        // Hub-managed: push status-only to Hub
        await base44.functions.invoke('pushOrderStatusToHub', {
          hub_order_id: order.hub_order_id || null,
          order_number: order.order_number,
          customer_email: order.hub_customer_email || order.customer_email,
          new_status: 'delivered',
          stage_label: 'Delivered',
        });
      } else {
        const newHistory = [
          ...(order.status_history || []),
          { status: 'delivered', timestamp: deliveredAt, message: `Delivered · ${dropLocation}` },
        ];
        await base44.entities.Order.update(order.id, {
          status: 'delivered',
          status_history: newHistory,
          delivery_photo_url: proofPhotoUrl,
          delivery_drop_location: dropLocation,
          delivered_by: user?.email,
          delivered_at: deliveredAt,
        });
      }
      // Send proof-of-delivery email to customer
      const itemsList = order.items?.map(i => `${i.title} ×${i.quantity}`).join(', ') || '';
      const deliveredTime = new Date(deliveredAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' });
      await base44.integrations.Core.SendEmail({
        to: order.customer_email,
        subject: `Your NuVira order #${order.order_number} was delivered! 🌿`,
        body: `Hi there!\n\nGreat news — your NuVira order has been delivered.\n\n📦 Order: #${order.order_number}\n🕒 Delivered at: ${deliveredTime}\n📍 Left at: ${dropLocation}\n🛍 Items: ${itemsList}\n\nThanks for choosing NuVira — stay nourished! 🥤\n\nThe NuVira Team`,
      });
      toast.success('Delivery confirmed & customer notified');
      loadQueue();
      setRouteData(null);
    } catch {
      toast.error('Update failed');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleMarkUnableToDeliver = async (order, reason, notes) => {
    setUpdatingId(order.id);
    const newHistory = [
      ...(order.status_history || []),
      { status: 'order_received', timestamp: new Date().toISOString(), message: `Unable to deliver: ${reason}${notes ? ` — ${notes}` : ''}` },
    ];
    try {
      // Revert to order_received so admin can reschedule
      await base44.entities.Order.update(order.id, {
        status: 'order_received',
        status_history: newHistory,
        notes: `Unable to deliver on ${new Date().toLocaleDateString()} — Reason: ${reason}${notes ? `. ${notes}` : ''}`,
      });
      // If there's a bag return tied to this order, mark it unable_to_collect
      const linkedReturn = bagReturns.find(r => r.customer_email === order.customer_email && r.verification_status === 'requested');
      if (linkedReturn) {
        await base44.entities.BagReturn.update(linkedReturn.id, {
          verification_status: 'unable_to_collect',
          rejection_reason: reason === 'customer_not_home' ? 'customer_not_home' : 'other',
          driver_notes: `Unable to deliver — ${reason}${notes ? `. ${notes}` : ''}`,
          verified_by: user?.email,
          verified_at: new Date().toISOString(),
        });
      }
      toast.success('Stop marked — admin notified');
      loadQueue();
      setRouteData(null);
    } catch {
      toast.error('Update failed');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleMarkStage = async (order, nextStage) => {
    setUpdatingId(order.id);
    try {
      if (order.is_hub_order) {
        await base44.functions.invoke('pushOrderStatusToHub', {
          hub_order_id: order.hub_order_id || null,
          order_number: order.order_number,
          customer_email: order.hub_customer_email || order.customer_email,
          new_status: nextStage.key,
          stage_label: nextStage.label,
        });
      } else {
        const newHistory = [...(order.status_history || []), { status: nextStage.key, timestamp: new Date().toISOString(), message: nextStage.label }];
        await base44.entities.Order.update(order.id, { status: nextStage.key, status_history: newHistory });
      }
      // Update local display in-place
      if (routeData?.optimized_orders) {
        const updated = routeData.optimized_orders.map(o =>
          o.id === order.id ? { ...o, status: nextStage.key } : o
        );
        setRouteData({ ...routeData, optimized_orders: updated });
      }
      if (queuedOrders) {
        setQueuedOrders(queuedOrders.map(o => o.id === order.id ? { ...o, status: nextStage.key } : o));
      }
      toast.success(`Marked ${nextStage.label}`);
    } catch {
      toast.error('Update failed');
    } finally {
      setUpdatingId(null);
    }
  };

  const displayOrders = routeData?.optimized_orders || queuedOrders || [];
  const isOptimized = !!routeData?.optimized_orders;
  const delivered = displayOrders.filter(o => o.status === 'delivered').length;

  // Filter returns to only those linked to today's route orders
  const todaysOrderIds = new Set(displayOrders.map(o => o.id));
  const todaysBagReturns = bagReturns.filter(r => todaysOrderIds.has(r.order_id));
  const pendingBagReturns = bagReturns.filter(r => !todaysOrderIds.has(r.order_id) && r.verification_status === 'requested');

  // Map today's returns by customer email for quick lookup in route
  const pendingReturnsByEmail = {};
  todaysBagReturns.forEach(r => {
    if (!pendingReturnsByEmail[r.customer_email]) {
      pendingReturnsByEmail[r.customer_email] = r;
    }
  });

  // Count returns linked to today's route stops
  const routeReturnCount = todaysBagReturns.filter(r => r.verification_status === 'requested').length;

  return (
    <div className="pb-10">
      {/* Multi-day overview */}
      {ordersByDate.length > 0 && (
        <div className="px-4 pt-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Upcoming Deliveries</p>
          <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
            {ordersByDate.map(({ date: d, orders: dayOrders }) => {
              const isSelected = d === date;
              const delivered = dayOrders.filter(o => o.status === 'delivered').length;
              const remaining = dayOrders.length - delivered;
              const isToday = d === todayStr();
              const label = d === 'unscheduled' ? 'Unscheduled' : (() => {
                const [y, m, dy] = d.split('-').map(Number);
                return new Date(y, m - 1, dy).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
              })();
              return (
                <button
                  key={d}
                  onClick={() => { setDate(d === 'unscheduled' ? '' : d); setRouteData(null); }}
                  className={`shrink-0 px-3 py-2 rounded-xl border text-left transition-colors ${
                    isSelected
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-card border-border/50 text-foreground'
                  }`}
                >
                  <p className={`text-xs font-bold ${isSelected ? 'text-primary-foreground' : ''}`}>
                    {label}{isToday ? ' · Today' : ''}
                  </p>
                  <p className={`text-[10px] mt-0.5 ${isSelected ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                    {remaining > 0 ? `${remaining} left` : `${delivered} done ✓`}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Date filter */}
      <div className="px-4 pt-3 space-y-1">
        <div className="flex gap-2">
          <input type="date" value={date} onChange={e => { setDate(e.target.value); setRouteData(null); }}
            className="flex-1 bg-card border border-border text-sm px-3 py-2 rounded-xl focus:outline-none focus:ring-1 focus:ring-primary" />
          <button onClick={loadQueue} disabled={loading}
            className="w-10 h-10 bg-secondary rounded-xl flex items-center justify-center shrink-0">
            <RefreshCw className={`w-4 h-4 text-muted-foreground ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        {date && <p className="text-[11px] text-muted-foreground px-1">Showing deliveries for {date} — includes future Hub routes</p>}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 divide-x divide-border border-y border-border bg-card mt-4">
        {[
          { label: 'Queued', value: queuedOrders?.length ?? '—', color: 'text-foreground' },
          { label: 'Done', value: delivered, color: 'text-green-600' },
          { label: 'Left', value: (queuedOrders?.length ?? 0) - delivered, color: 'text-primary' },
          { label: "Today's Returns", value: routeReturnCount, color: 'text-amber-600' },
        ].map(s => (
          <div key={s.label} className="py-3 text-center">
            <p className={`text-xl font-bold font-heading ${s.color}`}>{s.value}</p>
            <p className="text-[10px] text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Optimize CTA */}
      {queuedOrders?.length > 0 && !isOptimized && (
        <div className="px-4 mt-4">
          <button onClick={optimizeRoute} disabled={optimizing}
            className="w-full py-3.5 bg-primary text-primary-foreground rounded-xl text-sm font-semibold disabled:opacity-60 flex items-center justify-center gap-2 active:scale-[0.98] transition-transform">
            {optimizing
              ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Optimizing...</>
              : <><Route className="w-4 h-4" /> Optimize Route ({queuedOrders.length} stops)</>
            }
          </button>
        </div>
      )}

      {/* Route summary + Open in Maps */}
      {isOptimized && (
        <div className="px-4 mt-4 space-y-2">
          {routeData?.total_distance_miles && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-blue-600 shrink-0" />
                <p className="text-xs text-blue-700 font-medium">~{routeData.total_duration_minutes} min · {routeData.total_distance_miles} mi</p>
              </div>
              <button onClick={() => setRouteData(null)} className="text-[10px] text-blue-500 font-semibold underline">Reset</button>
            </div>
          )}
          {(() => {
            const url = buildFullRouteUrl(displayOrders);
            return url ? (
              <a href={url} target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full py-3.5 bg-blue-600 text-white rounded-xl text-sm font-bold active:scale-[0.98] transition-transform">
                <Navigation className="w-4 h-4" />
                Open Full Route in Maps
              </a>
            ) : null;
          })()}
        </div>
      )}

      {/* Order list */}
      <div className="px-4 mt-4 space-y-3 overflow-hidden">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-muted-foreground">Loading delivery queue...</p>
          </div>
        ) : displayOrders.length === 0 ? (
          <div className="text-center py-16">
            <CheckCircle2 className="w-10 h-10 text-primary mx-auto mb-3" />
            <p className="text-sm font-semibold">No deliveries{date ? ` on ${date}` : ''}</p>
            <p className="text-xs text-muted-foreground mt-1">{date ? 'No orders scheduled for this date.' : 'All done for today!'}</p>
          </div>
        ) : (
          <>
            <p className="text-xs text-muted-foreground font-medium px-1">
              {isOptimized
                ? `${displayOrders.length} stops · optimized order`
                : `${displayOrders.length} stop${displayOrders.length > 1 ? 's' : ''} · tap to review bag returns`}
            </p>
            {displayOrders.map((order, idx) => (
              <div key={order.id} className="flex gap-2 min-w-0">
                {isOptimized && (
                  <div className="flex flex-col items-center pt-3 shrink-0">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${order.status === 'delivered' ? 'bg-green-100 text-green-600' : 'bg-primary text-primary-foreground'}`}>
                      {order.status === 'delivered' ? '✓' : idx + 1}
                    </div>
                    {idx < displayOrders.length - 1 && <div className="w-0.5 flex-1 bg-border mt-1" />}
                  </div>
                )}
                <div className="flex-1 min-w-0 pb-2">
                  {isOptimized ? (
                    <StopCard
                      order={order}
                      pendingReturn={pendingReturnsByEmail[order.customer_email] || null}
                      onMarkDelivered={(order, photo, loc) => handleMarkDelivered(order, photo, loc)}
                      onMarkUnableToDeliver={handleMarkUnableToDeliver}
                      onMarkStage={handleMarkStage}
                      onReturnVerified={(ret, data) => onBagReturnVerified(ret, data)}
                      allCredits={allCredits}
                      user={user}
                      isUpdating={updatingId === order.id}
                    />
                  ) : (
                    <PreOptimizeOrderCard
                      order={order}
                      pendingReturn={pendingReturnsByEmail[order.customer_email] || null}
                      onVerifyReturn={(ret, data) => onBagReturnVerified(ret, data)}
                      user={user}
                      isUpdating={updatingId === order.id}
                    />
                  )}
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Pending Bag Returns — Future deliveries */}
      {pendingBagReturns.length > 0 && (
        <div className="px-4 mt-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Pending Collections — Future Deliveries
          </p>
          <div className="space-y-2">
            {pendingBagReturns.map(ret => (
              <div key={ret.id} className="bg-card border border-border/40 rounded-xl p-3 flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-xs font-medium truncate">{ret.customer_email}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{bagSummary(ret)}</p>
                </div>
                <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 px-2 py-1 rounded-full shrink-0 ml-2">Pending</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">These will appear in Route when their delivery is scheduled for today.</p>
        </div>
      )}
    </div>
  );
}

// ─── Returns Tab ────────────────────────────────────────────────────────────

function ReturnCard({ ret, user, onVerify }) {
  const [expanded, setExpanded] = useState(false);
  const isPending = ret.verification_status === 'requested';

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
            <div className="p-4 border-t border-border/40 space-y-3">
              {!isPending ? (
                <div className="space-y-1.5 text-sm text-muted-foreground">
                  <p><span className="text-foreground font-medium">Small bags:</span> {ret.small_bags_accepted || 0} of {ret.small_bags_requested || 0} accepted</p>
                  <p><span className="text-foreground font-medium">Tote bags:</span> {ret.tote_bags_accepted || 0} of {ret.tote_bags_requested || 0} accepted</p>
                  {ret.rejection_reason && <p><span className="text-foreground font-medium">Reason:</span> {ret.rejection_reason.replace(/_/g, ' ')}</p>}
                  {ret.driver_notes && <p><span className="text-foreground font-medium">Notes:</span> {ret.driver_notes}</p>}
                  {ret.photo_url && <img src={ret.photo_url} alt="Evidence" className="w-full max-w-xs rounded-xl border border-border mt-2" />}
                  {ret.verified_by && <p className="text-[10px]">Verified by {ret.verified_by}</p>}
                </div>
              ) : (
                <InlineBagReturn ret={ret} user={user} onVerifyComplete={onVerify} />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ReturnsTab({ returns, user, isLoading, onVerify }) {
  const [filter, setFilter] = useState('pending');
  const pending = returns.filter(r => r.verification_status === 'requested');
  const completed = returns.filter(r => r.verification_status !== 'requested');
  const todayDone = completed.filter(r => r.verified_at?.startsWith(new Date().toISOString().slice(0, 10))).length;
  const displayed = filter === 'pending' ? pending : completed;

  return (
    <div className="pb-10">
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
          </div>
        ) : (
          displayed.map(ret => (
            <ReturnCard key={ret.id} ret={ret} user={user} onVerify={(data) => onVerify(ret, data)} />
          ))
        )}
      </div>
    </div>
  );
}

// ─── Main Portal ────────────────────────────────────────────────────────────

export default function DriverPortal() {
  const { user } = useAuth();
  const navigate = useNavigate();
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
          amount: data.credit_issued, type: 'issued',
          description: `Return + Reward${data.verification_status === 'partially_verified' ? ' (Partial)' : ''}`,
          order_id: ret.order_id, timestamp: new Date().toISOString(),
        };
        if (existing) {
          await base44.entities.NuViraCredit.update(existing.id, {
            balance: (existing.balance || 0) + data.credit_issued,
            lifetime_issued: (existing.lifetime_issued || 0) + data.credit_issued,
            history: [...(existing.history || []), entry],
          });
        } else {
          await base44.entities.NuViraCredit.create({
            customer_email: ret.customer_email, balance: data.credit_issued,
            lifetime_issued: data.credit_issued, lifetime_used: 0, history: [entry],
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
      } else if (data.verification_status === 'unable_to_collect') {
        await base44.integrations.Core.SendEmail({
          to: ret.customer_email,
          subject: 'Bag Return — Unable to Collect Today',
          body: `We were unable to collect your bags during today's delivery. We'll try again on your next delivery. Thank you for your patience!`,
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
      toast.success('Return submitted');
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
    <div className="min-h-screen bg-background overflow-x-hidden">
      <div className="bg-primary px-4 pb-4" style={{ paddingTop: 'max(2.5rem, env(safe-area-inset-top))' }}>
        <div className="flex items-center gap-2 mb-0.5">
          {user?.role === 'admin' && (
            <button onClick={() => navigate('/admin/orders')} className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30 transition-colors">
              <ArrowLeft className="w-4 h-4 text-white" />
            </button>
          )}
          <Leaf className="w-5 h-5 text-primary-foreground/70" />
          <h1 className="font-heading text-2xl font-bold text-primary-foreground">Driver Portal</h1>
        </div>
        <p className="text-primary-foreground/50 text-[11px]">{user.email}</p>

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

      {tab === 'route' ? (
        <RouteTab
          bagReturns={bagReturns}
          allCredits={allCredits}
          user={user}
          onBagReturnVerified={(ret, data) => verifyMutation.mutate({ ret, data })}
        />
      ) : (
        <ReturnsTab
          returns={bagReturns}
          user={user}
          isLoading={returnsLoading}
          onVerify={(ret, data) => verifyMutation.mutate({ ret, data })}
        />
      )}
    </div>
  );
}