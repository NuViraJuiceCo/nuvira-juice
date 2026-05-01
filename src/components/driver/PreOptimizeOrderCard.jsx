import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronRight, MapPin, Navigation, Recycle, X, Camera, Edit2 } from 'lucide-react';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { useRef } from 'react';

export default function PreOptimizeOrderCard({ order, pendingReturn, onVerifyReturn, user, isUpdating }) {
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
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 flex items-center gap-0.5">
                  <Recycle className="w-2.5 h-2.5" />
                  Return
                </span>
              )}
            </div>
            <p className="text-xs font-semibold truncate leading-tight">{order.delivery_address?.split(',').slice(0, 2).join(',')}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight line-clamp-1">{order.items?.map(i => `${i.title} ×${i.quantity}`).join(', ')}</p>
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
              <div className="space-y-0.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Customer</p>
                <p className="text-xs">{order.customer_email}</p>
                {order.contact_phone && <p className="text-xs font-semibold">{order.contact_phone}</p>}
              </div>

              {/* Items */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Items</p>
                {order.items?.map((item, i) => (
                  <p key={i} className="text-xs">{item.title} × {item.quantity}</p>
                ))}
              </div>

              {/* Bag Return Form */}
              {pendingReturn && pendingReturn.verification_status === 'requested' && !showReturnForm && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Recycle className="w-4 h-4 text-amber-600 shrink-0" />
                    <p className="text-sm font-bold text-amber-800">Bag Return — Pre-Pickup Review</p>
                  </div>
                  <p className="text-xs text-amber-700 mb-3">
                    Customer requested: {pendingReturn.small_bags_requested || 0} small + {pendingReturn.tote_bags_requested || 0} tote bags
                  </p>
                  <button onClick={() => setShowReturnForm(true)} className="w-full py-2 bg-amber-600 text-white rounded-lg text-xs font-semibold">
                    Confirm Bag Pickup
                  </button>
                </div>
              )}

              {/* Inline Form */}
              {showReturnForm && pendingReturn && (pendingReturn.verification_status === 'requested' || isEditing) && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-bold text-amber-800">{isEditing ? 'Re-Verify & Adjust' : 'Confirm Bag Amounts'}</p>
                    <button onClick={() => { setShowReturnForm(false); setIsEditing(false); }} className="text-amber-400">
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {pendingReturn.small_bags_requested > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-amber-800 mb-2">Small Bags ({pendingReturn.small_bags_requested} requested)</p>
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

                  {pendingReturn.tote_bags_requested > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-amber-800 mb-2">Tote Bags ({pendingReturn.tote_bags_requested} requested)</p>
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
                    <p className="text-xs font-semibold text-amber-800 mb-2">Photo <span className="font-normal text-amber-600">(optional)</span></p>
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
                    <p className="text-sm font-semibold text-amber-800">Estimated Credit</p>
                    <p className="text-lg font-bold text-amber-700">${calcCredit().toFixed(2)}</p>
                  </div>

                  <button onClick={handleSubmit} disabled={saving || uploading}
                    className="w-full py-3 bg-amber-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50 active:scale-[0.98] transition-transform">
                    {saving ? 'Confirming...' : 'Confirm Bag Pickup'}
                  </button>
                </div>
              )}

              {/* Already verified */}
              {pendingReturn && pendingReturn.verification_status !== 'requested' && !isEditing && (
                <div className="bg-green-50 border border-green-200 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold text-green-700">✓ Return Verified</p>
                      <p className="text-[10px] text-green-600 mt-0.5">${(pendingReturn.credit_issued || 0).toFixed(2)} credit issued</p>
                    </div>
                    <button onClick={handleEditMode} className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white text-xs font-semibold rounded-lg active:scale-95 transition-transform">
                      <Edit2 className="w-3 h-3" />
                      Adjust
                    </button>
                  </div>
                  <div className="space-y-1.5 text-[10px] text-green-700">
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