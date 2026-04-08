import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Check, Zap, Crown, Leaf } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';

const LOGO_URL = "https://media.base44.com/images/public/69d48d0c39891f7945481152/b04d63077_Asset18322x.png";

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
  const [loading, setLoading] = useState(false);

  const handleJoin = async () => {
    const plan = plans.find(p => p.id === selected);
    setLoading(true);
    await base44.integrations.Core.SendEmail({
      to: 'nuvirajuiceco@gmail.com',
      subject: `New Subscription Request — ${plan.name}`,
      body: `${user?.full_name || 'A customer'} (${user?.email}) wants to subscribe to the ${plan.name} plan (${plan.price}${plan.period}).`,
    });
    setLoading(false);
    toast.success("We received your request! Our team will reach out within 24 hours to finalize your subscription.");
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

      {/* Plans */}
      <div className="px-4 mt-2 space-y-3">
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
      <div className="px-4 mt-5 space-y-3">
        <Button
          onClick={handleJoin}
          disabled={loading}
          className="w-full h-12 rounded-xl font-semibold text-sm"
        >
          {loading ? 'Sending...' : `Join ${plans.find(p => p.id === selected)?.name}`}
        </Button>
        <p className="text-center text-[10px] text-muted-foreground leading-relaxed">
          No commitments. Skip, pause, or cancel anytime.
          Our team will contact you to confirm your first delivery window.
        </p>
      </div>

      {/* FAQ */}
      <div className="px-4 mt-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">FAQs</p>
        <div className="space-y-3">
          {[
            { q: 'When will I be charged?', a: 'Billing happens at the start of each cycle. Our team will set up your billing when confirming your subscription.' },
            { q: 'Can I choose my juices?', a: 'Yes — Monthly and VIP members can mix & match AURA, RE-NU, and OASIS for each delivery.' },
            { q: 'How do I pause or cancel?', a: 'Email us or message support anytime. No fees, no penalties. We believe in flexibility.' },
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