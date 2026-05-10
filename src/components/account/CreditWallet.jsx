import React, { useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Leaf, ChevronRight } from 'lucide-react';
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

// dashData prop: if passed from parent (Account page), skip own fetch to avoid race condition
export default function CreditWallet({ dashData: propDashData }) {
  const { user } = useAuth();
  const [isExpanded, setIsExpanded] = useState(false);

  // Only fetch independently if dashData not passed from parent
  const { data: ownDashData, isLoading: isLoadingOwn } = useQuery({
    queryKey: ['account-dashboard', user?.email],
    queryFn: async () => {
      const res = await base44.functions.invoke('getCustomerAccountDashboardData', {});
      return res.data || {};
    },
    enabled: !!user?.email && !propDashData,
    staleTime: 60 * 1000,
  });

  const dashData = propDashData || ownDashData;
  const isLoadingCredits = !propDashData && isLoadingOwn;
  const creditData = dashData?.credit_record || null;

  // Fetch bag returns — use resolved identities from dashboard data
  const { data: returns = [], isLoading: isLoadingReturns } = useQuery({
    queryKey: ['bag-returns', user?.email],
    queryFn: async () => {
      const identities = dashData?.resolved_identity_emails || [user?.email];
      const allReturns = [];
      for (const email of identities) {
        const res = await base44.entities.BagReturn.filter({ customer_email: email }, '-created_date', 10);
        allReturns.push(...res);
      }
      const seen = new Set();
      return allReturns.filter(r => seen.has(r.id) ? false : seen.add(r.id))
        .sort((a, b) => new Date(b.created_date) - new Date(a.created_date))
        .slice(0, 10);
    },
    enabled: !!user?.email && !!dashData,
  });

  const balance = creditData?.balance || 0;
  const earned = creditData?.lifetime_issued || 0;
  const used = creditData?.lifetime_used || 0;
  const history = creditData?.history || [];
  const isLoading = isLoadingCredits || isLoadingReturns;

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="px-5 mt-3">
      {/* Main Credits Card - Always Visible */}
      <button onClick={() => setIsExpanded(!isExpanded)} className="w-full text-left">
        <div className="bg-primary rounded-2xl p-5 text-primary-foreground shadow-lg">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Leaf className="w-4 h-4 text-white/70" />
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/70">NuVira Credits</p>
            </div>
            <span className="text-[10px] text-white/60 font-medium">
              {isExpanded ? 'Close ↑' : 'Tap to view →'}
            </span>
          </div>
          <p className="font-heading text-5xl font-bold tracking-tight mb-0.5 text-white">${balance.toFixed(2)}</p>
          <p className="text-xs text-white/65">
            {isExpanded ? 'Tap above to close' : 'Available for your next order'}
          </p>
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

      {/* Inline Expanded Content - No Overlay/Blur */}
      {isExpanded && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="mt-3 bg-card border border-border/50 rounded-2xl overflow-hidden"
        >
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <p className="ml-3 text-sm text-muted-foreground">Loading credits...</p>
            </div>
          ) : (
            <div className="p-5 space-y-4">
              {/* Return Activity */}
              {returns.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-foreground/55 mb-3">Return Activity</p>
                  <div className="space-y-2">
                    {returns.slice(0, 5).map((r) => (
                      <div key={r.id} className="flex items-center justify-between gap-3 py-2 border-b border-border/30 last:border-0">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-foreground">{bagSummary(r)}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {r.created_date ? format(new Date(r.created_date), 'MMM d, yyyy') : ''}
                          </p>
                        </div>
                        {r.credit_issued > 0 && (
                          <span className="text-xs font-semibold text-primary">+${r.credit_issued.toFixed(2)}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Credit History */}
              {history.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-foreground/55 mb-3">Credit History</p>
                  <div className="space-y-2">
                    {history.slice().reverse().slice(0, 8).map((entry, i) => {
                      const isEarned = entry.type === 'earned';
                      return (
                        <div key={i} className="flex items-center justify-between gap-3 py-2 border-b border-border/30 last:border-0">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-foreground">{entry.description}</p>
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

              {/* Empty state */}
              {returns.length === 0 && history.length === 0 && (
                <div className="text-center py-6">
                  <p className="text-sm font-semibold text-foreground mb-1">No credits yet</p>
                  <p className="text-[11px] text-muted-foreground">
                    Credits from eligible returns, referrals, and rewards will appear here.
                  </p>
                </div>
              )}
            </div>
          )}
        </motion.div>
      )}
    </motion.div>
  );
}