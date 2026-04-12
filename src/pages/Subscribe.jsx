import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Check, Zap, Crown, Leaf, Truck, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { useQuery } from '@tanstack/react-query';

const LOGO_URL = "https://media.base44.com/images/public/69d48d0c39891f7945481152/b04d63077_Asset18322x.png";

const bundles = [
  {
    id: 'trio',
    name: 'The Trio',
    bottle_count: 3,
    description: 'One of each: AURA, RE-NU, OASIS',
    default: ['AURA', 'RE-NU', 'OASIS'],
  },
  {
    id: '3pack',
    name: 'Mix 3',
    bottle_count: 3,
    description: 'Choose your own 3-bottle mix',
    customizable: true,
  },
  {
    id: '6pack',
    name: 'Mix 6',
    bottle_count: 6,
    description: 'Default: 2 AURA, 2 RE-NU, 2 OASIS (customize anytime)',
    default: ['AURA', 'AURA', 'RE-NU', 'RE-NU', 'OASIS', 'OASIS'],
    customizable: true,
  },
  {
    id: '9pack',
    name: 'Mix 9',
    bottle_count: 9,
    description: 'Default: 3 AURA, 3 RE-NU, 3 OASIS (customize anytime)',
    default: ['AURA', 'AURA', 'AURA', 'RE-NU', 'RE-NU', 'RE-NU', 'OASIS', 'OASIS', 'OASIS'],
    customizable: true,
  },
];

const deliveryZones = [
  { id: 'zone1', name: 'Within 5 miles', miles: 5, fee: 3.99 },
  { id: 'zone2', name: 'Within 10 miles', miles: 10, fee: 5.99 },
  { id: 'zone3', name: 'Within 15 miles', miles: 15, fee: 7.99 },
];

const plans = [
  {
    id: 'weekly',
    icon: Leaf,
    name: 'Weekly Fresh',
    price: '$36',
    period: '/week',
    savings: null,
    badge: null,
    color: 'border-border/50',
    bg: 'bg-card',
    perks: [
      'The NuVira Trio delivered weekly',
      'Fresh-pressed to your schedule',
      'Skip or pause anytime',
      'Member-only order priority',
    ],
  },
  {
    id: 'monthly',
    icon: Zap,
    name: 'Monthly Ritual',
    price: '$129',
    period: '/month',
    savings: 'Save 8%',
    badge: 'Most Popular',
    color: 'border-primary',
    bg: 'bg-primary/5',
    perks: [
      '12 bottles per month (mix & match)',
      'Free delivery every order',
      '8% off all orders',
      'Early access to new drops',
      'Skip or pause anytime',
      'Member-only notifications',
    ],
  },
  {
    id: 'vip',
    icon: Crown,
    name: 'VIP Wellness',
    price: '$229',
    period: '/month',
    savings: 'Save 15%',
    badge: 'Best Value',
    color: 'border-accent',
    bg: 'bg-accent/5',
    perks: [
      '24 bottles per month (mix & match)',
      'Free delivery always',
      '15% off all orders',
      'First access to every seasonal drop',
      'NuVira merch discount (when live)',
      'VIP event invites',
      'Dedicated support',
      'Birthday bonus bottle',
    ],
  },
];

