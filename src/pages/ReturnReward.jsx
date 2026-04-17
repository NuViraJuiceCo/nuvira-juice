import React from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Leaf, ArrowLeft, Package, CheckCircle, Truck, DollarSign, HelpCircle } from 'lucide-react';
import SEO from '@/components/SEO';
import { useAuth } from '@/lib/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';

const steps = [
  {
    icon: Package,
    step: '01',
    title: 'Keep Your Bag',
    desc: 'After your delivery, hold onto your NuVira bag — small or tote.',
  },
  {
    icon: CheckCircle,
    step: '02',
    title: 'Request a Return',
    desc: 'At checkout, select how many bags you\'d like to return with your next order.',
  },
  {
    icon: Truck,
    step: '03',
    title: 'Leave It at Your Door',
    desc: 'Set the clean bag outside before your next delivery arrives. No hand-off needed.',
  },
  {
    icon: DollarSign,
    step: '04',
    title: 'Receive NuVira Credits',
    desc: 'Credits are added to your account automatically after our driver verifies the return.',
  },
];

const credits = [
  { type: 'Small Lunch Bag', amount: '$1', sub: 'Used for 3-bottle orders' },
  { type: 'Tote Bag', amount: '$2', sub: 'Used for 4–12 bottle orders' },
];

const eligibility = [
  'Clean and dry',
  'No strong odors',
  'No tears or damage',
  'Original NuVira bag',
];

const faqs = [
  {
    q: 'Do I need to hand the bag to the driver?',
    a: 'No. Simply leave the bag outside your door before your delivery arrives. Our driver will collect it.',
  },
  {
    q: 'When do I receive my credits?',
    a: 'Credits are added to your account within 24 hours after your driver verifies the return.',
  },
  {
    q: 'What condition does the bag need to be in?',
    a: 'Bags should be clean, dry, and free of odors or damage. Bags that do not meet these standards cannot be accepted.',
  },
  {
    q: 'Can I return multiple bags at once?',
    a: 'Yes. You can return as many bags as you have from previous orders.',
  },
  {
    q: 'Where can I use my NuVira Credits?',
    a: 'Credits are applied toward any future NuVira order at checkout.',
  },
  {
    q: 'What if my return is not found?',
    a: 'Reach out to us through the Support page and we\'ll look into it.',
  },
];

