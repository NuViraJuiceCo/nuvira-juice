import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Calendar, Pause, SkipForward, Plus, Edit2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { useQuery } from '@tanstack/react-query';
import CompositionEditor from '@/components/subscription/CompositionEditor';

export default function SubscriptionManagement() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [showPauseModal, setShowPauseModal] = useState(false);
  const [selectedSubId, setSelectedSubId] = useState(null);
  const [pauseDuration, setPauseDuration] = useState('1week');
  const [customDate, setCustomDate] = useState('');
  const [editingSub, setEditingSub] = useState(null);

  const { data: subscriptions = [], refetch } = useQuery({
    queryKey: ['subscriptions', user?.email],
    queryFn: () => base44.entities.Subscription.filter({ customer_email: user?.email }, '-created_date', 50),
    enabled: !!user?.email,
  });

  const { data: plans = [] } = useQuery({
    queryKey: ['subscription-plans'],
    queryFn: () => base44.entities.SubscriptionPlan.filter({}, 'sort_order', 50),
  });

  const { data: juiceProducts = [] } = useQuery({
    queryKey: ['juice-products'],
    queryFn: () => base44.entities.Product.filter({ is_available: true }, 'sort_order', 50),
  });

  const getPlan = (planId) => plans.find(p => p.id === planId);
  const getPlanName = (planId) => getPlan(planId)?.name || 'Plan';

  const handlePause = async (subId) => {
    const sub = subscriptions.find(s => s.id === subId);
    if (!sub) return;

    setLoading(true);
    const resumeDate = calculateResumeDate(pauseDuration, customDate);
    
    try {
      await base44.functions.invoke('pauseSubscription', {
        subscription_id: subId,
        paused_until: resumeDate,
      });
      refetch();
      setShowPauseModal(false);
      toast.success(`Subscription paused until ${new Date(resumeDate).toLocaleDateString()}`);
    } catch (error) {
      toast.error('Failed to pause subscription');
    }
    setLoading(false);
  };

  const calculateResumeDate = (duration, customDateStr) => {
    const date = new Date();
    if (duration === 'custom' && customDateStr) {
      return new Date(customDateStr).toISOString().split('T')[0];
    }
    const daysMap = { '1week': 7, '2weeks': 14, '1month': 30 };
    date.setDate(date.getDate() + (daysMap[duration] || 7));
    return date.toISOString().split('T')[0];
  };

  const handleSkip = async (subId) => {
    const sub = subscriptions.find(s => s.id === subId);
    if (!sub) return;

    setLoading(true);
    try {
      const nextDate = new Date(sub.next_delivery_date);
      nextDate.setDate(nextDate.getDate() + 7); // Skip to following week
      
      await base44.entities.Subscription.update(subId, {
        next_delivery_date: nextDate.toISOString().split('T')[0],
      });
      refetch();
      toast.success('Delivery skipped. Next delivery scheduled for next week.');
    } catch (error) {
      toast.error('Failed to skip delivery');
    }
    setLoading(false);
  };

  const handleResume = async (subId) => {
    setLoading(true);
    try {
      await base44.entities.Subscription.update(subId, {
        status: 'active',
        paused_until: null,
      });
      refetch();
      toast.success('Subscription resumed!');
    } catch (error) {
      toast.error('Failed to resume subscription');
    }
    setLoading(false);
  };

  const activeSubscriptions = subscriptions.filter(s => s.status === 'active');
  const pausedSubscriptions = subscriptions.filter(s => s.status === 'paused');

  return (
    <div className="min-h-screen bg-background pb-8">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border/40 flex items-center gap-3 px-4 py-3">
        <Link to="/account">
          <button className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-muted transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
        </Link>
        <span className="font-heading text-base font-semibold">My Subscriptions</span>
      </div>

      <div className="px-4 py-6 space-y-6">
        {/* Active Subscriptions */}
        {activeSubscriptions.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Active</h2>
            <div className="space-y-3">
              {activeSubscriptions.map((sub, i) => (
                <motion.div
                  key={sub.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.1 }}
                  className="bg-card border border-border/40 rounded-2xl p-4"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="font-semibold text-sm">{getPlanName(sub.plan_id)}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{getPlan(sub.plan_id)?.bottle_count} bottles · {getPlan(sub.plan_id)?.frequency}</p>
                    </div>
                    <span className="bg-primary/20 text-primary text-[9px] font-bold px-2 py-1 rounded-full">Active</span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 mb-3 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      <span>Next: {new Date(sub.next_delivery_date).toLocaleDateString()}</span>
                    </div>
                    <div>Since {new Date(sub.started_date).toLocaleDateString()}</div>
                  </div>

                  {/* Customize composition */}
                  <button
                    onClick={() => setEditingSub(sub)}
                    className="w-full mb-2 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/20 transition-colors"
                  >
                    <Edit2 className="w-3 h-3" />
                    Customize My Juice Mix
                    {sub.custom_composition?.length > 0 && (
                      <span className="bg-primary text-primary-foreground text-[9px] font-bold px-1.5 py-0.5 rounded-full ml-1">
                        {sub.custom_composition.reduce((a, i) => a + i.quantity, 0)} bottles set
                      </span>
                    )}
                  </button>

                  <div className="flex gap-2">
                    <Button
                      onClick={() => {
                        setSelectedSubId(sub.id);
                        setShowPauseModal(true);
                      }}
                      variant="outline"
                      size="sm"
                      className="flex-1 h-9 text-xs rounded-lg"
                    >
                      <Pause className="w-3 h-3 mr-1" />
                      Pause
                    </Button>
                    <Button
                      onClick={() => handleSkip(sub.id)}
                      disabled={loading}
                      variant="outline"
                      size="sm"
                      className="flex-1 h-9 text-xs rounded-lg"
                    >
                      <SkipForward className="w-3 h-3 mr-1" />
                      Skip
                    </Button>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        )}

        {/* Paused Subscriptions */}
        {pausedSubscriptions.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Paused</h2>
            <div className="space-y-3">
              {pausedSubscriptions.map((sub, i) => (
                <motion.div
                  key={sub.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.1 }}
                  className="bg-card border border-border/40 rounded-2xl p-4 opacity-75"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="font-semibold text-sm">{getPlanName(sub.plan_id)}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{getPlan(sub.plan_id)?.bottle_count} bottles · {getPlan(sub.plan_id)?.frequency}</p>
                    </div>
                    <span className="bg-muted text-muted-foreground text-[9px] font-bold px-2 py-1 rounded-full">Paused</span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 mb-3 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      <span>Resumes: {new Date(sub.paused_until).toLocaleDateString()}</span>
                    </div>
                  </div>

                  <Button
                    onClick={() => handleResume(sub.id)}
                    disabled={loading}
                    className="w-full h-9 text-xs rounded-lg"
                  >
                    Resume Now
                  </Button>
                </motion.div>
              ))}
            </div>
          </div>
        )}

        {/* Empty State */}
        {subscriptions.length === 0 && (
          <div className="text-center py-12">
            <div className="w-12 h-12 bg-secondary rounded-full flex items-center justify-center mx-auto mb-3">
              <Plus className="w-6 h-6 text-muted-foreground" />
            </div>
            <p className="font-medium text-sm mb-1">No active subscriptions</p>
            <p className="text-xs text-muted-foreground mb-4">Start a subscription to get fresh juice delivered regularly.</p>
            <Link to="/subscribe">
              <Button size="sm" className="rounded-full">Subscribe Now</Button>
            </Link>
          </div>
        )}
      </div>

      {/* Composition Editor */}
      <AnimatePresence>
        {editingSub && (
          <CompositionEditor
            subscription={editingSub}
            plan={getPlan(editingSub.plan_id)}
            products={juiceProducts}
            onClose={() => setEditingSub(null)}
            onSaved={refetch}
          />
        )}
      </AnimatePresence>

      {/* Pause Modal */}
      {showPauseModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end">
          <motion.div
            initial={{ y: 100 }}
            animate={{ y: 0 }}
            className="bg-card w-full rounded-t-2xl p-5"
          >
            <h3 className="font-semibold text-base mb-4">Pause Subscription</h3>

            <div className="space-y-2 mb-5">
              {[
                { value: '1week', label: 'Pause for 1 week' },
                { value: '2weeks', label: 'Pause for 2 weeks' },
                { value: '1month', label: 'Pause for 1 month' },
                { value: 'custom', label: 'Custom date' },
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setPauseDuration(opt.value)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg border-2 transition-all ${
                    pauseDuration === opt.value
                      ? 'border-primary bg-primary/5'
                      : 'border-border/40 bg-card'
                  }`}
                >
                  <p className="text-sm font-medium">{opt.label}</p>
                </button>
              ))}
            </div>

            {pauseDuration === 'custom' && (
              <div className="mb-5">
                <label className="text-xs font-semibold text-muted-foreground block mb-2">Resume Date</label>
                <input
                  type="date"
                  value={customDate}
                  onChange={e => setCustomDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                />
              </div>
            )}

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setShowPauseModal(false)}
                className="flex-1 rounded-lg h-10"
              >
                Cancel
              </Button>
              <Button
                onClick={() => handlePause(selectedSubId)}
                disabled={loading || (pauseDuration === 'custom' && !customDate)}
                className="flex-1 rounded-lg h-10"
              >
                {loading ? 'Pausing...' : 'Confirm'}
              </Button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}