import React from 'react';
import { useAuth } from '@/lib/AuthContext';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Leaf, ArrowDownLeft, ArrowUpRight, Clock } from 'lucide-react';
import { format } from 'date-fns';

function HistoryItem({ entry }) {
  const isEarned = entry.type === 'earned';
  return (
    <div className="flex items-center gap-3 py-3 border-b border-border/30 last:border-0">
      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isEarned ? 'bg-primary/10' : 'bg-secondary'}`}>
        {isEarned ? (
          <ArrowDownLeft className="w-3.5 h-3.5 text-primary" />
        ) : (
          <ArrowUpRight className="w-3.5 h-3.5 text-muted-foreground" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium line-clamp-1">{entry.description}</p>
        <p className="text-[10px] text-muted-foreground">
          {entry.timestamp ? format(new Date(entry.timestamp), 'MMM d, yyyy') : ''}
        </p>
      </div>
      <p className={`text-sm font-semibold shrink-0 ${isEarned ? 'text-primary' : 'text-muted-foreground'}`}>
        {isEarned ? '+' : '-'}${Math.abs(entry.amount).toFixed(2)}
      </p>
    </div>
  );
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
    queryFn: () => base44.entities.BagReturn.filter({ customer_email: user?.email }, '-created_date', 20),
    enabled: !!user?.email,
  });

  if (!creditData && returns.length === 0) {
    return (
      <div className="mx-4 mt-4 bg-primary/5 border border-primary/15 rounded-2xl p-5 text-center">
        <Leaf className="w-8 h-8 text-primary mx-auto mb-2" />
        <p className="font-heading text-sm font-semibold mb-1">Return + Reward</p>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Leave your NuVira bag at your door on your next delivery to earn credits toward future orders.
        </p>
        <p className="text-[10px] text-primary font-medium mt-2">Sustainability, The NuVira Way</p>
      </div>
    );
  }

  const balance = creditData?.balance || 0;
  const earned = creditData?.lifetime_earned || 0;
  const used = creditData?.lifetime_used || 0;
  const history = creditData?.history || [];

  const returnStatusLabel = {
    requested: 'Pending',
    verified: 'Verified',
    partially_verified: 'Partial',
    not_found: 'Not Found',
    not_eligible: 'Not Eligible',
  };

  const returnStatusColor = {
    requested: 'text-amber-600 bg-amber-50',
    verified: 'text-primary bg-primary/10',
    partially_verified: 'text-amber-600 bg-amber-50',
    not_found: 'text-muted-foreground bg-secondary',
    not_eligible: 'text-muted-foreground bg-secondary',
  };

  return (
    <div className="mx-4 mt-4 space-y-4">
      {/* Balance Card */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-primary rounded-2xl p-5 text-primary-foreground"
      >
        <div className="flex items-center gap-2 mb-3">
          <Leaf className="w-4 h-4 text-primary-foreground/70" />
          <p className="text-xs font-semibold uppercase tracking-wider text-primary-foreground/70">NuVira Credits</p>
        </div>
        <p className="font-heading text-4xl font-bold mb-0.5">${balance.toFixed(2)}</p>
        <p className="text-xs text-primary-foreground/60">Available balance</p>
        <div className="flex gap-6 mt-4 pt-4 border-t border-primary-foreground/20">
          <div>
            <p className="text-xs text-primary-foreground/60">Earned</p>
            <p className="text-sm font-semibold">${earned.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-xs text-primary-foreground/60">Applied</p>
            <p className="text-sm font-semibold">${used.toFixed(2)}</p>
          </div>
        </div>
      </motion.div>

      {/* Return History */}
      {returns.length > 0 && (
        <div className="bg-card border border-border/50 rounded-2xl p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Return History</p>
          <div className="space-y-2">
            {returns.slice(0, 5).map((r) => (
              <div key={r.id} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    {r.small_bags_requested > 0 && (
                      <span className="text-[10px] bg-secondary px-2 py-0.5 rounded-full">{r.small_bags_requested} Small Bag{r.small_bags_requested > 1 ? 's' : ''}</span>
                    )}
                    {r.tote_bags_requested > 0 && (
                      <span className="text-[10px] bg-secondary px-2 py-0.5 rounded-full">{r.tote_bags_requested} Tote{r.tote_bags_requested > 1 ? 's' : ''}</span>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {r.created_date ? format(new Date(r.created_date), 'MMM d, yyyy') : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {r.credit_issued > 0 && (
                    <span className="text-xs font-semibold text-primary">+${r.credit_issued.toFixed(2)}</span>
                  )}
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${returnStatusColor[r.verification_status] || 'text-muted-foreground bg-secondary'}`}>
                    {returnStatusLabel[r.verification_status] || r.verification_status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Credit History */}
      {history.length > 0 && (
        <div className="bg-card border border-border/50 rounded-2xl p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Credit Activity</p>
          {history.slice().reverse().slice(0, 8).map((entry, i) => (
            <HistoryItem key={i} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}