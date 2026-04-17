import React, { useState, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Leaf, ChevronDown, ChevronRight, Camera, CheckCircle2, XCircle,
  Upload, X, Package
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

const REJECTION_REASONS = [
  { key: 'dirty_stained', label: 'Dirty / Stained' },
  { key: 'odor', label: 'Odor' },
  { key: 'damaged', label: 'Damaged' },
  { key: 'other', label: 'Other' },
];

const VERIFICATION_STATUS_COLOR = {
  requested: 'bg-amber-100 text-amber-700',
  verified: 'bg-green-100 text-green-700',
  partially_verified: 'bg-amber-100 text-amber-700',
  not_found: 'bg-secondary text-muted-foreground',
  not_eligible: 'bg-red-100 text-red-700',
};

function DriverReturnCard({ ret, onVerify, allCredits }) {
  const { user } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const [smallStatus, setSmallStatus] = useState('accepted');
  const [toteStatus, setToteStatus] = useState('accepted');
  const [rejectionReason, setRejectionReason] = useState('dirty_stained');
  const [driverNotes, setDriverNotes] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef(null);

  const isPending = ret.verification_status === 'requested';

  const calcCredit = () => {
    let c = 0;
    if (ret.small_bags_requested > 0 && smallStatus === 'accepted') c += ret.small_bags_requested * 1;
    if (ret.tote_bags_requested > 0 && toteStatus === 'accepted') c += ret.tote_bags_requested * 2;
    return c;
  };

  const handlePhotoCapture = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setPhotoUrl(file_url);
      toast.success('Photo uploaded');
    } catch {
      toast.error('Failed to upload photo');
    }
    setUploading(false);
  };

  const handleSubmit = async () => {
    setSaving(true);
    const credit = calcCredit();
    const smallAcc = smallStatus === 'accepted' ? ret.small_bags_requested : 0;
    const toteAcc = toteStatus === 'accepted' ? ret.tote_bags_requested : 0;

    let vStatus = 'verified';
    if (credit === 0) vStatus = smallStatus === 'not_found' || toteStatus === 'not_found' ? 'not_found' : 'not_eligible';
    else if (smallAcc < ret.small_bags_requested || toteAcc < ret.tote_bags_requested) vStatus = 'partially_verified';

    await onVerify(ret, {
      small_bag_status: smallStatus,
      tote_bag_status: toteStatus,
      small_bags_accepted: smallAcc,
      tote_bags_accepted: toteAcc,
      rejection_reason: (smallStatus !== 'accepted' || toteStatus !== 'accepted') ? rejectionReason : '',
      driver_notes: driverNotes,
      photo_url: photoUrl || '',
      verification_status: vStatus,
      credit_issued: credit,
      verified_by: user?.email,
      verified_at: new Date().toISOString(),
      credit_applied: credit > 0,
    }, allCredits);
    setSaving(false);
    setExpanded(false);
  };

  return (
    <div className="bg-card border border-border/50 rounded-2xl overflow-hidden shadow-sm">
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center gap-3 p-4 text-left active:bg-secondary/50 transition-colors">
        <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center shrink-0">
          <Package className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold truncate">{ret.customer_email}</p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {ret.small_bags_requested > 0 && (
              <span className="text-[10px] bg-secondary px-2 py-0.5 rounded-full">{ret.small_bags_requested} Small Bag{ret.small_bags_requested > 1 ? 's' : ''}</span>
            )}
            {ret.tote_bags_requested > 0 && (
              <span className="text-[10px] bg-secondary px-2 py-0.5 rounded-full">{ret.tote_bags_requested} Tote{ret.tote_bags_requested > 1 ? 's' : ''}</span>
            )}
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${VERIFICATION_STATUS_COLOR[ret.verification_status] || ''}`}>
              {ret.verification_status?.replace(/_/g, ' ')}
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {ret.created_date ? format(new Date(ret.created_date), 'MMM d · h:mm a') : ''}
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {ret.credit_issued > 0 && <span className="text-xs font-semibold text-primary">+${ret.credit_issued.toFixed(2)}</span>}
          {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-border/40"
          >
            <div className="p-4 space-y-4">
              {!isPending ? (
                // Read-only view for already-verified returns
                <div className="space-y-2 text-sm">
                  <p><span className="text-muted-foreground">Small bags:</span> {ret.small_bags_accepted || 0} / {ret.small_bags_requested || 0} accepted</p>
                  <p><span className="text-muted-foreground">Tote bags:</span> {ret.tote_bags_accepted || 0} / {ret.tote_bags_requested || 0} accepted</p>
                  {ret.rejection_reason && <p><span className="text-muted-foreground">Reason:</span> {ret.rejection_reason}</p>}
                  {ret.driver_notes && <p><span className="text-muted-foreground">Notes:</span> {ret.driver_notes}</p>}
                  {ret.photo_url && (
                    <div>
                      <p className="text-muted-foreground text-xs mb-1">Photo</p>
                      <img src={ret.photo_url} alt="Return photo" className="w-full max-w-xs rounded-xl border border-border object-cover" />
                    </div>
                  )}
                  {ret.verified_by && <p className="text-xs text-muted-foreground">Verified by {ret.verified_by}</p>}
                </div>
              ) : (
                <>
                  {/* Bag Status */}
                  {ret.small_bags_requested > 0 && (
                    <div>
                      <p className="text-xs font-semibold mb-2">Small Lunch Bag ×{ret.small_bags_requested}</p>
                      <div className="flex gap-2 flex-wrap">
                        {[
                          { key: 'accepted', label: '✓ Accepted' },
                          { key: 'not_eligible', label: '✗ Not Eligible' },
                          { key: 'not_found', label: '? Not Found' },
                        ].map(s => (
                          <button
                            key={s.key}
                            onClick={() => setSmallStatus(s.key)}
                            className={`text-[11px] font-medium px-3 py-1.5 rounded-full border transition-colors ${
                              smallStatus === s.key ? 'bg-primary text-primary-foreground border-primary' : 'border-border bg-card'
                            }`}
                          >
                            {s.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {ret.tote_bags_requested > 0 && (
                    <div>
                      <p className="text-xs font-semibold mb-2">Tote Bag ×{ret.tote_bags_requested}</p>
                      <div className="flex gap-2 flex-wrap">
                        {[
                          { key: 'accepted', label: '✓ Accepted' },
                          { key: 'not_eligible', label: '✗ Not Eligible' },
                          { key: 'not_found', label: '? Not Found' },
                        ].map(s => (
                          <button
                            key={s.key}
                            onClick={() => setToteStatus(s.key)}
                            className={`text-[11px] font-medium px-3 py-1.5 rounded-full border transition-colors ${
                              toteStatus === s.key ? 'bg-primary text-primary-foreground border-primary' : 'border-border bg-card'
                            }`}
                          >
                            {s.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Rejection reason */}
                  {(smallStatus === 'not_eligible' || toteStatus === 'not_eligible') && (
                    <div>
                      <p className="text-xs font-semibold mb-2">Reason Not Eligible</p>
                      <div className="flex gap-2 flex-wrap">
                        {REJECTION_REASONS.map(r => (
                          <button
                            key={r.key}
                            onClick={() => setRejectionReason(r.key)}
                            className={`text-[10px] px-3 py-1.5 rounded-full border ${rejectionReason === r.key ? 'bg-destructive/10 border-destructive/30 text-destructive' : 'border-border bg-card'}`}
                          >
                            {r.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Photo Upload */}
                  <div>
                    <p className="text-xs font-semibold mb-2">Photo Evidence <span className="text-muted-foreground font-normal">(recommended)</span></p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={handlePhotoCapture}
                    />
                    {photoUrl ? (
                      <div className="relative inline-block">
                        <img src={photoUrl} alt="Return evidence" className="w-full max-w-xs rounded-xl border border-border object-cover" />
                        <button
                          onClick={() => setPhotoUrl('')}
                          className="absolute top-2 right-2 w-7 h-7 bg-black/60 rounded-full flex items-center justify-center"
                        >
                          <X className="w-3.5 h-3.5 text-white" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading}
                        className="flex items-center gap-2 px-4 py-3 border-2 border-dashed border-border rounded-xl text-sm text-muted-foreground active:bg-secondary/50 transition-colors w-full justify-center"
                      >
                        {uploading ? (
                          <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <Camera className="w-4 h-4" />
                        )}
                        {uploading ? 'Uploading...' : 'Take / Upload Photo'}
                      </button>
                    )}
                  </div>

                  {/* Driver Notes */}
                  <div>
                    <p className="text-xs font-semibold mb-1.5">Notes (optional)</p>
                    <textarea
                      value={driverNotes}
                      onChange={e => setDriverNotes(e.target.value)}
                      rows={2}
                      placeholder="Any notes about this pickup..."
                      className="w-full text-xs border border-border rounded-xl px-3 py-2 bg-background resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>

                  {/* Credit Summary */}
                  <div className="bg-primary/5 border border-primary/20 rounded-xl p-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Leaf className="w-4 h-4 text-primary" />
                      <p className="text-sm font-semibold">Credit to Issue</p>
                    </div>
                    <p className="text-xl font-heading font-bold text-primary">${calcCredit().toFixed(2)}</p>
                  </div>

                  <button
                    onClick={handleSubmit}
                    disabled={saving || uploading}
                    className="w-full py-3.5 bg-primary text-primary-foreground rounded-xl text-sm font-semibold disabled:opacity-50 active:scale-95 transition-transform"
                  >
                    {saving ? 'Submitting...' : 'Confirm Pickup & Submit'}
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

export default function DriverReturns() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState('pending');

  const isAuthorized = user?.role === 'driver' || user?.role === 'admin';

  const { data: returns = [], isLoading } = useQuery({
    queryKey: ['driver-bag-returns'],
    queryFn: () => base44.entities.BagReturn.list('-created_date', 200),
    enabled: isAuthorized,
    refetchInterval: 30000, // auto-refresh every 30s
  });

  const { data: allCredits = [] } = useQuery({
    queryKey: ['driver-all-credits'],
    queryFn: () => base44.entities.NuViraCredit.list('-created_date', 500),
    enabled: isAuthorized,
  });

  const verifyMutation = useMutation({
    mutationFn: async ({ ret, data, credits }) => {
      await base44.entities.BagReturn.update(ret.id, data);

      if (data.credit_issued > 0) {
        const existing = credits.find(c => c.customer_email === ret.customer_email);
        const historyEntry = {
          amount: data.credit_issued,
          type: 'earned',
          description: `Return + Reward — ${data.verification_status === 'partially_verified' ? 'Partial Return' : 'Bag Return'}`,
          bag_return_id: ret.id,
          order_id: ret.order_id,
          timestamp: new Date().toISOString(),
        };
        if (existing) {
          await base44.entities.NuViraCredit.update(existing.id, {
            balance: (existing.balance || 0) + data.credit_issued,
            lifetime_earned: (existing.lifetime_earned || 0) + data.credit_issued,
            history: [...(existing.history || []), historyEntry],
          });
        } else {
          await base44.entities.NuViraCredit.create({
            customer_email: ret.customer_email,
            balance: data.credit_issued,
            lifetime_earned: data.credit_issued,
            lifetime_used: 0,
            history: [historyEntry],
          });
        }
        await base44.integrations.Core.SendEmail({
          to: ret.customer_email,
          subject: 'Return Verified — Your NuVira Credit Is Ready 🌿',
          body: `Hi! Your NuVira bag return has been confirmed and $${data.credit_issued.toFixed(2)} has been added to your credit wallet.\n\nSustainability, The NuVira Way.`,
        });
      } else if (data.verification_status === 'not_eligible') {
        await base44.integrations.Core.SendEmail({
          to: ret.customer_email,
          subject: 'Return Not Eligible',
          body: `Your bag was not eligible for reuse this time. Please ensure bags are clean, odor-free, and undamaged.`,
        });
      } else if (data.verification_status === 'not_found') {
        await base44.integrations.Core.SendEmail({
          to: ret.customer_email,
          subject: 'Return Not Found',
          body: `We did not find a bag at your delivery location. If you believe this is an error, please contact us.`,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['driver-bag-returns'] });
      queryClient.invalidateQueries({ queryKey: ['driver-all-credits'] });
      toast.success('Verification submitted!');
    },
    onError: () => toast.error('Failed to submit verification'),
  });

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background px-6 text-center">
        <Leaf className="w-10 h-10 text-primary mb-3" />
        <h1 className="font-heading text-xl font-bold mb-2">Driver Login Required</h1>
        <p className="text-sm text-muted-foreground mb-5">Please sign in with your driver account to continue.</p>
        <button
          onClick={() => base44.auth.redirectToLogin('/driver/returns')}
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
        <XCircle className="w-10 h-10 text-destructive mb-3" />
        <h1 className="font-heading text-xl font-bold mb-2">Access Denied</h1>
        <p className="text-sm text-muted-foreground">This page is for NuVira drivers only.</p>
      </div>
    );
  }

  const pendingReturns = returns.filter(r => r.verification_status === 'requested');
  const completedReturns = returns.filter(r => r.verification_status !== 'requested');
  const filtered = filter === 'pending' ? pendingReturns : completedReturns;

  return (
    <div className="min-h-screen bg-background pb-10">
      {/* Header */}
      <div className="bg-primary px-4 pb-5" style={{ paddingTop: 'max(2.5rem, env(safe-area-inset-top))' }}>
        <div className="flex items-center gap-2 mb-1">
          <Leaf className="w-5 h-5 text-primary-foreground/80" />
          <h1 className="font-heading text-2xl font-bold text-primary-foreground">Driver Portal</h1>
        </div>
        <p className="text-primary-foreground/70 text-xs">Return + Reward · Bag Pickup Verification</p>
        <p className="text-primary-foreground/60 text-[11px] mt-1">
          Hi {user.first_name || user.email} · {pendingReturns.length} pending
        </p>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-3 divide-x divide-border border-b border-border bg-card">
        {[
          { label: 'Pending', value: pendingReturns.length, color: 'text-amber-600' },
          { label: 'Verified Today', value: completedReturns.filter(r => r.verified_at?.startsWith(new Date().toISOString().slice(0, 10))).length, color: 'text-primary' },
          { label: 'Total Done', value: completedReturns.length, color: 'text-foreground' },
        ].map(stat => (
          <div key={stat.label} className="py-3 text-center">
            <p className={`text-lg font-bold font-heading ${stat.color}`}>{stat.value}</p>
            <p className="text-[10px] text-muted-foreground">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 px-4 mt-4 mb-3">
        {[
          { key: 'pending', label: `Pending (${pendingReturns.length})` },
          { key: 'done', label: `Done (${completedReturns.length})` },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors ${filter === tab.key ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="px-4 space-y-3">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <CheckCircle2 className="w-10 h-10 text-primary mx-auto mb-3" />
            <p className="text-sm font-semibold">
              {filter === 'pending' ? 'All caught up! 🎉' : 'No completed returns yet'}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {filter === 'pending' ? 'No pending bag returns right now.' : 'Verified returns will appear here.'}
            </p>
          </div>
        ) : (
          filtered.map(ret => (
            <DriverReturnCard
              key={ret.id}
              ret={ret}
              allCredits={allCredits}
              onVerify={(ret, data, credits) => verifyMutation.mutateAsync({ ret, data, credits: allCredits })}
            />
          ))
        )}
      </div>
    </div>
  );
}