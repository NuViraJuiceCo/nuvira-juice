import React, { useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Leaf, ArrowDownLeft, ArrowUpRight, X, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { Link } from 'react-router-dom';

const statusLabel = {
  requested: 'Awaiting Verification',
  verified: 'Verified',
  partially_verified: 'Partially Verified',
  not_found: 'Not Found',
  not_eligible: 'Not Eligible',
};

const statusColor = {
  requested: 'text-amber-600 bg-amber-50',
  verified: 'text-primary bg-primary/10',
  partially_verified: 'text-amber-600 bg-amber-50',
  not_found: 'text-muted-foreground bg-secondary',
  not_eligible: 'text-muted-foreground bg-secondary',
};

function bagSummary(r) {
  const parts = [];
  if (r.small_bags_requested > 0) parts.push(`${r.small_bags_requested} Small Bag${r.small_bags_requested > 1 ? 's' : ''}`);
  if (r.tote_bags_requested > 0) parts.push(`${r.tote_bags_requested} Tote${r.tote_bags_requested > 1 ? 's' : ''}`);
  return parts.join(' + ') || '—';
}

function CreditModal({ onClose, balance, earned, used, history, returns, isLoading }) {
  const isReady = !isLoading;
  
  return (
    <>
      {/* Backdrop overlay - only visible when content is ready and dismissible */}
      {isReady && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
          onClick={onClose}
        />
      )}
      
      {/* Modal content - centered bottom sheet */}
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        className={`fixed inset-x-0 bottom-0 z-[60] bg-background rounded-t-3xl max-h-[88vh] flex flex-col shadow-2xl ${!isReady ? 'pointer-events-none' : ''}`}
        onClick={e => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 bg-border rounded-full" />
        </div>

        {/* Header - only show close button when ready */}
        <div className="flex items-center justify-between px-5 py-3 shrink-0">
          <div className="flex items-center gap-2">
            <Leaf className="w-4 h-4 text-primary" />
            <p className="font-heading text-lg font-bold">NuVira Credits</p>
          </div>
          {isReady && (
            <button onClick={onClose} className="w-8 h-8 bg-secondary rounded-full flex items-center justify-center">
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          )}
        </div>

        {/* Scrollable content */}
        <div className="overflow-y-auto flex-1 px-5 pb-8 space-y-4">
          {/* Loading State */}
          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <p className="ml-3 text-sm text-muted-foreground">Loading credits...</p>
            </div>
          )}
          
          {!isLoading && (
            <>
              {/* Balance Card */}
              <div className="bg-primary rounded-2xl p-5 text-primary-foreground">
                <p className="text-[10px] font-bold uppercase tracking-widest text-primary-foreground/60 mb-3">Available Balance</p>
                <p className="font-heading text-5xl font-bold tracking-tight mb-0.5 text-white">${balance.toFixed(2)}</p>
                <p className="text-xs text-primary-foreground/50">Applied automatically at checkout</p>
                <div className="grid grid-cols-2 gap-4 mt-5 pt-4 border-t border-primary-foreground/15">
                  <div>
                    <p className="text-[10px] text-primary-foreground/50 uppercase tracking-wider mb-0.5">Lifetime Earned</p>
                    <p className="text-sm font-semibold">${earned.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-primary-foreground/50 uppercase tracking-wider mb-0.5">Applied</p>
                    <p className="text-sm font-semibold">${used.toFixed(2)}</p>
                  </div>
                </div>
              </div>

              {/* Return Activity */}
              {returns.length > 0 && (
                <div className="bg-card border border-border/50 rounded-2xl overflow-hidden">
                  <div className="px-4 pt-4 pb-3 border-b border-border/40">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Return Activity</p>
                  </div>
                  <div className="divide-y divide-border/30">
                    {returns.slice(0, 5).map((r) => (
                      <div key={r.id} className="px-4 py-3.5 flex items-center justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-foreground">{bagSummary(r)}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {r.created_date ? format(new Date(r.created_date), 'MMM d, yyyy') : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {r.credit_issued > 0 && (
                            <span className="text-xs font-semibold text-primary">+${r.credit_issued.toFixed(2)}</span>
                          )}
                          <span className={`text-[10px] font-semibold px-2.5 py-1 rounded-full ${statusColor[r.verification_status] || 'text-muted-foreground bg-secondary'}`}>
                            {statusLabel[r.verification_status] || r.verification_status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Credit History */}
              {history.length > 0 && (
                <div className="bg-card border border-border/50 rounded-2xl overflow-hidden">
                  <div className="px-4 pt-4 pb-3 border-b border-border/40">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Credit History</p>
                  </div>
                  <div className="divide-y divide-border/30">
                    {history.slice().reverse().slice(0, 8).map((entry, i) => {
                      const isEarned = entry.type === 'earned';
                      return (
                        <div key={i} className="px-4 py-3.5 flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isEarned ? 'bg-primary/10' : 'bg-secondary'}`}>
                            {isEarned
                              ? <ArrowDownLeft className="w-3.5 h-3.5 text-primary" />
                              : <ArrowUpRight className="w-3.5 h-3.5 text-muted-foreground" />
                            }
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium line-clamp-1">{entry.description}</p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                              {entry.timestamp ? format(new Date(entry.timestamp), 'MMM d, yyyy') : ''}
                            </p>
                          </div>
                          <p className={`text-sm font-semibold shrink-0 ${isEarned ? 'text-primary' : 'text-muted-foreground'}`}>
                            {isEarned ? '+' : '−'}${Math.abs(entry.amount).toFixed(2)}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Link to learn more */}
              <Link to="/return-reward">
                <div className="flex items-center justify-between p-4 bg-primary/5 border border-primary/15 rounded-2xl">
                  <div className="flex items-center gap-2">
                    <Leaf className="w-4 h-4 text-primary" />
                    <p className="text-sm font-semibold text-primary">Earn Credits — Return + Reward</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-primary" />
                </div>
              </Link>

              {/* Empty state - always show helpful copy */}
              {returns.length === 0 && history.length === 0 && (
                <div className="text-center py-6">
                  <p className="text-sm font-semibold text-foreground mb-1">No credits yet</p>
                  <p className="text-[11px] text-muted-foreground">
                    Credits from eligible returns, referrals, and rewards will appear here.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </motion.div>
    </>
  );
}

export default function CreditWallet() {
  const { user } = useAuth();
  const [showModal, setShowModal] = useState(false);

  const { data: creditData, isLoading: isLoadingCredits } = useQuery({
    queryKey: ['nuvira-credits', user?.email],
    queryFn: async () => {
      const res = await base44.entities.NuViraCredit.filter({ customer_email: user?.email });
      return res[0] || null;
    },
    enabled: !!user?.email,
  });

  const { data: returns = [], isLoading: isLoadingReturns } = useQuery({
    queryKey: ['bag-returns', user?.email],
    queryFn: () => base44.entities.BagReturn.filter({ customer_email: user?.email }, '-created_date', 10),
    enabled: !!user?.email,
  });

  const balance = creditData?.balance || 0;
  const earned = creditData?.lifetime_issued || 0;
  const used = creditData?.lifetime_used || 0;
  const history = creditData?.history || [];
  const isLoading = isLoadingCredits || isLoadingReturns;

  if (!creditData && returns.length === 0) {
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="px-5 mt-3">
        <button onClick={() => setShowModal(true)} className="w-full text-left">
          <div className="bg-primary rounded-2xl p-5 text-primary-foreground shadow-lg">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Leaf className="w-4 h-4 text-white/70" />
                <p className="text-[10px] font-bold uppercase tracking-widest text-white/70">NuVira Credits</p>
              </div>
              <span className="text-[10px] text-white/60 font-medium">Tap to view →</span>
            </div>
            <p className="font-heading text-5xl font-bold tracking-tight mb-0.5 text-white">$0.00</p>
            <p className="text-xs text-white/65">No credits yet — earn through returns & more</p>
          </div>
        </button>
        {showModal && (
          <CreditModal
            onClose={() => setShowModal(false)}
            balance={0}
            earned={0}
            used={0}
            history={[]}
            returns={[]}
            isLoading={isLoading}
          />
        )}
      </motion.div>
    );
  }

  return (
    <>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="px-5 mt-3">
        <button onClick={() => setShowModal(true)} className="w-full text-left">
          <div className="bg-primary rounded-2xl p-5 text-primary-foreground shadow-lg">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Leaf className="w-4 h-4 text-white/70" />
                <p className="text-[10px] font-bold uppercase tracking-widest text-white/70">NuVira Credits</p>
              </div>
              <span className="text-[10px] text-white/60 font-medium">Tap to view →</span>
            </div>
            <p className="font-heading text-5xl font-bold tracking-tight mb-0.5 text-white">${balance.toFixed(2)}</p>
            <p className="text-xs text-white/65">Available for your next order</p>
            <div className="grid grid-cols-2 gap-4 mt-5 pt-4 border-t border-white/20">
              <div>
                <p className="text-[10px] text-white/65 uppercase tracking-wider mb-0.5">Lifetime Earned</p>
                <p className="text-sm font-semibold text-white">${earned.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-[10px] text-white/65 uppercase tracking-wider mb-0.5">Applied</p>
                <p className="text-sm font-semibold text-white">${used.toFixed(2)}</p>
              </div>
            </div>
          </div>
        </button>
      </motion.div>

      {showModal && (
        <CreditModal
          onClose={() => setShowModal(false)}
          balance={balance}
          earned={earned}
          used={used}
          history={history}
          returns={returns}
          isLoading={isLoading}
        />
      )}
    </>
  );
}