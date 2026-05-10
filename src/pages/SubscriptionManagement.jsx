import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Calendar, Pause, SkipForward, Plus, CreditCard, XCircle, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { useQuery } from '@tanstack/react-query';
// Parse YYYY-MM-DD date strings as local dates (avoids UTC→local shift off-by-one)
function formatLocalDate(dateStr) {
  if (!dateStr) return '—';
  const [y, m, d] = String(dateStr).split('T')[0].split('-');
  return new Date(+y, +m - 1, +d).toLocaleDateString();
}

// Derive a safe "Since" label for a subscription.
// Rules:
//  1. If started_date is set AND it does NOT match next_delivery_date → use it (exact date)
//  2. Else if created_date is available → use it (exact date)
//  3. Else → show month/year only from whatever date we have, to avoid showing a misleading exact date
function getSinceLabel(sub) {
  const nextDelivery = sub.next_delivery_date ? String(sub.next_delivery_date).split('T')[0] : null;
  const startedRaw = sub.started_date ? String(sub.started_date).split('T')[0] : null;
  const createdRaw = sub.created_date ? String(sub.created_date).split('T')[0] : null;

  // started_date is only trustworthy if it isn't equal to next_delivery_date
  if (startedRaw && startedRaw !== nextDelivery) {
    return formatLocalDate(startedRaw);
  }

  // Fall back to created_date (entity creation timestamp) — always reliable
  if (createdRaw) {
    const [y, m, d] = createdRaw.split('-');
    const date = new Date(+y, +m - 1, +d);
    // Show month + year only to signal lower certainty
    return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }

  return null; // hide label entirely
}

