import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Leaf, ChevronDown, ChevronRight, Search, Package } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

const STATUS_COLOR = {
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

function bagSummary(r) {
  const parts = [];
  if ((r.small_bags_requested || 0) > 0) parts.push(`${r.small_bags_requested} Small`);
  if ((r.tote_bags_requested || 0) > 0) parts.push(`${r.tote_bags_requested} Tote`);
  return parts.join(' + ') || '—';
}

function ReturnCard({ ret, onVerify, credits, verificationFrozen }) {
  const [expanded, setExpanded] = useState(false);
  const [smallStatus, setSmallStatus] = useState('accepted');
  const [toteStatus, setToteStatus] = useState('accepted');
  const [reason, setReason] = useState('dirty_stained');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const isPending = ret.verification_status === 'requested';

  const calcCredit = () => {
    let c = 0;
    if (ret.small_bags_requested > 0 && smallStatus === 'accepted') c += ret.small_bags_requested;
    if (ret.tote_bags_requested > 0 && toteStatus === 'accepted') c += ret.tote_bags_requested * 2;
    return c;
  };

  const handleSubmit = async () => {
    if (verificationFrozen) {
      toast.error('Bag return verification is disabled during the May 30 launch freeze.');
      return;
    }

    setSaving(true);
    const credit = calcCredit();
    const smallAcc = smallStatus === 'accepted' ? ret.small_bags_requested : 0;
    const toteAcc = toteStatus === 'accepted' ? ret.tote_bags_requested : 0;
    let vStatus = 'verified';
    if (credit === 0) vStatus = (smallStatus === 'not_found' || toteStatus === 'not_found') ? 'not_found' : 'not_eligible';
    else if (smallAcc < ret.small_bags_requested || toteAcc < ret.tote_bags_requested) vStatus = 'partially_verified';

    await onVerify(ret, {
      small_bag_status: smallStatus,
      tote_bag_status: toteStatus,
      small_bags_accepted: smallAcc,
      tote_bags_accepted: toteAcc,
      rejection_reason: (smallStatus === 'not_eligible' || toteStatus === 'not_eligible') ? reason : '',
      driver_notes: notes,
      verification_status: vStatus,
      credit_issued: credit,
    }, credits);
    setSaving(false);
    setExpanded(false);
  };

  return (
    <div className="bg-card border border-border/50 rounded-2xl overflow-hidden">
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center gap-3.5 p-4 text-left">
        <div className="w-9 h-9 bg-muted rounded-full flex items-center justify-center shrink-0">
          <Package className="w-4 h-4 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{ret.customer_email}</p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-[10px] text-muted-foreground">{bagSummary(ret)}</span>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_COLOR[ret.verification_status] || ''}`}>
              {ret.verification_status?.replace(/_/g, ' ')}
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {ret.created_date ? format(new Date(ret.created_date), 'MMM d, yyyy · h:mm a') : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
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
            className="overflow-hidden"
          >
            <div className="p-4 border-t border-border/40 space-y-4">
              {!isPending ? (
                <div className="space-y-2 text-sm text-muted-foreground">
                  <p><span className="text-foreground font-medium">Small bags:</span> {ret.small_bags_accepted || 0} of {ret.small_bags_requested || 0} accepted</p>
                  <p><span className="text-foreground font-medium">Tote bags:</span> {ret.tote_bags_accepted || 0} of {ret.tote_bags_requested || 0} accepted</p>
                  {ret.rejection_reason && <p><span className="text-foreground font-medium">Reason:</span> {ret.rejection_reason}</p>}
                  {ret.driver_notes && <p><span className="text-foreground font-medium">Notes:</span> {ret.driver_notes}</p>}
                  {ret.verified_by && <p className="text-[10px]">Verified by {ret.verified_by}</p>}
                </div>
              ) : (
                <>
                  {ret.small_bags_requested > 0 && (
                    <div>
                      <p className="text-xs font-semibold mb-2">Small Lunch Bag ×{ret.small_bags_requested}</p>
                      <div className="flex gap-2 flex-wrap">
                        {[['accepted', 'Found & Accepted'], ['not_eligible', 'Not Eligible'], ['not_found', 'Not Found']].map(([v, l]) => (
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
                        {[['accepted', 'Found & Accepted'], ['not_eligible', 'Not Eligible'], ['not_found', 'Not Found']].map(([v, l]) => (
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
                    <p className="text-xs font-semibold mb-1.5">Admin Notes</p>
                    <textarea
                      value={notes}
                      onChange={e => setNotes(e.target.value)}
                      rows={2}
                      placeholder="Optional notes..."
                      className="w-full text-xs border border-border rounded-xl px-3 py-2.5 bg-background resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <div className="bg-primary/5 rounded-xl p-3.5 flex items-center justify-between">
                    <p className="text-sm font-medium">Credit to Issue</p>
                    <p className="font-heading text-xl font-bold text-primary">${calcCredit().toFixed(2)}</p>
                  </div>
                  {verificationFrozen && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      Bag return verification, credits, and customer emails are frozen for May 30 launch operations unless explicitly approved.
                    </div>
                  )}
                  <button
                    onClick={handleSubmit}
                    disabled={saving || verificationFrozen}
                    className="w-full py-3 bg-primary text-primary-foreground rounded-xl text-sm font-semibold disabled:opacity-50 active:scale-[0.98] transition-transform"
                  >
                    {saving ? 'Saving...' : verificationFrozen ? 'Verification Frozen' : 'Submit Verification'}
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

export default function BagReturnAdmin() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState('pending');
  const [search, setSearch] = useState('');
  const verificationFrozen = true;

  const { data: returns = [], isLoading } = useQuery({
    queryKey: ['admin-bag-returns'],
    queryFn: () => base44.entities.BagReturn.list('-created_date', 300),
    enabled: user?.role === 'admin',
  });

  const { data: allCredits = [] } = useQuery({
    queryKey: ['admin-all-credits'],
    queryFn: () => base44.entities.NuViraCredit.list('-created_date', 500),
    enabled: user?.role === 'admin',
  });

  const verifyMutation = useMutation({
    mutationFn: async ({ ret, data, credits }) => {
      await base44.entities.BagReturn.update(ret.id, {
        ...data,
        verified_by: user.email,
        verified_at: new Date().toISOString(),
        credit_applied: data.credit_issued > 0,
      });

      if (data.credit_issued > 0) {
        const existing = credits.find(c => c.customer_email === ret.customer_email);
        const entry = {
          amount: data.credit_issued,
          type: 'earned',
          description: `Return + Reward${data.verification_status === 'partially_verified' ? ' (Partial)' : ''}`,
          bag_return_id: ret.id,
          order_id: ret.order_id,
          timestamp: new Date().toISOString(),
        };
        if (existing) {
          await base44.entities.NuViraCredit.update(existing.id, {
            balance: (existing.balance || 0) + data.credit_issued,
            lifetime_issued: (existing.lifetime_issued || 0) + data.credit_issued,
            history: [...(existing.history || []), entry],
          });
        } else {
          await base44.entities.NuViraCredit.create({
            customer_email: ret.customer_email,
            balance: data.credit_issued,
            lifetime_issued: data.credit_issued,
            lifetime_used: 0,
            history: [entry],
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
          body: `Your bag was not eligible for reuse this time. Bags must be clean, odor-free, and free of damage to qualify.`,
        });
      } else if (data.verification_status === 'not_found') {
        await base44.integrations.Core.SendEmail({
          to: ret.customer_email,
          subject: 'Return Not Located',
          body: `We were unable to locate a bag at your delivery address. If you believe this is an error, please contact us.`,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-bag-returns'] });
      queryClient.invalidateQueries({ queryKey: ['admin-all-credits'] });
      toast.success('Verification saved');
    },
    onError: () => toast.error('Verification failed'),
  });

  if (user?.role !== 'admin') return null;

  const filtered = returns.filter(r => {
    const matchFilter = filter === 'pending' ? r.verification_status === 'requested' : r.verification_status !== 'requested';
    const matchSearch = !search.trim() || r.customer_email?.toLowerCase().includes(search.toLowerCase());
    return matchFilter && matchSearch;
  });

  // Analytics
  const verified = returns.filter(r => r.verification_status !== 'requested');
  const totalSmall = verified.reduce((s, r) => s + (r.small_bags_accepted || 0), 0);
  const totalTotes = verified.reduce((s, r) => s + (r.tote_bags_accepted || 0), 0);
  const totalCredits = verified.reduce((s, r) => s + (r.credit_issued || 0), 0);
  const accepted = verified.filter(r => ['verified', 'partially_verified'].includes(r.verification_status)).length;
  const acceptanceRate = verified.length > 0 ? Math.round((accepted / verified.length) * 100) : 0;
  const estimatedSavings = (totalSmall * 0.45) + (totalTotes * 2.50); // Rough packaging cost savings

  const analytics = [
    { label: 'Totes Returned', value: totalTotes },
    { label: 'Small Bags', value: totalSmall },
    { label: 'Credits Issued', value: `$${totalCredits.toFixed(2)}` },
    { label: 'Acceptance Rate', value: `${acceptanceRate}%` },
    { label: 'Est. Savings', value: `$${estimatedSavings.toFixed(2)}` },
    { label: 'Total Returns', value: verified.length },
  ];

  return (
    <div className="min-h-screen bg-background pb-10">
      <div className="bg-primary px-4 pt-10 pb-6">
        <button onClick={() => navigate('/account')} className="w-9 h-9 bg-white/15 rounded-full flex items-center justify-center mb-4">
          <ArrowLeft className="w-4 h-4 text-white" />
        </button>
        <div className="flex items-center gap-2 mb-1">
          <Leaf className="w-5 h-5 text-primary-foreground/70" />
          <h1 className="font-heading text-2xl font-bold text-primary-foreground">Return + Reward</h1>
        </div>
        <p className="text-primary-foreground/60 text-xs">Verify bag returns · Issue NuVira Credits</p>
      </div>

      <div className="px-4 mt-4">
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Bag return verification, credits, and customer emails are frozen for May 30 launch operations. This page remains read-only for review.
        </div>
      </div>

      {/* Analytics */}
      <div className="px-4 mt-5">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">Program Analytics</p>
        <div className="grid grid-cols-3 gap-2">
          {analytics.map(({ label, value }) => (
            <div key={label} className="bg-card border border-border/50 rounded-xl p-3 text-center">
              <p className="font-heading text-lg font-bold text-primary">{value}</p>
              <p className="text-[9px] text-muted-foreground mt-0.5 leading-tight">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Search */}
      <div className="px-4 mt-4">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by email..."
            className="w-full pl-10 h-11 text-sm bg-card border border-border/50 rounded-xl focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 px-4 mt-3 mb-4">
        {[
          { key: 'pending', label: `Pending (${returns.filter(r => r.verification_status === 'requested').length})` },
          { key: 'verified', label: 'Verified' },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition-colors ${filter === tab.key ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="px-4 space-y-2">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <Leaf className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No {filter} returns</p>
          </div>
        ) : (
          filtered.map(ret => (
            <ReturnCard
              key={ret.id}
              ret={ret}
              credits={allCredits}
              verificationFrozen={verificationFrozen}
              onVerify={(ret, data, credits) => verifyMutation.mutateAsync({ ret, data, credits: allCredits })}
            />
          ))
        )}
      </div>
    </div>
  );
}