export default function ReturnReward() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const { data: creditData } = useQuery({
    queryKey: ['nuvira-credits-rr', user?.email],
    queryFn: async () => {
      const res = await base44.entities.NuViraCredit.filter({ customer_email: user?.email });
      return res[0] || null;
    },
    enabled: !!user?.email,
  });

  const balance = creditData?.balance || 0;
  const lifetimeEarned = creditData?.lifetime_earned || 0;

  return (
    <div className="pb-12">
      <SEO
        title="Return + Reward"
        description="Leave your NuVira bag outside on your next delivery and earn NuVira Credits. Sustainability, The NuVira Way."
      />

      {/* Hero */}
      <div
        className="bg-primary relative overflow-hidden"
        style={{ paddingTop: 'max(1.25rem, env(safe-area-inset-top))' }}
      >
        <div className="absolute -top-12 -right-12 w-48 h-48 bg-white/5 rounded-full" />
        <div className="absolute bottom-0 left-0 w-32 h-32 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/2" />

        <div className="relative px-5 pb-10">
          <button
            onClick={() => navigate(-1)}
            className="w-9 h-9 bg-white/15 backdrop-blur-sm rounded-full flex items-center justify-center mb-6"
          >
            <ArrowLeft className="w-4 h-4 text-white" />
          </button>

          <div className="inline-flex items-center gap-2 bg-white/10 rounded-full px-3 py-1.5 mb-4">
            <Leaf className="w-3 h-3 text-white/80" />
            <p className="text-[10px] font-bold uppercase tracking-widest text-white/80">Sustainability</p>
          </div>

          <h1 className="font-heading text-4xl font-bold text-white leading-tight mb-2">
            Return + Reward
          </h1>
          <p className="text-white/60 text-sm font-medium mb-4">Return. Refresh. Reuse.</p>
          <p className="text-white/75 text-sm leading-relaxed max-w-sm">
            Return your NuVira bags with your next delivery. We verify, then add NuVira Credits to your account — no extra steps needed.
          </p>
        </div>
      </div>

      {/* How it works */}
      <div className="px-5 mt-8">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-4">How It Works</p>
        <div className="space-y-3">
          {steps.map(({ icon: Icon, step, title, desc }, i) => (
            <motion.div
              key={step}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.07 }}
              className="bg-card border border-border/50 rounded-2xl p-4 flex items-start gap-4"
            >
              <div className="shrink-0 w-10 h-10 bg-primary/8 rounded-xl flex items-center justify-center mt-0.5">
                {React.createElement(Icon, { className: 'w-4 h-4 text-primary' })}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-bold text-primary/60">{step}</span>
                  <p className="text-sm font-semibold">{title}</p>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Credit values */}
      <div className="px-5 mt-8">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-4">NuVira Credit Values</p>
        <div className="grid grid-cols-2 gap-3">
          {credits.map(({ type, amount, sub }) => (
            <div key={type} className="bg-card border border-border/50 rounded-2xl p-4 text-center">
              <p className="font-heading text-3xl font-bold text-primary mb-1">{amount}</p>
              <p className="text-xs font-semibold">{type}</p>
              <p className="text-[10px] text-muted-foreground mt-1 leading-tight">{sub}</p>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground text-center mt-3">
          Credit applied after driver verification. Not redeemable as cash.
        </p>
      </div>

      {/* Eligibility */}
      <div className="px-5 mt-8">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-4">Bag Eligibility</p>
        <div className="bg-card border border-border/50 rounded-2xl p-4 space-y-3">
          {eligibility.map((item) => (
            <div key={item} className="flex items-center gap-3">
              <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <CheckCircle className="w-3 h-3 text-primary" />
              </div>
              <p className="text-sm">{item}</p>
            </div>
          ))}
        </div>
      </div>

      {/* FAQ */}
      <div className="px-5 mt-8">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-4">Frequently Asked</p>
        <div className="space-y-2">
          {faqs.map(({ q, a }) => (
            <div key={q} className="bg-card border border-border/50 rounded-2xl p-4">
              <div className="flex items-start gap-2.5 mb-1.5">
                <HelpCircle className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                <p className="text-sm font-semibold">{q}</p>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed pl-6">{a}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Credit Balance CTA */}
      <div className="px-5 mt-10">
        {user ? (
          <Link to="/account">
            <div className="bg-primary rounded-2xl p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Leaf className="w-4 h-4 text-primary-foreground/60" />
                  <p className="text-[10px] font-bold uppercase tracking-widest text-primary-foreground/60">Your NuVira Credits</p>
                </div>
                <p className="text-[10px] text-primary-foreground/50 font-medium">View account →</p>
              </div>
              <div className="flex items-end justify-between">
                <div>
                  <p className="font-heading text-4xl font-bold text-white">${balance.toFixed(2)}</p>
                  <p className="text-white/50 text-xs mt-0.5">Available balance</p>
                </div>
                {lifetimeEarned > 0 && (
                  <div className="text-right">
                    <p className="text-white/80 text-sm font-semibold">${lifetimeEarned.toFixed(2)}</p>
                    <p className="text-white/40 text-[10px]">lifetime earned</p>
                  </div>
                )}
              </div>
              {balance === 0 && (
                <p className="text-white/50 text-xs mt-3 leading-relaxed">
                  No credits yet — select a bag return at your next checkout to get started.
                </p>
              )}
            </div>
          </Link>
        ) : (
          <button
            onClick={() => base44.auth.redirectToLogin('/return-reward')}
            className="w-full bg-primary rounded-2xl p-5 flex items-center gap-4 text-left"
          >
            <div className="w-10 h-10 bg-white/15 rounded-xl flex items-center justify-center shrink-0">
              <Leaf className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="font-heading text-base font-bold text-white">Sign In to View Credits</p>
              <p className="text-white/60 text-xs mt-0.5">Track your NuVira Credit balance</p>
            </div>
          </button>
        )}
        <p className="text-center text-[10px] text-muted-foreground mt-4">Sustainability, The NuVira Way</p>
      </div>
    </div>
  );
}