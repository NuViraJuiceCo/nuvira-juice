import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Crown, Leaf, Zap, X, MapPin, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import AddressAutocomplete from '@/components/AddressAutocomplete';
import OutOfAreaModal from '@/components/checkout/OutOfAreaModal';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

const PLAN_ICONS = { 0: Leaf, 1: Zap, 2: Crown };

export default function SubscriptionUpsellModal({ open, onClose, onOneTime, onSubscribe, programName, programTotal }) {
  const [selectedPlanId, setSelectedPlanId] = useState(null);
  const [address, setAddress] = useState({ street: '', city: '', state: '', zip: '' });
  const [calculatedZone, setCalculatedZone] = useState(null);
  const [calculatedDistance, setCalculatedDistance] = useState(null);
  const [calculating, setCalculating] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const [showOutOfArea, setShowOutOfArea] = useState(false);
  const debounceRef = useRef(null);

  const { data: plans = [] } = useQuery({
    queryKey: ['subscriptionPlans'],
    queryFn: () => base44.entities.SubscriptionPlan.list('sort_order'),
    enabled: open,
  });

  // Set default plan once data loads
  useEffect(() => {
    if (plans.length > 0 && !selectedPlanId) {
      setSelectedPlanId(plans[1]?.id || plans[0]?.id);
    }
  }, [plans]);

  const calculateDistance = (nextAddress) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setCalculatedZone(null);
    setCalculatedDistance(null);
    setShowOutOfArea(false);
    const addr = [nextAddress?.street, nextAddress?.city, nextAddress?.state, nextAddress?.zip]
      .filter(Boolean)
      .join(', ');
    if (!addr.trim() || addr.length < 5) return;
    setCalculating(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await base44.functions.invoke('validateDeliveryEligibility', {
          delivery_address: addr,
          address_line1: nextAddress?.street || '',
          address_city: nextAddress?.city || '',
          address_state: nextAddress?.state || '',
          address_postal_code: nextAddress?.zip || '',
          cart_subtotal: Number(programTotal) || 0,
          order_type: 'subscription',
        });
        const eligibility = res?.data || res;
        setCalculatedDistance(eligibility?.estimated_distance_miles ?? null);
        setCalculatedZone(eligibility || null);
      } catch (err) {
        console.error('Distance calc error:', err);
        setCalculatedDistance(null);
        setCalculatedZone(null);
      } finally {
        setCalculating(false);
      }
    }, 800);
  };

  const selectedPlan = plans.find(p => p.id === selectedPlanId);
  const addressString = [address.street, address.city, address.state, address.zip].filter(Boolean).join(', ');
  const subscriptionDeliveryEligible = Boolean(
    calculatedZone?.checkout_allowed && calculatedZone?.allowed_for_subscriptions
  );

  const handleSubscribe = async () => {
    if (!addressString.trim()) {
      toast.error('Please enter your delivery address');
      return;
    }
    if (calculating) {
      toast.error('Please wait while we verify your address');
      return;
    }
    if (!selectedPlanId) {
      toast.error('Please select a plan');
      return;
    }
    if (!subscriptionDeliveryEligible) {
      toast.error(calculatedZone?.customer_message || 'Subscription delivery is not available for this address');
      return;
    }

    setSubscribing(true);
    try {
      // Call the parent callback with plan details
      await onSubscribe(selectedPlanId, addressString);
    } catch (err) {
      console.error('Subscription error:', err);
      toast.error('An error occurred. Please try again.');
      setSubscribing(false);
    }
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
                const isSelected = selectedPlanId === plan.id;
                const period = plan.frequency === 'weekly' ? '/week' : '/month';
                const bottleLabel = plan.frequency === 'weekly'
                  ? `${plan.bottle_count} bottles/week`
                  : `${plan.bottle_count} bottles/month`;

                return (
                  <button
                    key={plan.id}
                    onClick={() => setSelectedPlanId(plan.id)}
                    className={`w-full text-left rounded-2xl border-2 p-4 transition-all ${
                      isSelected
                        ? 'border-primary bg-primary/5 shadow-md'
                        : isHighlighted
                        ? 'border-primary/30 bg-card'
                        : 'border-border/50 bg-card'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <div className="flex items-center gap-2 mb-0.5">
                          <Icon className={`w-4 h-4 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`} />
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

            {/* Address Input — Only show if a plan is selected */}
            {selectedPlanId && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-4 space-y-3 bg-card/50 rounded-2xl p-4 border border-border/40"
              >
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block">
                  Delivery Address
                </label>
                <AddressAutocomplete
                  value={address}
                  onChange={addr => {
                    setAddress(addr);
                    calculateDistance(addr);
                  }}
                  placeholder="123 Main St"
                  className="rounded-xl h-10"
                />

                {/* Zone Result */}
                <AnimatePresence>
                  {calculatedZone && subscriptionDeliveryEligible && (
                    <motion.div
                      initial={{ opacity: 0, y: -5 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-primary/5 border border-primary/20 rounded-lg p-2.5 flex items-start gap-2"
                    >
                      <MapPin className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                      <div className="text-xs">
                        {calculatedDistance !== null && (
                          <p className="text-muted-foreground">{calculatedDistance.toFixed(1)} miles away</p>
                        )}
                        <p className="font-semibold text-primary">
                          {calculatedZone.delivery_fee == null
                            ? calculatedZone.zone_tier_label
                            : `$${Number(calculatedZone.delivery_fee).toFixed(2)} delivery fee`}
                        </p>
                      </div>
                    </motion.div>
                  )}
                  {calculatedZone && !subscriptionDeliveryEligible && (
                    <motion.div
                      initial={{ opacity: 0, y: -5 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-3 flex items-start gap-2"
                    >
                      <MapPin className="w-3.5 h-3.5 text-cyan-600 shrink-0 mt-0.5" />
                      <div className="text-xs">
                        <p className="font-semibold text-cyan-900">
                          {calculatedZone.zone_type === 'route_review' ? 'Route Review Required' : 'Delivery Not Yet Available'}
                        </p>
                        <p className="text-cyan-700 mt-0.5">{calculatedZone.customer_message}</p>
                        {calculatedZone.zone_type === 'waitlist_only' && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="mt-2 border-cyan-500/40 text-cyan-600 hover:bg-cyan-50 h-8"
                            onClick={() => setShowOutOfArea(true)}
                          >
                            Join the Waitlist
                          </Button>
                        )}
                      </div>
                    </motion.div>
                  )}
                  {calculating && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Calculating...
                    </div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}

            {/* One-time Option */}
            <button
              onClick={onOneTime}
              className="w-full py-3.5 rounded-xl border border-border/50 text-sm font-medium text-muted-foreground hover:text-foreground hover:border-border transition-all mb-3"
            >
              No thanks — one-time purchase (${programTotal})
            </button>

            {/* Subscribe Button */}
            {selectedPlanId && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
              >
                <Button
                  onClick={handleSubscribe}
                  disabled={subscribing || !address.street.trim() || calculating || !subscriptionDeliveryEligible}
                  className="w-full h-11 rounded-xl font-semibold text-sm mb-2"
                >
                  {subscribing ? 'Redirecting to payment...' : `Subscribe — $${selectedPlan?.base_price}${selectedPlan?.frequency === 'weekly' ? '/week' : '/month'}`}
                </Button>
              </motion.div>
            )}

            {/* Out of Area Modal */}
            {showOutOfArea && (
              <OutOfAreaModal
                address={addressString}
                zip={address.zip}
                onClose={() => setShowOutOfArea(false)}
              />
            )}

            <p className="text-center text-[10px] text-muted-foreground">
              Cancel anytime. No fees, no penalties.
            </p>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