export default function Subscribe() {
  const { user } = useAuth();
  const [selected, setSelected] = useState('monthly');
  const [selectedBundle, setSelectedBundle] = useState('trio');
  const [address, setAddress] = useState('');
  const [calculatedZone, setCalculatedZone] = useState(null);
  const [calculatedDistance, setCalculatedDistance] = useState(null);
  const [loading, setLoading] = useState(false);
  const [calculating, setCalculating] = useState(false);

  const calculateDistance = async (addr) => {
    if (!addr.trim() || addr.length < 5) return;
    setCalculating(true);
    const res = await base44.functions.invoke('calculateDeliveryZone', { address: addr });
    setCalculatedDistance(res.data.distance);
    setCalculatedZone(res.data.zone);
    setCalculating(false);
  };

  const handleJoin = async () => {
    if (window.self !== window.top) {
      alert('Checkout only works from the published app, not the preview.');
      return;
    }
    if (!address.trim()) {
      toast.error('Please enter your delivery address');
      return;
    }
    if (!calculatedZone) {
      toast.error('Please wait for distance calculation or enter a valid address');
      return;
    }
    const plan = plans.find(p => p.id === selected);
    const bundle = bundles.find(b => b.id === selectedBundle);
    setLoading(true);
    const res = await base44.functions.invoke('createSubscriptionSession', {
      plan_id: selected,
      bundle_id: selectedBundle,
      address,
      customer_email: user?.email || null,
    });
    if (res.data?.url) {
      window.location.href = res.data.url;
    } else {
      toast.error(res.data?.error || 'Failed to start checkout. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background pb-10">
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

      {/* Bundles Section */}
      <div className="px-4 mt-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Choose Your Bundle</p>
        <div className="space-y-2">
          {bundles.map(bundle => (
            <motion.button
              key={bundle.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              onClick={() => setSelectedBundle(bundle.id)}
              className={`w-full text-left rounded-xl border-2 p-3 transition-all ${
                selectedBundle === bundle.id
                  ? 'border-primary bg-primary/5'
                  : 'border-border/40 bg-card'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <p className="font-semibold text-sm">{bundle.name}</p>
                  <p className="text-xs text-muted-foreground leading-snug">{bundle.description}</p>
                </div>
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ml-2 ${
                  selectedBundle === bundle.id ? 'border-primary bg-primary' : 'border-border'
                }`}>
                  {selectedBundle === bundle.id && <Check className="w-3 h-3 text-white" />}
                </div>
              </div>
            </motion.button>
          ))}
        </div>
      </div>

      {/* Address Section & Zone Calculation */}
      <div className="px-4 mt-6">
        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-2">Delivery Address</label>
        <Input
          value={address}
          onChange={e => {
            setAddress(e.target.value);
            calculateDistance(e.target.value);
          }}
          placeholder="123 Main St, St. Louis, MO"
          className="rounded-xl h-11"
        />
      </div>

      {/* Delivery Zone Result */}
      {calculatedZone && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="px-4 mt-4 bg-primary/5 border border-primary/20 rounded-xl p-4"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-primary" />
              <span className="font-semibold text-sm">Delivery Calculated</span>
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{calculatedDistance?.toFixed(1)} miles from our location</p>
            <p className="text-sm font-semibold">{deliveryZones.find(z => z.id === calculatedZone)?.name} — ${deliveryZones.find(z => z.id === calculatedZone)?.fee.toFixed(2)} delivery fee</p>
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
        {plans.map(({ id, icon: Icon, name, price, period, savings, badge, color, bg, perks }, i) => (
          <motion.button
            key={id}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
            onClick={() => setSelected(id)}
            className={`w-full text-left rounded-2xl border-2 p-4 transition-all ${color} ${bg} ${selected === id ? 'shadow-md' : 'opacity-80'}`}
          >
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${selected === id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div>
                  <p className="font-semibold text-sm">{name}</p>
                  {savings && <p className="text-[10px] text-primary font-medium">{savings}</p>}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                {badge && (
                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${id === 'vip' ? 'bg-accent/20 text-accent-foreground' : 'bg-primary/15 text-primary'}`}>
                    {badge}
                  </span>
                )}
                <div className="text-right">
                  <span className="font-heading text-lg font-bold">{price}</span>
                  <span className="text-xs text-muted-foreground">{period}</span>
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              {perks.map(perk => (
                <div key={perk} className="flex items-start gap-2">
                  <Check className="w-3 h-3 text-primary mt-0.5 shrink-0" />
                  <span className="text-xs text-muted-foreground leading-snug">{perk}</span>
                </div>
              ))}
            </div>
            {/* Selection indicator */}
            <div className={`mt-3 h-0.5 rounded-full transition-all ${selected === id ? 'bg-primary' : 'bg-transparent'}`} />
          </motion.button>
        ))}
      </div>

      {/* CTA */}
      <div className="px-4 mt-6 space-y-3">
        <Button
          onClick={handleJoin}
          disabled={loading}
          className="w-full h-12 rounded-xl font-semibold text-sm"
        >
          {loading ? 'Redirecting to payment...' : `Subscribe — ${plans.find(p => p.id === selected)?.price}${plans.find(p => p.id === selected)?.period}`}
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