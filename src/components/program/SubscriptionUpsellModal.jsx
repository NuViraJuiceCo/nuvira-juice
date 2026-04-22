import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Check, Crown, Leaf, Zap, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';

const PLAN_ICONS = { 0: Leaf, 1: Zap, 2: Crown };

export default function SubscriptionUpsellModal({ open, onClose, onOneTime, programName, programTotal }) {
  const navigate = useNavigate();

  const { data: plans = [] } = useQuery({
    queryKey: ['subscriptionPlans'],
    queryFn: () => base44.entities.SubscriptionPlan.list('sort_order'),
    enabled: open,
  });

  const handleSubscribe = (planId) => {
    onClose();
    navigate('/subscribe');
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/40 z-50"
          />
          {/* Sheet */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 z-50 bg-background rounded-t-3xl px-4 pt-6 pb-10 max-h-[90vh] overflow-y-auto"
          >
            {/* Handle */}
            <div className="w-10 h-1 bg-border rounded-full mx-auto mb-5" />

            <button onClick={onClose} className="absolute top-5 right-4 w-8 h-8 flex items-center justify-center rounded-full bg-secondary">
              <X className="w-4 h-4 text-muted-foreground" />
            </button>

            <h2 className="font-heading text-2xl font-bold mb-1">Stay Consistent?</h2>
            <p className="text-sm text-muted-foreground mb-5">
              Subscribers see the best results. Lock in your routine and save.
            </p>

            {/* Subscription Cards */}
            <div className="space-y-3 mb-4">
              {plans.map((plan, i) => {
                const Icon = PLAN_ICONS[i] || Leaf;
                const isHighlighted = plan.is_featured;
                const period = plan.frequency === 'weekly' ? '/week' : '/month';
                const bottleLabel = plan.frequency === 'weekly'
                  ? `${plan.bottle_count} bottles/week`
                  : `${plan.bottle_count} bottles/month`;

                return (
                  <button
                    key={plan.id}
                    onClick={() => handleSubscribe(plan.id)}
                    className={`w-full text-left rounded-2xl border-2 p-4 transition-all ${
                      isHighlighted
                        ? 'border-primary bg-primary/5'
                        : 'border-border/50 bg-card'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <div className="flex items-center gap-2 mb-0.5">
                          <Icon className={`w-4 h-4 ${isHighlighted ? 'text-primary' : 'text-muted-foreground'}`} />
                          <p className="font-semibold text-sm">{plan.name}</p>
                          {isHighlighted && (
                            <span className="text-[9px] font-bold bg-primary/15 text-primary px-2 py-0.5 rounded-full">
                              Most Popular
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground">{bottleLabel}</p>
                      </div>
                      <div className="text-right shrink-0 ml-2">
                        <div>
                          <span className="font-heading text-xl font-bold">${plan.base_price}</span>
                          <span className="text-xs text-muted-foreground">{period}</span>
                        </div>
                        {plan.discount_percent > 0 && (
                          <p className="text-[10px] text-primary font-semibold">Save {plan.discount_percent}%</p>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      {(plan.perks || []).slice(0, 3).map(perk => (
                        <div key={perk} className="flex items-center gap-1">
                          <Check className="w-3 h-3 text-primary shrink-0" />
                          <span className="text-[10px] text-muted-foreground">{perk}</span>
                        </div>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* One-time Option */}
            <button
              onClick={onOneTime}
              className="w-full py-3.5 rounded-xl border border-border/50 text-sm font-medium text-muted-foreground hover:text-foreground hover:border-border transition-all"
            >
              No thanks — one-time purchase (${programTotal})
            </button>

            <p className="text-center text-[10px] text-muted-foreground mt-3">
              Cancel anytime. No fees, no penalties.
            </p>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}