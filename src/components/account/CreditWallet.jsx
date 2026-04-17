import React from 'react';
import { useAuth } from '@/lib/AuthContext';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Leaf, TrendingUp, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
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

export default function CreditWallet() {
  const { user } = useAuth();

  const { data: creditData } = useQuery({
    queryKey: ['nuvira-credits', user?.email],
    queryFn: async () => {
      const res = await base44.entities.NuViraCredit.filter({ customer_email: user?.email });
      return res[0] || null;
    },
    enabled: !!user?.email,
  });

  const { data: returns = [] } = useQuery({
    queryKey: ['bag-returns', user?.email],
    queryFn: () => base44.entities.BagReturn.filter({ customer_email: user?.email }, '-created_date', 10),
    enabled: !!user?.email,
  });

  if (!creditData && returns.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mx-4 mt-4"
      >
        <Link to="/return-reward">
          <div className="bg-primary/5 border border-primary/15 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <Leaf className="w-4 h-4 text-primary" />
              <p className="text-xs font-semibold uppercase tracking-wider text-primary">Return + Reward</p>
            </div>
            <p className="font-heading text-base font-bold leading-snug mb-1">Earn NuVira Credits</p>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Leave your NuVira bag at your door on your next delivery to earn credit toward future orders.
            </p>
            <p className="text-[10px] text-primary font-semibold mt-3">Sustainability, The NuVira Way →</p>
          </div>
        </Link>
      </motion.div>
    );
  }

  const balance = creditData?.balance || 0;
  const earned = creditData?.lifetime_earned || 0;
  const used = creditData?.lifetime_used || 0;
  const history = creditData?.history || [];

  return (
    <div className="mx-4 mt-4 space-y-3">
      {/* Balance Card */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-primary rounded-2xl p-5 text-primary-foreground"
      >
        <div className="flex items-center gap-2 mb-4">
          <Leaf className="w-4 h-4 text-primary-foreground/60" />
          <p className="text-[10px] font-bold uppercase tracking-widest text-primary-foreground/60">NuVira Credits</p>
        </div>
        <p className="font-heading text-5xl font-bold tracking-tight mb-0.5">${balance.toFixed(2)}</p>
        <p className="text-xs text-primary-foreground/50">Available for your next order</p>
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
      </motion.div>

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
    </div>
  );
}