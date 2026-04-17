import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Leaf, ChevronDown, ChevronRight, CheckCircle2, XCircle, Search } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

const VERIFICATION_STATUS_COLOR = {
  requested: 'bg-amber-100 text-amber-700',
  verified: 'bg-green-100 text-green-700',
  partially_verified: 'bg-amber-100 text-amber-700',
  not_found: 'bg-secondary text-muted-foreground',
  not_eligible: 'bg-red-100 text-red-700',
};

const REJECTION_REASONS = [
  { key: 'dirty_stained', label: 'Dirty / Stained' },
  { key: 'odor', label: 'Odor' },
  { key: 'damaged', label: 'Damaged' },
  { key: 'other', label: 'Other' },
];

function ReturnCard({ ret, onVerify }) {
  const [expanded, setExpanded] = useState(false);
  const [smallStatus, setSmallStatus] = useState('accepted');
  const [toteStatus, setToteStatus] = useState('accepted');
  const [rejectionReason, setRejectionReason] = useState('dirty_stained');
  const [driverNotes, setDriverNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const hasBags = ret.small_bags_requested > 0 || ret.tote_bags_requested > 0;
  const isPending = ret.verification_status === 'requested';

  const calcCredit = () => {
    let c = 0;
    if (ret.small_bags_requested > 0 && smallStatus === 'accepted') c += ret.small_bags_requested * 1;
    if (ret.tote_bags_requested > 0 && toteStatus === 'accepted') c += ret.tote_bags_requested * 2;
    return c;
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
      verification_status: vStatus,
      credit_issued: credit,
    });
    setSaving(false);
    setExpanded(false);
  };

  return (
    <div className="bg-card border border-border/50 rounded-2xl overflow-hidden">
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center gap-3 p-4 text-left">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <p className="text-sm font-bold truncate">{ret.customer_email}</p>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${VERIFICATION_STATUS_COLOR[ret.verification_status] || ''}`}>
              {ret.verification_status?.replace('_', ' ')}
            </span>
          </div>
          <div className="flex gap-2">
            {ret.small_bags_requested > 0 && (
              <span className="text-[10px] bg-secondary px-2 py-0.5 rounded-full">{ret.small_bags_requested} Small</span>
            )}
            {ret.tote_bags_requested > 0 && (
              <span className="text-[10px] bg-secondary px-2 py-0.5 rounded-full">{ret.tote_bags_requested} Tote</span>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {ret.created_date ? format(new Date(ret.created_date), 'MMM d, yyyy · h:mm a') : ''}
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
                <div className="space-y-2 text-sm">
                  <p><span className="text-muted-foreground">Small bags:</span> {ret.small_bags_accepted || 0} accepted / {ret.small_bags_requested || 0} requested</p>
                  <p><span className="text-muted-foreground">Tote bags:</span> {ret.tote_bags_accepted || 0} accepted / {ret.tote_bags_requested || 0} requested</p>
                  {ret.rejection_reason && <p><span className="text-muted-foreground">Reason:</span> {ret.rejection_reason}</p>}
                  {ret.driver_notes && <p><span className="text-muted-foreground">Notes:</span> {ret.driver_notes}</p>}
                  {ret.verified_by && <p className="text-xs text-muted-foreground">Verified by {ret.verified_by}</p>}
                </div>
              ) : (
                <>
                  {ret.small_bags_requested > 0 && (
                    <div>
                      <p className="text-xs font-semibold mb-2">Small Lunch Bag ({ret.small_bags_requested})</p>
                      <div className="flex gap-2">
                        {['accepted', 'not_eligible', 'not_found'].map(s => (
                          <button
                            key={s}
                            onClick={() => setSmallStatus(s)}
                            className={`text-[10px] font-medium px-3 py-1.5 rounded-full border transition-colors ${
                              smallStatus === s ? 'bg-primary text-primary-foreground border-primary' : 'border-border bg-card'
                            }`}
                          >
                            {s === 'accepted' ? 'Found & Accepted' : s === 'not_eligible' ? 'Not Eligible' : 'Not Found'}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {ret.tote_bags_requested > 0 && (
                    <div>
                      <p className="text-xs font-semibold mb-2">Tote Bag ({ret.tote_bags_requested})</p>
                      <div className="flex gap-2 flex-wrap">
                        {['accepted', 'not_eligible', 'not_found'].map(s => (
                          <button
                            key={s}
                            onClick={() => setToteStatus(s)}
                            className={`text-[10px] font-medium px-3 py-1.5 rounded-full border transition-colors ${
                              toteStatus === s ? 'bg-primary text-primary-foreground border-primary' : 'border-border bg-card'
                            }`}
                          >
                            {s === 'accepted' ? 'Found & Accepted' : s === 'not_eligible' ? 'Not Eligible' : 'Not Found'}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {(smallStatus === 'not_eligible' || toteStatus === 'not_eligible') && (
                    <div>
                      <p className="text-xs font-semibold mb-2">Reason Not Eligible</p>
                      <div className="flex gap-2 flex-wrap">
                        {REJECTION_REASONS.map(r => (
                          <button
                            key={r.key}
                            onClick={() => setRejectionReason(r.key)}
                            className={`text-[10px] px-3 py-1.5 rounded-full border ${rejectionReason === r.key ? 'bg-destructive/10 border-destructive/30 text-destructive' : 'border-border'}`}
                          >
                            {r.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div>
                    <p className="text-xs font-semibold mb-1.5">Driver Notes (optional)</p>
                    <textarea
                      value={driverNotes}
                      onChange={e => setDriverNotes(e.target.value)}
                      rows={2}
                      placeholder="Any notes about this return..."
                      className="w-full text-xs border border-border rounded-xl px-3 py-2 bg-background resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>

                  <div className="bg-primary/5 rounded-xl p-3 flex items-center justify-between">
                    <p className="text-sm font-semibold">Credit to Issue</p>
                    <p className="text-lg font-heading font-bold text-primary">${calcCredit().toFixed(2)}</p>
                  </div>

                  <button
                    onClick={handleSubmit}
                    disabled={saving}
                    className="w-full py-3 bg-primary text-primary-foreground rounded-xl text-sm font-semibold disabled:opacity-50 active:scale-95 transition-transform"
                  >
                    {saving ? 'Saving...' : 'Submit Verification'}
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

  const { data: returns = [], isLoading } = useQuery({
    queryKey: ['admin-bag-returns'],
    queryFn: () => base44.entities.BagReturn.list('-created_date', 200),
    enabled: user?.role === 'admin',
  });

  const { data: credits = [] } = useQuery({
    queryKey: ['admin-all-credits'],
    queryFn: () => base44.entities.NuViraCredit.list('-created_date', 200),
    enabled: user?.role === 'admin',
  });

  const verifyMutation = useMutation({
    mutationFn: async ({ ret, data }) => {
      // Update the return record
      await base44.entities.BagReturn.update(ret.id, {
        ...data,
        verified_by: user.email,
        verified_at: new Date().toISOString(),
        credit_applied: data.credit_issued > 0,
      });

      // If credit to issue, update or create NuViraCredit wallet
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
        // Send notification
        await base44.integrations.Core.SendEmail({
          to: ret.customer_email,
          subject: 'Return Verified — Your NuVira Credit Is Ready',
          body: `Your NuVira return has been processed and $${data.credit_issued.toFixed(2)} has been added to your account.\n\nSustainability, The NuVira Way.`,
        });
      } else if (data.verification_status === 'not_eligible') {
        await base44.integrations.Core.SendEmail({
          to: ret.customer_email,
          subject: 'Return Not Eligible',
          body: `Your bag was not eligible for reuse this time. Please ensure bags are clean, odor-free, and in reusable condition.`,
        });
      } else if (data.verification_status === 'not_found') {
        await base44.integrations.Core.SendEmail({
          to: ret.customer_email,
          subject: 'Return Not Found',
          body: `We did not locate a bag at your delivery location. If you believe this is an error, please contact us.`,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-bag-returns'] });
      queryClient.invalidateQueries({ queryKey: ['admin-all-credits'] });
      toast.success('Return verified');
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
  const allVerified = returns.filter(r => r.verification_status !== 'requested');
  const totalSmall = allVerified.reduce((s, r) => s + (r.small_bags_accepted || 0), 0);
  const totalTotes = allVerified.reduce((s, r) => s + (r.tote_bags_accepted || 0), 0);
  const totalCredits = allVerified.reduce((s, r) => s + (r.credit_issued || 0), 0);
  const accepted = allVerified.filter(r => r.verification_status === 'verified' || r.verification_status === 'partially_verified').length;
  const acceptanceRate = allVerified.length > 0 ? Math.round((accepted / allVerified.length) * 100) : 0;

  return (
    <div className="min-h-screen bg-background pb-10">
      <div className="bg-primary px-4 pt-10 pb-5">
        <button onClick={() => navigate('/account')} className="w-9 h-9 bg-white/20 rounded-full flex items-center justify-center mb-3">
          <ArrowLeft className="w-4 h-4 text-white" />
        </button>
        <div className="flex items-center gap-2 mb-1">
          <Leaf className="w-5 h-5 text-primary-foreground/80" />
          <h1 className="font-heading text-2xl font-bold text-primary-foreground">Return + Reward</h1>
        </div>
        <p className="text-primary-foreground/70 text-xs">Verify customer bag returns</p>
      </div>

      {/* Analytics */}
      <div className="px-4 mt-4 grid grid-cols-2 gap-3 mb-4">
        {[
          { label: 'Totes Returned', value: totalTotes },
          { label: 'Small Bags', value: totalSmall },
          { label: 'Credits Issued', value: `$${totalCredits.toFixed(2)}` },
          { label: 'Acceptance Rate', value: `${acceptanceRate}%` },
        ].map(stat => (
          <div key={stat.label} className="bg-card border border-border/50 rounded-xl p-3">
            <p className="text-xs text-muted-foreground">{stat.label}</p>
            <p className="font-heading text-xl font-bold text-primary">{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="px-4 mb-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by email..."
            className="w-full pl-9 h-10 text-sm bg-secondary/60 border-0 rounded-xl focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 px-4 mb-4">
        {[{ key: 'pending', label: `Pending (${returns.filter(r => r.verification_status === 'requested').length})` }, { key: 'verified', label: 'Verified' }].map(tab => (
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
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <Leaf className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No {filter} returns</p>
          </div>
        ) : (
          filtered.map(ret => (
            <ReturnCard
              key={ret.id}
              ret={ret}
              onVerify={(ret, data) => verifyMutation.mutateAsync({ ret, data })}
            />
          ))
        )}
      </div>
    </div>
  );
}