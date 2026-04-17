import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Leaf, ArrowLeft, Package, DollarSign, CheckCircle, Camera, Truck, HelpCircle } from 'lucide-react';
import SEO from '@/components/SEO';

const steps = [
  {
    icon: Package,
    title: 'Keep Your Bag',
    desc: 'After your delivery, hold onto your NuVira insulated bag — small or tote.',
  },
  {
    icon: CheckCircle,
    title: 'Request a Return',
    desc: 'At checkout, select how many bags you\'d like to return with your next order.',
  },
  {
    icon: Truck,
    title: 'Hand It to Your Driver',
    desc: 'When your next delivery arrives, hand the clean bag(s) to your driver.',
  },
  {
    icon: DollarSign,
    title: 'Earn Store Credit',
    desc: 'Credits are applied to your NuVira wallet automatically after verification.',
  },
];

const credits = [
  { type: 'Small Insulated Bag', amount: '$1.00', note: 'Per bag returned' },
  { type: 'Large Tote Bag', amount: '$2.00', note: 'Per bag returned' },
];

const faqs = [
  {
    q: 'What condition does the bag need to be in?',
    a: 'Bags should be clean, dry, and free of strong odors or damage. Dirty or damaged bags may not be accepted.',
  },
  {
    q: 'When do I receive my credit?',
    a: 'Credits are added to your NuVira wallet within 24 hours of your driver verifying the return.',
  },
  {
    q: 'Can I return multiple bags at once?',
    a: 'Yes! You can return as many bags as you have from previous orders.',
  },
  {
    q: 'Where can I use my credits?',
    a: 'NuVira credits can be applied toward any future order at checkout.',
  },
  {
    q: 'What if my driver doesn\'t take the bag?',
    a: 'Reach out to us via the Support page and we\'ll make it right.',
  },
];

export default function ReturnReward() {
  const navigate = useNavigate();

  return (
    <div className="pb-10">
      <SEO title="Return + Reward — Sustainability Program" description="Return your NuVira bags and earn store credit. The NuVira Way — sustainability built into every delivery." />

      {/* Header */}
      <div
        className="bg-primary px-4 pb-8 relative overflow-hidden"
        style={{ paddingTop: 'max(1.25rem, env(safe-area-inset-top))' }}
      >
        <div className="absolute -top-8 -right-8 w-40 h-40 bg-white/5 rounded-full" />
        <div className="absolute -bottom-6 -left-4 w-24 h-24 bg-white/5 rounded-full" />

        <button
          onClick={() => navigate(-1)}
          className="w-9 h-9 bg-white/15 rounded-full flex items-center justify-center mb-4"
        >
          <ArrowLeft className="w-4 h-4 text-white" />
        </button>

        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 bg-white/15 rounded-xl flex items-center justify-center">
            <Leaf className="w-5 h-5 text-white" />
          </div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-white/60">Sustainability</p>
        </div>
        <h1 className="font-heading text-3xl font-bold text-white leading-tight">Return + Reward</h1>
        <p className="text-white/70 text-sm mt-1">The NuVira Way</p>
        <p className="text-white/80 text-sm mt-3 leading-relaxed">
          Return your NuVira bags when we deliver — earn store credit and help us reduce waste together.
        </p>
      </div>

      {/* How it works */}
      <div className="px-4 mt-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">How It Works</p>
        <div className="space-y-3">
          {steps.map(({ icon: Icon, title, desc }, i) => (
            <motion.div
              key={title}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.08 }}
              className="flex items-start gap-4 bg-card border border-border/50 rounded-xl p-4"
            >
              <div className="w-9 h-9 bg-primary/10 rounded-lg flex items-center justify-center shrink-0 mt-0.5">
                <Icon className="w-4 h-4 text-primary" />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[10px] font-bold text-primary bg-primary/10 w-5 h-5 rounded-full flex items-center justify-center">{i + 1}</span>
                  <p className="text-sm font-semibold">{title}</p>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Credit values */}
      <div className="px-4 mt-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Credit Values</p>
        <div className="grid grid-cols-2 gap-3">
          {credits.map(({ type, amount, note }) => (
            <div key={type} className="bg-primary/5 border border-primary/15 rounded-xl p-4 text-center">
              <p className="font-heading text-2xl font-bold text-primary">{amount}</p>
              <p className="text-xs font-semibold mt-1">{type}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{note}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Eligibility */}
      <div className="px-4 mt-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Bag Eligibility</p>
        <div className="bg-card border border-border/50 rounded-xl p-4 space-y-2">
          {['Clean and dry', 'No strong odors', 'No tears or damage', 'Original NuVira packaging'].map((item) => (
            <div key={item} className="flex items-center gap-2">
              <CheckCircle className="w-3.5 h-3.5 text-primary shrink-0" />
              <p className="text-sm">{item}</p>
            </div>
          ))}
        </div>
      </div>

      {/* FAQ */}
      <div className="px-4 mt-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">FAQs</p>
        <div className="space-y-3">
          {faqs.map(({ q, a }) => (
            <div key={q} className="bg-card border border-border/50 rounded-xl p-4">
              <div className="flex items-start gap-2 mb-1">
                <HelpCircle className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                <p className="text-sm font-semibold">{q}</p>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed pl-5">{a}</p>
            </div>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div className="px-4 mt-8">
        <Link to="/account/orders">
          <div className="bg-primary rounded-2xl p-5 text-center">
            <Leaf className="w-6 h-6 text-white mx-auto mb-2" />
            <p className="font-heading text-lg font-bold text-white">Check Your Credits</p>
            <p className="text-white/70 text-xs mt-1">View your balance in your account</p>
          </div>
        </Link>
      </div>
    </div>
  );
}