export default function SubscriptionManagement() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [billingLoading, setBillingLoading] = useState(false);
  const [showPauseModal, setShowPauseModal] = useState(false);
  const [selectedSubId, setSelectedSubId] = useState(null);
  const [pauseDuration, setPauseDuration] = useState('1week');
  const [customDate, setCustomDate] = useState('');
  const [activating, setActivating] = useState(false);

  // Use backend function to resolve Apple relay and linked identity subscriptions
  // placeholderData keeps previous resolved list visible during background refresh (no false empty flash)
  const { data: subscriptions = [], isLoading: isLoadingSubs, refetch } = useQuery({
    queryKey: ['subscriptions', user?.email],
    queryFn: async () => {
      const res = await base44.functions.invoke('getCustomerAccountDashboardData', {});
      return res.data?.all_subscriptions || [];
    },
    enabled: !!user?.email,
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  // Detect if a recent PendingSubscriptionCheckout exists (webhook may still be processing)
  const { data: pendingCheckouts = [] } = useQuery({
    queryKey: ['pending-checkouts', user?.email],
    queryFn: () => base44.entities.PendingSubscriptionCheckout.filter({ customer_email: user?.email }, '-created_date', 5),
    enabled: !!user?.email,
    refetchInterval: activating ? 3000 : false,
  });

  const hasRecentPendingCheckout = pendingCheckouts.some(p => {
    if (p.status === 'completed' || p.status === 'failed') return false;
    const createdAt = new Date(p.created_date);
    const ageMinutes = (Date.now() - createdAt.getTime()) / 60000;
    return ageMinutes < 60; // within last hour
  });

  // Show success toast + poll when returning from Stripe subscription checkout
  // Handles both ?subscribed=true and ?session_id=... (Stripe return_url)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const hasSession = params.get('session_id');
    const hasSubscribed = params.get('subscribed') === 'true';
    if (hasSession || hasSubscribed) {
      setActivating(true);
      toast.success('Payment received! Activating your subscription...');
      window.history.replaceState({}, '', window.location.pathname);
      refetch();
      // Poll every 2s for up to 30s waiting for webhook to create Subscription
      const pollInterval = setInterval(() => refetch(), 2000);
      const timeout = setTimeout(() => {
        clearInterval(pollInterval);
        setActivating(false);
      }, 30000);
      return () => { clearInterval(pollInterval); clearTimeout(timeout); };
    }
  }, []);

  const { data: plans = [] } = useQuery({
    queryKey: ['subscription-plans'],
    queryFn: () => base44.entities.SubscriptionPlan.filter({}, 'sort_order', 50),
  });



  const getPlan = (planId) => plans.find(p => p.id === planId);
  const getPlanName = (planId) => getPlan(planId)?.name || 'Plan';

  const [showCancelConfirm, setShowCancelConfirm] = useState(null); // subId or null

  const handlePause = async (subId) => {
    setLoading(true);
    const resumeDate = calculateResumeDate(pauseDuration, customDate);
    
    try {
      const res = await base44.functions.invoke('pauseSubscription', {
        subscription_id: subId,
        paused_until: resumeDate,
      });
      refetch();
      setShowPauseModal(false);
      toast.success(res.data?.message || `Next month paused. Resumes ${new Date(resumeDate).toLocaleDateString()}.`);
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
      nextDate.setDate(nextDate.getDate() + 7);
      
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

  // Customer self-service: cancel FUTURE renewal only (cancel_at_period_end=true)
  // Does NOT cancel current paid cycle, does NOT refund, does NOT reverse loyalty.
  const handleCancelFutureRenewal = async (subId) => {
    setLoading(true);
    setShowCancelConfirm(null);
    try {
      const res = await base44.functions.invoke('cancelSubscriptionFutureRenewal', {
        subscription_id: subId,
      });
      refetch();
      toast.success(res.data?.message || 'Your renewal has been cancelled. This month\'s deliveries continue as scheduled.');
    } catch (error) {
      toast.error('Failed to cancel renewal. Please try again or contact support.');
    }
    setLoading(false);
  };

  const handleResumeCancelledRenewal = async (subId) => {
    setLoading(true);
    try {
      // Re-activate cancel_at_period_end=false via Stripe portal or direct update
      const sub = subscriptions.find(s => s.id === subId);
      if (sub?.stripe_subscription_id) {
        const Stripe = (await import('@stripe/stripe-js')).loadStripe;
        // Use billing portal for reactivation
        handleManageBilling();
        return;
      }
      await base44.asServiceRole.entities.Subscription.update(subId, {
        cancel_at_period_end: false,
        cancel_effective_date: null,
      });
      refetch();
      toast.success('Renewal reactivated!');
    } catch (error) {
      toast.error('Please use Manage Billing to reactivate your renewal.');
    }
    setLoading(false);
  };

  const handleCancel = async (subId) => {
    // For paused subscriptions — allows full cancel
    setLoading(true);
    try {
      await base44.entities.Subscription.update(subId, { status: 'cancelled' });
      refetch();
      toast.success('Subscription cancelled');
    } catch (error) {
      toast.error('Failed to cancel subscription');
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

  const handleManageBilling = async () => {
    if (window.self !== window.top) {
      alert('Billing management only works from the published app, not the preview.');
      return;
    }
    setBillingLoading(true);
    const res = await base44.functions.invoke('stripeCustomerPortal', {});
    if (res.data?.url) {
      window.location.href = res.data.url;
    } else {
      toast.error(res.data?.error || 'Could not open billing portal. Please contact support.');
    }
    setBillingLoading(false);
  };

  const activeSubscriptions = subscriptions.filter(s => s.status === 'active');
  const pausedSubscriptions = subscriptions.filter(s => s.status === 'paused');

  return (
    <div className="min-h-screen bg-background pb-8">
      {/* Header with safe-area top padding */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border/40 flex items-center gap-3 px-4 py-3" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
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
              {activeSubscriptions.map((sub, i) => {
                const isPendingCancel = sub.cancel_at_period_end === true;
                return (
                  <motion.div
                    key={sub.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.1 }}
                    className="bg-card border border-border/40 rounded-2xl p-4"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="font-semibold text-sm">{getPlanName(sub.plan_id)}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{getPlan(sub.plan_id)?.bottle_count} bottles · {getPlan(sub.plan_id)?.frequency}</p>
                      </div>
                      {isPendingCancel
                        ? <span className="bg-amber-100 text-amber-700 text-[9px] font-bold px-2 py-1 rounded-full">Ends {sub.cancel_effective_date ? formatLocalDate(sub.cancel_effective_date) : 'next cycle'}</span>
                        : <span className="bg-primary/20 text-primary text-[9px] font-bold px-2 py-1 rounded-full">Active</span>
                      }
                    </div>

                    {/* Current cycle lock notice */}
                    <div className="bg-primary/8 border border-primary/20 rounded-lg px-3 py-2 mb-3 flex items-start gap-2">
                    <Info className="w-3 h-3 text-primary mt-0.5 shrink-0" />
                    <p className="text-[11px] text-primary leading-snug" style={{ opacity: 0.85 }}>
                        {isPendingCancel
                          ? `Your current paid month is confirmed. Deliveries continue through ${sub.cancel_effective_date ? new Date(sub.cancel_effective_date).toLocaleDateString() : 'end of current cycle'}. Renewal will not process.`
                          : 'Your current month is confirmed. Changes apply to your next billing cycle only.'
                        }
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-2 mb-3 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      <span>Next delivery: {sub.next_delivery_date ? formatLocalDate(sub.next_delivery_date) : '—'}</span>
                    </div>
                    {getSinceLabel(sub) && <div>Since {getSinceLabel(sub)}</div>}
                    </div>

                    {!isPendingCancel && (
                      <div className="flex gap-2 mb-2">
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
                          Pause Next Month
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
                    )}

                    <Button
                      onClick={handleManageBilling}
                      disabled={billingLoading}
                      variant="outline"
                      size="sm"
                      className="w-full h-9 text-xs rounded-lg mb-2"
                    >
                      <CreditCard className="w-3 h-3 mr-1" />
                      {billingLoading ? 'Loading...' : 'Manage Billing & Payment'}
                    </Button>

                    {isPendingCancel ? (
                      <Button
                        onClick={handleManageBilling}
                        variant="outline"
                        size="sm"
                        className="w-full h-9 text-xs rounded-lg text-primary border-primary/30"
                      >
                        Reactivate Renewal via Billing Portal
                      </Button>
                    ) : (
                      <Button
                        onClick={() => setShowCancelConfirm(sub.id)}
                        disabled={loading}
                        variant="ghost"
                        size="sm"
                        className="w-full h-9 text-xs rounded-lg text-destructive hover:bg-destructive/10"
                      >
                        <XCircle className="w-3 h-3 mr-1" />
                        Cancel Renewal
                      </Button>
                    )}
                  </motion.div>
                );
              })}
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
                      <p className="font-semibold text-sm text-foreground">{getPlanName(sub.plan_id)}</p>
                      <p className="text-xs text-foreground/60 mt-0.5">{getPlan(sub.plan_id)?.bottle_count} bottles · {getPlan(sub.plan_id)?.frequency}</p>
                    </div>
                    <span className="bg-muted text-muted-foreground text-[9px] font-bold px-2 py-1 rounded-full">Paused</span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 mb-3 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      <span>Resumes: {sub.paused_until ? formatLocalDate(sub.paused_until) : '—'}</span>
                    </div>
                    {getSinceLabel(sub) && <div>Since {getSinceLabel(sub)}</div>}
                  </div>

                  <div className="flex gap-2">
                    <Button
                      onClick={() => handleResume(sub.id)}
                      disabled={loading}
                      className="flex-1 h-9 text-xs rounded-lg"
                    >
                      Resume
                    </Button>
                    <Button
                      onClick={() => handleCancel(sub.id)}
                      disabled={loading}
                      variant="outline"
                      className="flex-1 h-9 text-xs rounded-lg"
                    >
                      Cancel
                    </Button>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        )}

        {/* Activating state — webhook still processing */}
        {activating && subscriptions.filter(s => s.status === 'active').length === 0 && (
          <div className="text-center py-12">
            <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-3">
              <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
            <p className="font-medium text-sm mb-1">Activating your subscription...</p>
            <p className="text-xs text-muted-foreground">This usually takes a few seconds.</p>
          </div>
        )}

        {/* Activating — pending checkout exists but Subscription record not yet created */}
        {!activating && subscriptions.filter(s => s.status === 'active').length === 0 && hasRecentPendingCheckout && (
          <div className="text-center py-12">
            <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-3">
              <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
            <p className="font-medium text-sm mb-1">Activating your subscription...</p>
            <p className="text-xs text-muted-foreground mb-3">Your payment was received. This usually takes a few seconds.</p>
            <p className="text-xs text-muted-foreground">If this takes longer than a minute, please contact support — your payment is safe.</p>
          </div>
        )}

        {/* Loading skeleton — only while initial fetch is in-flight (no cached data yet) */}
        {isLoadingSubs && subscriptions.length === 0 && !activating && (
          <div className="space-y-3">
            {[1, 2].map(i => (
              <div key={i} className="bg-card border border-border/40 rounded-2xl p-4 animate-pulse">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="h-4 w-32 bg-muted rounded mb-1.5" />
                    <div className="h-3 w-24 bg-muted/60 rounded" />
                  </div>
                  <div className="h-5 w-14 bg-muted rounded-full" />
                </div>
                <div className="h-10 bg-muted/40 rounded-lg mb-3" />
                <div className="h-8 bg-muted/30 rounded-lg" />
              </div>
            ))}
          </div>
        )}

        {/* Empty State — no subscription AND no pending checkout */}
        {!activating && !isLoadingSubs && subscriptions.length === 0 && !hasRecentPendingCheckout && (
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



      {/* Cancel Renewal Confirmation Modal */}
      <AnimatePresence>
        {showCancelConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50 flex items-end"
            onClick={() => setShowCancelConfirm(null)}
          >
            <motion.div
              initial={{ y: 100 }}
              animate={{ y: 0 }}
              exit={{ y: 100 }}
              onClick={e => e.stopPropagation()}
              className="bg-card w-full rounded-t-2xl p-5"
            >
              <h3 className="font-semibold text-base mb-2">Cancel Future Renewal</h3>
              <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
                This will stop your subscription after your current paid month. <strong>You will still receive all of this month's scheduled deliveries.</strong>
              </p>
              <div className="bg-amber-50 border border-amber-300 rounded-lg px-3 py-2.5 mb-4">
                <p className="text-xs text-amber-900 leading-snug">
                  Monthly subscription payments are non-refundable once processed. Cancelling only stops the <em>next</em> billing cycle.
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setShowCancelConfirm(null)} className="flex-1 rounded-lg h-10">
                  Keep Subscription
                </Button>
                <Button
                  onClick={() => handleCancelFutureRenewal(showCancelConfirm)}
                  disabled={loading}
                  variant="destructive"
                  className="flex-1 rounded-lg h-10"
                >
                  {loading ? 'Cancelling...' : 'Cancel Renewal'}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Pause Next Month Modal */}
      {showPauseModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end" onClick={() => setShowPauseModal(false)}>
          <motion.div
            initial={{ y: 100 }}
            animate={{ y: 0 }}
            onClick={e => e.stopPropagation()}
            className="bg-card w-full rounded-t-2xl p-5"
          >
            <h3 className="font-semibold text-base mb-1">Pause Next Month</h3>
            <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
              Your current month remains active. Your next billing cycle will be paused.
            </p>

            <div className="space-y-2 mb-5">
              {[
                { value: '1week', label: 'Pause for 1 week' },
                { value: '2weeks', label: 'Pause for 2 weeks' },
                { value: '1month', label: 'Pause for 1 month' },
                { value: 'custom', label: 'Custom resume date' },
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
              <Button variant="outline" onClick={() => setShowPauseModal(false)} className="flex-1 rounded-lg h-10">
                Back
              </Button>
              <Button
                onClick={() => handlePause(selectedSubId)}
                disabled={loading || (pauseDuration === 'custom' && !customDate)}
                className="flex-1 rounded-lg h-10"
              >
                {loading ? 'Pausing...' : 'Confirm Pause'}
              </Button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}