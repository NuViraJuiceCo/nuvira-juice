import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronRight, MapPin, Navigation, Recycle, X, Camera, Edit2 } from 'lucide-react';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { useRef } from 'react';

function driverItemLine(item) {
  const title = `${item?.title || item?.name || ''}`.trim();
  if (!title) return null;
  const quantity = item?.quantity ?? item?.qty;
  if (quantity === null || quantity === undefined || quantity === '') return title;
  return `${title} ×${quantity}`;
}

export default function PreOptimizeOrderCard({ order, pendingReturn, onVerifyReturn, user, isUpdating: _isUpdating }) {
  const [expanded, setExpanded] = useState(false);
  const [showReturnForm, setShowReturnForm] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [smallStatus, setSmallStatus] = useState('accepted');
  const [toteStatus, setToteStatus] = useState('accepted');
  const [smallAccepted, setSmallAccepted] = useState(pendingReturn?.small_bags_requested || 0);
  const [toteAccepted, setToteAccepted] = useState(pendingReturn?.tote_bags_requested || 0);
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

  const REJECTION_REASONS = [
    { key: 'dirty_stained', label: 'Dirty / Stained' },
    { key: 'odor', label: 'Odor' },
    { key: 'damaged', label: 'Damaged' },
    { key: 'customer_not_home', label: 'Customer Not Home' },
    { key: 'other', label: 'Other' },
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
      toast.error('Photo upload failed');
    }
    setUploading(false);
  };

  const handleSubmit = () => {
    setSaving(true);
    const credit = calcCredit();
    let vStatus = 'verified';
    if (credit === 0) vStatus = (smallStatus === 'not_found' || toteStatus === 'not_found') ? 'not_found' : 'not_eligible';
    else if (smallAccepted < pendingReturn.small_bags_requested || toteAccepted < pendingReturn.tote_bags_requested) vStatus = 'partially_verified';

    onVerifyReturn(pendingReturn, {
      small_bag_status: smallStatus, tote_bag_status: toteStatus,
      small_bags_accepted: smallAccepted, tote_bags_accepted: toteAccepted,
      rejection_reason: (smallStatus === 'not_eligible' || toteStatus === 'not_eligible') ? reason : '',
      driver_notes: notes, photo_url: photoUrl || '',
      verification_status: vStatus, credit_issued: credit,
      verified_by: user?.email, verified_at: new Date().toISOString(), credit_applied: credit > 0,
    });
    setSaving(false);
    setShowReturnForm(false);
    setIsEditing(false);
  };

  const handleEditMode = () => {
    setIsEditing(true);
    setSmallStatus(pendingReturn.small_bag_status);
    setToteStatus(pendingReturn.tote_bag_status);
    setSmallAccepted(pendingReturn.small_bags_accepted || 0);
    setToteAccepted(pendingReturn.tote_bags_accepted || 0);
    setReason(pendingReturn.rejection_reason || 'dirty_stained');
    setNotes(pendingReturn.driver_notes || '');
    setPhotoUrl(pendingReturn.photo_url || '');
    setShowReturnForm(true);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card border border-border/50 rounded-2xl overflow-hidden"
    >
      <div className="w-full flex items-center gap-3 p-3.5 text-left">
        <button onClick={() => setExpanded(!expanded)} className="flex-1 flex items-center gap-3 min-w-0 active:opacity-70 transition-opacity">
          <div className="w-8 h-8 bg-muted rounded-full flex items-center justify-center shrink-0">
            <MapPin className="w-3.5 h-3.5 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
              <p className="text-sm font-bold">#{order.order_number}</p>
              {pendingReturn && (
                <span className="flex items-center gap-0.5 rounded-full border border-cyan-200 bg-cyan-50 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-800 dark:border-cyan-900/60 dark:bg-cyan-950/40 dark:text-cyan-100">
                  <Recycle className="w-2.5 h-2.5" />
                  Return
                </span>
              )}
            </div>
            {order.customer_name && <p className="text-xs font-semibold text-foreground truncate leading-tight">{order.customer_name}</p>}
            <p className="text-xs text-muted-foreground truncate leading-tight max-w-[180px]">{order.delivery_address?.split(',').slice(0, 2).join(',') || <span className="italic">No address</span>}</p>
            {order.estimated_delivery_date && (
              <p className="text-[10px] text-primary font-medium">📅 {order.estimated_delivery_date}</p>
            )}
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight truncate max-w-[180px]">{order.items?.map(driverItemLine).filter(Boolean).join(', ')}</p>
          </div>
        </button>
        <div className="flex items-center gap-1.5 shrink-0">
          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(order.delivery_address)}&travelmode=driving`}
            target="_blank"
            rel="noopener noreferrer"
            className="w-9 h-9 bg-blue-500 rounded-xl flex items-center justify-center active:scale-95 transition-transform"
            onClick={e => e.stopPropagation()}
          >
            <Navigation className="w-4 h-4 text-white" />
          </a>
          <button onClick={() => setExpanded(!expanded)} className="w-7 h-7 flex items-center justify-center">
            {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="border-t border-border/40 px-4 pb-4 pt-3 space-y-3">
              {/* Customer info */}
              <div className="bg-secondary/40 rounded-xl p-3 space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Customer</p>
                {order.customer_name && <p className="text-xs font-semibold text-foreground">{order.customer_name}</p>}
                <p className="text-xs text-muted-foreground break-all">{order.customer_email}</p>
                <p className="text-xs font-semibold">{order.contact_phone || <span className="text-muted-foreground font-normal italic">No phone on file</span>}</p>
                <p className="text-xs text-muted-foreground">{order.delivery_address || <span className="italic">No address on file</span>}</p>
                {order.estimated_delivery_date && (
                  <p className="text-xs text-primary font-medium">📅 Delivery: {order.estimated_delivery_date}</p>
                )}
              </div>

              {/* Items */}
              <div className="bg-secondary/40 rounded-xl p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Items</p>
                {order.items?.length > 0 ? order.items.map((item, i) => (
                  <p key={i} className="text-xs">{driverItemLine(item)}</p>
                )) : <p className="text-xs text-muted-foreground italic">No items listed</p>}
                {order.notes && <p className="text-[10px] text-primary mt-2 pt-2 border-t border-border/30">{order.notes}</p>}
              </div>

              {/* Bag Return Form */}
              {pendingReturn && pendingReturn.verification_status === 'requested' && !showReturnForm && (
                <div className="rounded-xl border border-cyan-200 bg-cyan-50 p-3 dark:border-cyan-900/60 dark:bg-cyan-950/30">
                  <div className="flex items-center gap-2 mb-2">
                    <Recycle className="w-4 h-4 text-cyan-700 shrink-0 dark:text-cyan-300" />
                    <p className="text-sm font-bold text-cyan-900 dark:text-cyan-100">Bag Return — Pre-Pickup Review</p>
                  </div>
                  <p className="text-xs text-cyan-800 mb-3 dark:text-cyan-200/80">
                    Customer requested: {pendingReturn.small_bags_requested || 0} small + {pendingReturn.tote_bags_requested || 0} tote bags
                  </p>
                  <button onClick={() => setShowReturnForm(true)} className="w-full py-2 bg-cyan-600 text-white rounded-lg text-xs font-semibold">
                    Confirm Bag Pickup
                  </button>
                </div>
              )}

              {/* Inline Form */}
              {showReturnForm && pendingReturn && (pendingReturn.verification_status === 'requested' || isEditing) && (
                <div className="rounded-xl border border-cyan-200 bg-cyan-50 p-4 space-y-4 dark:border-cyan-900/60 dark:bg-cyan-950/30">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-bold text-cyan-900 dark:text-cyan-100">{isEditing ? 'Re-Verify & Adjust' : 'Confirm Bag Amounts'}</p>
                    <button onClick={() => { setShowReturnForm(false); setIsEditing(false); }} className="text-cyan-700 dark:text-cyan-300">
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {pendingReturn.small_bags_requested > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-cyan-900 mb-2 dark:text-cyan-100">Small Bags ({pendingReturn.small_bags_requested} requested)</p>
                      <div className="flex gap-2 flex-wrap mb-2">
                        {bagStatusOptions.map(([v, l]) => (
                          <button key={v} onClick={() => setSmallStatus(v)}
                            className={`rounded-xl border px-3 py-2 text-[11px] font-medium transition-colors ${smallStatus === v ? 'border-cyan-600 bg-cyan-600 text-white' : 'border-cyan-300 bg-background text-cyan-900 dark:border-cyan-800/70 dark:text-cyan-100'}`}>
                            {l}
                          </button>
                        ))}
                      </div>
                      {smallStatus === 'accepted' && (
                        <div className="flex items-center gap-2 rounded-xl border border-cyan-300 bg-background px-3 py-2 dark:border-cyan-800/70">
                          <button onClick={() => setSmallAccepted(Math.max(0, smallAccepted - 1))} className="text-lg font-bold text-cyan-800 dark:text-cyan-200">−</button>
                          <span className="flex-1 text-center text-sm font-semibold text-cyan-900 dark:text-cyan-100">{smallAccepted} collected</span>
                          <button onClick={() => setSmallAccepted(smallAccepted + 1)} className="text-lg font-bold text-cyan-800 dark:text-cyan-200">+</button>
                        </div>
                      )}
                    </div>
                  )}

                  {pendingReturn.tote_bags_requested > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-cyan-900 mb-2 dark:text-cyan-100">Tote Bags ({pendingReturn.tote_bags_requested} requested)</p>
                      <div className="flex gap-2 flex-wrap mb-2">
                        {bagStatusOptions.map(([v, l]) => (
                          <button key={v} onClick={() => setToteStatus(v)}
                            className={`rounded-xl border px-3 py-2 text-[11px] font-medium transition-colors ${toteStatus === v ? 'border-cyan-600 bg-cyan-600 text-white' : 'border-cyan-300 bg-background text-cyan-900 dark:border-cyan-800/70 dark:text-cyan-100'}`}>
                            {l}
                          </button>
                        ))}
                      </div>
                      {toteStatus === 'accepted' && (
                        <div className="flex items-center gap-2 rounded-xl border border-cyan-300 bg-background px-3 py-2 dark:border-cyan-800/70">
                          <button onClick={() => setToteAccepted(Math.max(0, toteAccepted - 1))} className="text-lg font-bold text-cyan-800 dark:text-cyan-200">−</button>
                          <span className="flex-1 text-center text-sm font-semibold text-cyan-900 dark:text-cyan-100">{toteAccepted} collected</span>
                          <button onClick={() => setToteAccepted(toteAccepted + 1)} className="text-lg font-bold text-cyan-800 dark:text-cyan-200">+</button>
                        </div>
                      )}
                    </div>
                  )}

                  {(smallStatus === 'not_eligible' || toteStatus === 'not_eligible') && (
                    <div>
                      <p className="text-xs font-semibold text-cyan-900 mb-2 dark:text-cyan-100">Rejection Reason</p>
                      <div className="flex gap-2 flex-wrap">
                        {REJECTION_REASONS.map(r => (
                          <button key={r.key} onClick={() => setReason(r.key)}
                            className={`rounded-xl border px-3 py-1.5 text-[11px] transition-colors ${reason === r.key ? 'border-red-300 bg-red-100 text-red-800 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-100' : 'border-cyan-300 bg-background text-cyan-900 dark:border-cyan-800/70 dark:text-cyan-100'}`}>
                            {r.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div>
                    <p className="text-xs font-semibold text-cyan-900 mb-2 dark:text-cyan-100">Photo <span className="font-normal text-cyan-700 dark:text-cyan-300">(optional)</span></p>
                    <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhoto} />
                    {photoUrl ? (
                      <div className="relative inline-block w-full">
                        <img src={photoUrl} alt="Evidence" className="w-full max-w-xs rounded-xl border border-cyan-200 dark:border-cyan-900/60" />
                        <button onClick={() => setPhotoUrl('')} className="absolute top-2 right-2 w-7 h-7 bg-black/50 rounded-full flex items-center justify-center">
                          <X className="w-3.5 h-3.5 text-white" />
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => fileRef.current?.click()} disabled={uploading}
                        className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-cyan-300 bg-background px-4 py-2.5 text-xs text-cyan-900 dark:border-cyan-800/70 dark:text-cyan-100">
                        {uploading ? <div className="w-4 h-4 border-2 border-cyan-600 border-t-transparent rounded-full animate-spin" /> : <Camera className="w-4 h-4" />}
                        {uploading ? 'Uploading...' : 'Take or Upload Photo'}
                      </button>
                    )}
                  </div>

                  <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Driver notes (optional)"
                    className="w-full resize-none rounded-xl border border-cyan-300 bg-background px-3 py-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-cyan-400 dark:border-cyan-800/70" />

                  <div className="flex items-center justify-between rounded-xl border border-cyan-200 bg-background p-3 dark:border-cyan-800/70">
                    <p className="text-sm font-semibold text-cyan-900 dark:text-cyan-100">Estimated Credit</p>
                    <p className="text-lg font-bold text-cyan-800 dark:text-cyan-200">${calcCredit().toFixed(2)}</p>
                  </div>

                  <button onClick={handleSubmit} disabled={saving || uploading}
                    className="w-full py-3 bg-cyan-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50 active:scale-[0.98] transition-transform">
                    {saving ? 'Confirming...' : 'Confirm Bag Pickup'}
                  </button>
                </div>
              )}

              {/* Already verified */}
              {pendingReturn && pendingReturn.verification_status !== 'requested' && !isEditing && (
                <div className="rounded-xl border border-green-200 bg-green-50 p-4 space-y-3 dark:border-green-900/60 dark:bg-green-950/30">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold text-green-800 dark:text-green-100">✓ Return Verified</p>
                      <p className="text-[10px] text-green-700 mt-0.5 dark:text-green-200/80">${(pendingReturn.credit_issued || 0).toFixed(2)} credit issued</p>
                    </div>
                    <button onClick={handleEditMode} className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white text-xs font-semibold rounded-lg active:scale-95 transition-transform">
                      <Edit2 className="w-3 h-3" />
                      Adjust
                    </button>
                  </div>
                  <div className="space-y-1.5 text-[10px] text-green-800 dark:text-green-200/80">
                    <p>Small: {pendingReturn.small_bags_accepted || 0} of {pendingReturn.small_bags_requested || 0}</p>
                    <p>Tote: {pendingReturn.tote_bags_accepted || 0} of {pendingReturn.tote_bags_requested || 0}</p>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
