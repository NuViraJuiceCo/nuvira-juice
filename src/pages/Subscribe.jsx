import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Check, Zap, Crown, Leaf, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import AddressAutocomplete from '@/components/AddressAutocomplete';
import OutOfAreaModal from '@/components/checkout/OutOfAreaModal';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { useQuery } from '@tanstack/react-query';

const LOGO_URL = "https://media.base44.com/images/public/69d48d0c39891f7945481152/b04d63077_Asset18322x.png";

const PLAN_ICONS = { 0: Leaf, 1: Zap, 2: Crown };
const PLAN_STYLES = [
  { color: 'border-border/50', bg: 'bg-card', badge: null },
  { color: 'border-primary', bg: 'bg-primary/5', badge: 'Most Popular' },
  { color: 'border-accent', bg: 'bg-accent/5', badge: 'Best Value' },
];

export default function Subscribe() {
  const { user } = useAuth();
  const [selectedPlanId, setSelectedPlanId] = useState(null);
  const [address, setAddress] = useState({ street: '', city: '', state: '', zip: '' });
  const [calculatedZone, setCalculatedZone] = useState(null);
  const [calculatedDistance, setCalculatedDistance] = useState(null);
  const [loading, setLoading] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [showOutOfArea, setShowOutOfArea] = useState(false);
  const debounceRef = useRef(null);

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

  const calculateDistance = (addr) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setCalculatedZone(null);
    setCalculatedDistance(null);
    if (!addr || !addr.trim() || addr.length < 5) return;
    setCalculating(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await base44.functions.invoke('calculateDeliveryZone', { address: addr });
        setCalculatedDistance(res.data.distance);
        setCalculatedZone(res.data.zone);
      } catch (err) {
        // Out-of-area returns 400 with distance info — extract it
        const data = err?.response?.data;
        if (data?.distance !== undefined) {
          setCalculatedDistance(data.distance);
          setCalculatedZone(null); // out of area
        } else {
          setCalculatedDistance(null);
          setCalculatedZone(null);
        }
      } finally {
        setCalculating(false);
      }
    }, 800);
  };

  const selectedPlan = plans.find(p => p.id === selectedPlanId);

  const handleJoin = async () => {
    if (window.self !== window.top) {
      alert('Checkout only works from the published app, not the preview.');
      return;
    }
    const addressString = [address.street, address.city, address.state, address.zip].filter(Boolean).join(', ');
    if (!addressString.trim()) {
      toast.error('Please enter your delivery address');
      return;
    }
    if (calculating) {
      toast.error('Please wait while we verify your address');
      return;
    }
    // Always do a fresh live check on subscribe click
    setLoading(true);
    try {
      const zoneRes = await base44.functions.invoke('calculateDeliveryZone', { address: addressString });
      setCalculatedDistance(zoneRes.data.distance);
      setCalculatedZone(zoneRes.data.zone);
      if (!zoneRes.data.zone) {
        setShowOutOfArea(true);
        setLoading(false);
        return;
      }
    } catch (err) {
      const data = err?.response?.data;
      setCalculatedDistance(data?.distance ?? null);
      setCalculatedZone(null);
      setShowOutOfArea(true);
      setLoading(false);
      return;
    }
    if (!selectedPlanId) {
      toast.error('Please select a plan');
      return;
    }
    setLoading(true);
    try {
      const res = await base44.functions.invoke('createSubscriptionSession', {
        plan_id: selectedPlanId,
        bundle_id: null,
        address: addressString,
        customer_email: user?.email || null,
      });
      if (res.data?.url) {
        window.location.href = res.data.url;
      } else {
        console.error('Checkout session error:', res.data);
        toast.error(res.data?.error || 'Failed to start checkout. Please try again.');
        setLoading(false);
      }
    } catch (err) {
      console.error('Checkout error:', err);
      toast.error('An error occurred. Please try again.');
      setLoading(false);
    }
  };

  const addressString = [address.street, address.city, address.state, address.zip].filter(Boolean).join(', ');

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
      <div className="bg-gradient-to-b from-primary/15 to-transparent px-5 pt-6 pb-4 text-center">
        <img src={LOGO_URL} alt="NuVira" className="h-10 mx-auto mb-3" />
        <h1 className="font-heading text-2xl font-bold mb-1">Wellness on Autopilot</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Subscribe and never run out of the nutrition your body needs. Cancel or adjust anytime.
        </p>
      </div>

      {/* Address Section & Zone Calculation */}
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
                <p className="text-sm font-semibold text-destructive">We currently deliver within 20 miles of O'Fallon, MO</p>
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
          const style = PLAN_STYLES[i] || PLAN_STYLES[0];
          const isSelected = selectedPlanId === plan.id;
          const period = plan.frequency === 'weekly' ? '/week' : '/month';
          const savings = plan.discount_percent > 0 ? `Save ${plan.discount_percent}%` : null;
          return (
            <motion.button
              key={plan.id}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08 }}
              onClick={() => setSelectedPlanId(plan.id)}
              className={`w-full text-left rounded-2xl border-2 p-4 transition-all ${style.color} ${style.bg} ${isSelected ? 'shadow-md' : 'opacity-80'}`}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${isSelected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="font-semibold text-sm">{plan.name}</p>
                    <p className="text-xs font-semibold text-primary">
                      {plan.bottle_count} bottles{plan.frequency === 'weekly' ? '/week' : '/month'}
                      {plan.bottle_count > 3 && plan.frequency === 'monthly' ? ` · mix & match` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {style.badge && (
                    <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${i === 2 ? 'bg-accent/20 text-accent-foreground' : 'bg-primary/15 text-primary'}`}>
                      {style.badge}
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
              <div className={`mt-3 h-0.5 rounded-full transition-all ${isSelected ? 'bg-primary' : 'bg-transparent'}`} />
            </motion.button>
          );
        })}
      </div>

      {/* CTA */}
      <div className="px-4 mt-6 space-y-3">
        {!address.street.trim() && (
          <p className="text-center text-xs text-amber-600 font-medium">⚠ Enter your delivery address above to continue</p>
        )}
        {address.street.trim() && calculating && (
          <p className="text-center text-xs text-muted-foreground">Verifying your address...</p>
        )}
        <Button
          onClick={handleJoin}
          disabled={loading || !selectedPlanId || !address.street.trim() || calculating}
          className="w-full h-12 rounded-xl font-semibold text-sm"
        >
          {loading ? 'Redirecting to payment...' : `Subscribe — $${selectedPlan?.base_price}${selectedPlan?.frequency === 'weekly' ? '/week' : '/month'}`}
        </Button>
        <p className="text-center text-[10px] text-muted-foreground leading-relaxed">
          No commitments. Cancel anytime directly from your Stripe billing portal.
          Secured by Stripe — Apple Pay, Google Pay & all major cards accepted.
        </p>
      </div>

      {/* FAQ */}
      <div className="px-4 mt-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">FAQs</p>
        <div className="space-y-3">
          {[
            { q: 'When will I be charged?', a: 'Your card is charged immediately when you subscribe, then automatically on the same day each week or month.' },
            { q: 'Can I choose my juices?', a: 'Yes — Monthly and VIP members can mix & match AURA, RE-NU, and OASIS for each delivery.' },
            { q: 'How do I pause or cancel?', a: 'You can cancel anytime through your Stripe billing portal or by emailing us. No fees, no penalties.' },
            { q: 'What does "order priority" mean?', a: 'Subscribers get their orders pressed first within each delivery window — so your juice is always the freshest.' },
          ].map(({ q, a }) => (
            <div key={q} className="bg-card border border-border/40 rounded-xl p-4">
              <p className="text-sm font-medium mb-1">{q}</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{a}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}