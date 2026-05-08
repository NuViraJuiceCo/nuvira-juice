import React, { useState, useRef, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Check, Zap, Crown, Leaf, MapPin, CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import AddressAutocomplete from '@/components/AddressAutocomplete';
import OutOfAreaModal from '@/components/checkout/OutOfAreaModal';
import SubscriptionPaymentPanel from '@/components/checkout/SubscriptionPaymentPanel';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { useQuery } from '@tanstack/react-query';

const LOGO_URL = "https://media.base44.com/images/public/69d48d0c39891f7945481152/b04d63077_Asset18322x.png";

const PLAN_ICONS = { 0: Leaf, 1: Zap, 2: Crown };
const PLAN_META = [
  { badge: null },
  { badge: 'Most Popular' },
  { badge: 'Best Value' },
];

// Payment flow states
const FLOW = {
  IDLE: 'idle',
  PREPARING: 'preparing',
  PAYMENT: 'payment',
  PROCESSING: 'processing',
  ACTIVATING: 'activating',
  SUCCESS: 'success',
  ERROR: 'error',
};

export default function Subscribe() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [selectedPlanId, setSelectedPlanId] = useState(null);
  const [address, setAddress] = useState({ street: '', city: '', state: '', zip: '' });
  const [calculatedZone, setCalculatedZone] = useState(null);
  const [calculatedDistance, setCalculatedDistance] = useState(null);
  const [calculating, setCalculating] = useState(false);
  const [showOutOfArea, setShowOutOfArea] = useState(false);
  const [flowState, setFlowState] = useState(FLOW.IDLE);
  const [errorMessage, setErrorMessage] = useState('');
  const debounceRef = useRef(null);
  const pollRef = useRef(null);

  // Checkout session data
  const [checkoutData, setCheckoutData] = useState(null);
  // { paymentIntentClientSecret, stripeSubscriptionId, pendingCheckoutId, publishableKey, planName, amountDue }

  const { data: plans = [] } = useQuery({
    queryKey: ['subscriptionPlans'],
    queryFn: () => base44.entities.SubscriptionPlan.list('sort_order'),
  });

  const { data: deliveryZones = [] } = useQuery({
    queryKey: ['deliveryZones'],
    queryFn: () => base44.entities.DeliveryZone.filter({ is_active: true }, 'max_miles'),
  });

  // Set default plan once data loads
  React.useEffect(() => {
    if (plans.length > 0 && !selectedPlanId) setSelectedPlanId(plans[1]?.id || plans[0]?.id);
  }, [plans]);

  // Cleanup poll on unmount
  React.useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const calculateDistance = (addr) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setCalculatedZone(null);
    setCalculatedDistance(null);
    if (!addr || !addr.trim() || addr.length < 5) return;
    setCalculating(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await base44.functions.invoke('calculateDeliveryZone', { address: addr });
        const d = res.data;
        setCalculatedDistance(d.distance);
        setCalculatedZone(d.zone || null);
      } catch (err) {
        console.error('Distance calc error:', err);
      } finally {
        setCalculating(false);
      }
    }, 800);
  };

  const selectedPlan = plans.find(p => p.id === selectedPlanId);

  const handleJoin = async () => {
    try {
    if (!user) {
      base44.auth.redirectToLogin('/subscribe');
      return;
    }

    const addressString = [address.street, address.city, address.state, address.zip].filter(Boolean).join(', ');
    if (!addressString.trim()) {
      toast.error('Please enter your delivery address');
      return;
    }
    if (!selectedPlanId) {
      toast.error('Please select a plan');
      return;
    }
    if (calculating) {
      toast.error('Please wait while we verify your address');
      return;
    }

    setFlowState(FLOW.PREPARING);
    setErrorMessage('');

    // Fresh delivery zone check
    try {
      const zoneRes = await base44.functions.invoke('calculateDeliveryZone', { address: addressString });
      const zoneData = zoneRes.data;
      setCalculatedDistance(zoneData.distance);
      setCalculatedZone(zoneData.zone || null);
      if (!zoneData.zone) {
        setShowOutOfArea(true);
        setFlowState(FLOW.IDLE);
        return;
      }
    } catch (err) {
      console.error('[Subscribe] Zone check error:', err);
      toast.error('Could not verify delivery address. Please try again.');
      setFlowState(FLOW.IDLE);
      return;
    }

    // Create subscription PaymentIntent for in-app payment
    try {
      const res = await base44.functions.invoke('createSubscriptionPaymentElementIntent', {
        plan_id: selectedPlanId,
        bundle_id: null,
        customer_email: user.email,
        contact_phone: '',
        address_line1: address.street || '',
        address_city: address.city || '',
        address_state: address.state || '',
        address_postal_code: address.zip || '',
        delivery_address: addressString,
      });

      const data = res?.data;

      // Backend returned an error payload
      if (data?.error) {
        const code = data.error_code || '';
        let msg = data.error;
        // Surface friendly messages for known codes
        if (code === 'MISSING_NAME' || code === 'MISSING_PROFILE') {
          msg = `${data.error} Go to Account → Settings to update your name.`;
        }
        console.error(`[Subscribe] Backend error [${code}]: ${data.error}`);
        setErrorMessage(msg);
        setFlowState(FLOW.ERROR);
        return;
      }

      // Backend succeeded and returned the client secret
      if (data?.paymentIntentClientSecret) {
        setCheckoutData(data);
        setFlowState(FLOW.PAYMENT);
      } else {
        // Unexpected response shape — log it for debugging
        console.error('[Subscribe] Unexpected backend response:', JSON.stringify(data));
        setErrorMessage('Checkout could not be started — unexpected server response. Please try again.');
        setFlowState(FLOW.ERROR);
      }
    } catch (err) {
      console.error('[Subscribe] Checkout setup error:', err?.message || err);
      setErrorMessage(err?.message || 'Subscription checkout could not be started. Please try again.');
      setFlowState(FLOW.ERROR);
    }
    } catch (outerErr) {
      // Safety net: catch any unexpected JS exception so mobile never shows a blank screen
      console.error('[Subscribe] Unexpected error in handleJoin:', outerErr?.message || outerErr);
      setErrorMessage('Something went wrong. Please refresh and try again.');
      setFlowState(FLOW.ERROR);
    }
  };

  // Called by SubscriptionPaymentPanel when payment succeeds
  const handlePaymentSuccess = useCallback((paymentIntentId) => {
    setFlowState(FLOW.ACTIVATING);

    // Poll for active Subscription record (webhook may take a few seconds)
    let attempts = 0;
    const maxAttempts = 20; // 40 seconds total
    pollRef.current = setInterval(async () => {
      attempts++;
      try {
        const subs = await base44.entities.Subscription.filter({ customer_email: user.email });
        const active = subs.find(s => s.status === 'active');
        if (active) {
          clearInterval(pollRef.current);
          setFlowState(FLOW.SUCCESS);
          // Short delay so user sees success, then navigate
          setTimeout(() => navigate('/account/subscriptions'), 1500);
        } else if (attempts >= maxAttempts) {
          clearInterval(pollRef.current);
          // Still navigate — webhook will catch up, SubscriptionManagement polls too
          navigate('/account/subscriptions');
        }
      } catch (err) {
        console.error('[Subscribe] Poll error:', err);
      }
    }, 2000);
  }, [user, navigate]);

  const handlePaymentCancel = () => {
    setCheckoutData(null);
    setFlowState(FLOW.IDLE);
  };

  const handlePaymentError = (msg) => {
    // Stay on payment form — error is shown inside SubscriptionPaymentPanel
    setFlowState(FLOW.PAYMENT);
  };

  const addressString = [address.street, address.city, address.state, address.zip].filter(Boolean).join(', ');
  const isPaymentOpen = flowState === FLOW.PAYMENT;
  const isPreparing = flowState === FLOW.PREPARING;
  const isActivating = flowState === FLOW.ACTIVATING;
  const isSuccess = flowState === FLOW.SUCCESS;
  const isError = flowState === FLOW.ERROR;

  return (
    <div className="min-h-screen bg-background pb-10">
      {showOutOfArea && (
        <OutOfAreaModal
          address={addressString}
          zip={address.zip}
          onClose={() => setShowOutOfArea(false)}
        />
      )}

      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border/40 flex items-center gap-3 px-4 py-3">
        <Link to="/account">
          <button className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-muted transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
        </Link>
        <span className="font-heading text-base font-semibold">Subscribe & Save</span>
      </div>

      {/* Hero */}
      <div className="relative overflow-hidden" style={{ height: '200px' }}>
        <img
          src="https://media.base44.com/images/public/69d48d0c39891f7945481152/9009cffcd_DSC02696.jpg"
          alt="NuVira subscription delivery"
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-primary/90 via-primary/60 to-primary/20" />
        <div className="absolute inset-0 flex flex-col items-center justify-center px-5 text-center">
          <img src={LOGO_URL} alt="NuVira" className="h-9 mb-2 brightness-0 invert opacity-90" />
          <h1 className="font-heading text-2xl font-bold text-white mb-1">Wellness on Autopilot</h1>
          <p className="text-white/80 text-sm leading-relaxed">
            Subscribe and never run out of the nutrition your body needs.
          </p>
        </div>
      </div>

      {/* Activating / Success overlay states */}
      <AnimatePresence>
        {(isActivating || isSuccess) && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mx-4 mt-6 bg-primary/5 border border-primary/20 rounded-2xl p-8 text-center"
          >
            {isSuccess ? (
              <>
                <CheckCircle2 className="w-14 h-14 text-primary mx-auto mb-3" />
                <p className="font-heading text-xl font-bold mb-1">You're subscribed! 🎉</p>
                <p className="text-sm text-muted-foreground">Taking you to your subscriptions...</p>
              </>
            ) : (
              <>
                <Loader2 className="w-10 h-10 text-primary animate-spin mx-auto mb-3" />
                <p className="font-semibold text-base mb-1">Activating your subscription...</p>
                <p className="text-xs text-muted-foreground">This takes just a moment. Please don't close this page.</p>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main content — hidden while activating/success */}
      {!isActivating && !isSuccess && (
        <>
          {/* Address Section */}
          <div className="px-4 mt-6">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-2">Delivery Address</label>
            <AddressAutocomplete
              value={address}
              onChange={addr => {
                setAddress(addr);
                const full = [addr.street, addr.city, addr.state, addr.zip].filter(Boolean).join(', ');
                calculateDistance(full);
              }}
              placeholder="123 Main St"
              className="rounded-xl h-11"
            />
          </div>

          {/* Delivery Zone Result */}
          {calculatedDistance !== null && !calculating && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`mx-4 mt-4 border rounded-xl p-4 ${calculatedZone ? 'bg-primary/5 border-primary/20' : 'bg-destructive/5 border-destructive/30'}`}
            >
              <div className="flex items-center gap-2 mb-2">
                <MapPin className={`w-4 h-4 ${calculatedZone ? 'text-primary' : 'text-destructive'}`} />
                <span className="font-semibold text-sm">{calculatedZone ? 'Delivery Available' : 'Outside Delivery Area'}</span>
              </div>
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">{calculatedDistance?.toFixed(1)} miles from our kitchen</p>
                {calculatedZone ? (
                  (() => {
                    const zoneIndex = parseInt(calculatedZone.replace('zone', '')) - 1;
                    const zone = deliveryZones[zoneIndex];
                    return zone ? <p className="text-sm font-semibold">{zone.name} — ${zone.delivery_fee?.toFixed(2)} delivery fee</p> : null;
                  })()
                ) : (
                  <>
                    <p className="text-sm font-semibold text-destructive">We currently deliver within 15 miles of O'Fallon, MO</p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full mt-1 border-destructive/40 text-destructive hover:bg-destructive/10"
                      onClick={() => setShowOutOfArea(true)}
                    >
                      Notify me when you deliver to my area
                    </Button>
                  </>
                )}
              </div>
            </motion.div>
          )}

          {calculating && (
            <div className="px-4 mt-4 text-xs text-muted-foreground text-center">
              Calculating distance...
            </div>
          )}

          {/* Plans */}
          <div className="px-4 mt-6 space-y-3">
            {plans.map((plan, i) => {
              const Icon = PLAN_ICONS[i] || Leaf;
              const meta = PLAN_META[i] || PLAN_META[0];
              const isSelected = selectedPlanId === plan.id;
              const period = plan.frequency === 'weekly' ? '/week' : '/month';
              const savings = plan.discount_percent > 0 ? `Save ${plan.discount_percent}%` : null;

              return (
                <motion.button
                  key={plan.id}
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.08 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => {
                    // Don't allow plan change while payment panel is open
                    if (isPaymentOpen) return;
                    setSelectedPlanId(plan.id);
                  }}
                  className={`w-full text-left rounded-2xl border-2 p-4 transition-all duration-150 ${
                    isSelected
                      ? 'border-primary bg-primary/5 shadow-lg shadow-primary/10'
                      : 'border-border/40 bg-card opacity-90'
                  } ${isPaymentOpen ? 'pointer-events-none' : ''}`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${isSelected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                        {isSelected ? <CheckCircle2 className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-sm">{plan.name}</p>
                          {isSelected && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground">Selected</span>
                          )}
                        </div>
                        <p className="text-xs font-semibold text-primary">
                          {plan.frequency === 'weekly' ? '1 delivery' : '4 weekly deliveries'} · {plan.bottle_count} bottles total
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {plan.name === 'Weekly Fresh'
                            ? '1 AURA, 1 RE-NU, 1 OASIS'
                            : plan.name === 'Monthly Ritual'
                            ? '1 of each flavor per week × 4'
                            : '2 of each flavor per week × 4'}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      {meta.badge && (
                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${i === 2 ? 'bg-accent/20 text-accent-foreground' : 'bg-primary/15 text-primary'}`}>
                          {meta.badge}
                        </span>
                      )}
                      {savings && <p className="text-[9px] text-primary font-bold">{savings}</p>}
                      <div className="text-right">
                        <span className="font-heading text-lg font-bold">${plan.base_price}</span>
                        <span className="text-xs text-muted-foreground">{period}</span>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    {(plan.perks || []).map(perk => (
                      <div key={perk} className="flex items-start gap-2">
                        <Check className="w-3 h-3 text-primary mt-0.5 shrink-0" />
                        <span className="text-xs text-muted-foreground leading-snug">{perk}</span>
                      </div>
                    ))}
                  </div>
                </motion.button>
              );
            })}
          </div>

          {/* In-app Payment Panel — shown inline after prepare */}
          <div className="px-4">
            <AnimatePresence>
              {isPaymentOpen && checkoutData && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                >
                  <SubscriptionPaymentPanel
                    clientSecret={checkoutData.paymentIntentClientSecret}
                    publishableKey={checkoutData.publishableKey}
                    amountDue={checkoutData.amountDue}
                    planName={checkoutData.planName}
                    stripeSubscriptionId={checkoutData.stripeSubscriptionId}
                    onSuccess={handlePaymentSuccess}
                    onCancel={handlePaymentCancel}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* CTA — hidden when payment form is open */}
          {!isPaymentOpen && (
            <div className="px-4 mt-6 space-y-3">
              {selectedPlan && (
                <div className="flex items-center justify-between bg-primary/10 border border-primary/20 rounded-xl px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
                    <span className="text-sm font-semibold">{selectedPlan.name}</span>
                  </div>
                  <span className="text-sm font-bold text-primary">
                    ${selectedPlan.base_price}{selectedPlan.frequency === 'weekly' ? '/wk' : '/mo'}
                  </span>
                </div>
              )}
              {!address.street.trim() && (
                <p className="text-center text-xs text-amber-600 font-medium">⚠ Enter your delivery address above to continue</p>
              )}
              {address.street.trim() && calculating && (
                <p className="text-center text-xs text-muted-foreground">Verifying your address...</p>
              )}
              {!user && (
                <p className="text-center text-xs text-amber-600 font-medium">⚠ Sign in to subscribe</p>
              )}
              {isError && (
                <div className="bg-destructive/10 border border-destructive/20 rounded-xl px-4 py-3">
                  <p className="text-xs text-destructive font-medium">{errorMessage}</p>
                </div>
              )}
              <Button
                onClick={handleJoin}
                disabled={isPreparing || !selectedPlanId || !address.street.trim() || calculating}
                className="w-full h-12 rounded-xl font-semibold text-sm"
              >
                {isPreparing ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Preparing checkout...
                  </span>
                ) : !user
                  ? 'Sign In to Subscribe'
                  : `Subscribe to ${selectedPlan?.name} — $${selectedPlan?.base_price}${selectedPlan?.frequency === 'weekly' ? '/week' : '/month'}`}
              </Button>
              <p className="text-center text-[10px] text-muted-foreground leading-relaxed">
                No commitments. Cancel anytime directly from your account.
                Secured by Stripe — Apple Pay, Google Pay & all major cards accepted.
              </p>
            </div>
          )}

          {/* FAQ */}
          <div className="px-4 mt-8">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">FAQs</p>
            <div className="space-y-3">
              {[
                { q: 'When will I be charged?', a: 'Your card is charged immediately when you subscribe, then automatically on the same day each week or month. You control your subscription anytime from your account.' },
                { q: 'What juices do I get?', a: 'Weekly Fresh: 1 of each flavor (AURA, RE-NU, OASIS). Monthly Ritual & VIP: 1 (or 2 for VIP) of each flavor, 4 times that month.' },
                { q: 'How do I pause or cancel?', a: 'From your account, you can pause for 1-4 weeks, skip a delivery, or cancel anytime. Manage everything through your subscription dashboard or Stripe billing portal.' },
                { q: 'What does "order priority" mean?', a: 'Subscribers get their orders pressed first within each delivery window — so your juice is always the freshest.' },
              ].map(({ q, a }) => (
                <div key={q} className="bg-card border border-border/40 rounded-xl p-4">
                  <p className="text-sm font-medium mb-1">{q}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{a}</p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}