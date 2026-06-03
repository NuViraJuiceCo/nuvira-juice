import React, { useState } from 'react';
import SEO from '@/components/SEO';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';

const HERO_URL = "https://media.base44.com/images/public/69d48d0c39891f7945481152/80af61b53_DSC02560.jpg";
const AURA_URL = "https://media.base44.com/images/public/69d48d0c39891f7945481152/99a63a91c_DSC02712.jpg";
const RENU_URL = "https://media.base44.com/images/public/69d48d0c39891f7945481152/3e9fe43e6_DSC02709.jpg";

const sections = [
  {
    title: 'Cold-Pressed, Never Compromised',
    body: `Cold-pressing is the highest standard of juice production. Unlike conventional juicing, cold-pressing uses hydraulic pressure — never heat — to extract every ounce of nutrition from fresh produce.\n\nHeat destroys enzymes and degrades vitamins. Cold-pressing preserves them. What you get is a living, nutrient-dense juice that works the way nature intended.`,
  },
  {
    title: 'Made to Order. Never Mass-Produced.',
    body: `Every NuVira juice is made in small batches for your specific order. We don't stock thousands of bottles on a warehouse shelf. We craft fresh for your production window and deliver straight to you.\n\nFreshness isn't a claim we make — it's the foundation we build on.`,
  },
  {
    title: 'Real Ingredients. No Shortcuts.',
    body: `Read our labels. You'll recognize everything on them. No concentrates. No added sugars. No artificial preservatives. No fillers of any kind.\n\nJust real, whole produce — selected for nutritional value and flavor — pressed fresh and bottled immediately.`,
  },
  {
    title: 'Wellness That Fits Real Life',
    body: `We built NuVira for people who care about their health but live full, busy lives. Our ordering system is designed around your schedule — order when it works, receive your juice on your next delivery window, and make premium wellness part of your everyday routine without friction.`,
  },
  {
    title: 'How to Store Your NuVira Juice',
    body: `Keep refrigerated at all times. Best enjoyed chilled — shake gently before drinking.\n\nFor maximum freshness and nutritional potency, consume within 3–5 days of delivery. Because there are no preservatives, freshness window is intentionally short — that's how you know it's real.`,
  },
];

function AccordionItem({ title, body }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-border/40 last:border-0">
      <button
        className="w-full flex items-center justify-between py-4 text-left"
        onClick={() => setOpen(o => !o)}
      >
        <span className="font-medium text-sm pr-4">{title}</span>
        <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <p className="text-xs text-muted-foreground leading-relaxed pb-4 whitespace-pre-line">
              {body}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function WhyNuVira() {
  return (
    <div className="min-h-screen bg-background">
      <SEO
        title="Why NuVira"
        description="Cold-pressed, never compromised. Learn why NuVira's small-batch, made-to-order juices set the standard in living nutrition."
      />
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border/40 flex items-center gap-3 px-4 py-3">
        <Link to="/account">
          <button className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-muted transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
        </Link>
        <span className="font-heading text-base font-semibold">Why NuVira</span>
      </div>

      {/* Hero */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="relative h-52 overflow-hidden"
      >
        <img src={HERO_URL} alt="NuVira juices" className="w-full h-full object-cover object-[center_25%]" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-background/95" />
        <div className="absolute bottom-4 left-5">
          <p className="font-heading text-2xl font-bold text-foreground">Why NuVira?</p>
          <p className="text-xs text-muted-foreground mt-0.5">The philosophy behind every bottle.</p>
        </div>
      </motion.div>

      <div className="px-5 py-6 space-y-8">
        {/* Intro */}
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="text-sm text-muted-foreground leading-relaxed"
        >
          We built NuVira because we believed premium, cold-pressed wellness should be accessible — and that real nutrition shouldn't require a compromise. Here's what sets every bottle apart.
        </motion.p>

        {/* Product Spotlight */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="grid grid-cols-2 gap-3"
        >
          <div className="rounded-2xl overflow-hidden relative h-40">
            <img src={AURA_URL} alt="AURA" className="w-full h-full object-cover object-[center_50%]" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
            <div className="absolute bottom-2 left-3">
              <p className="text-white font-bold text-sm">Radiance</p>
              <p className="text-white/70 text-[10px]">Glow from within.</p>
            </div>
          </div>
          <div className="rounded-2xl overflow-hidden relative h-40">
            <img src={RENU_URL} alt="RE-NU" className="w-full h-full object-cover object-[center_50%]" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
            <div className="absolute bottom-2 left-3">
              <p className="text-white font-bold text-sm">Reset</p>
              <p className="text-white/70 text-[10px]">Refresh & renew.</p>
            </div>
          </div>
        </motion.div>

        {/* Accordion */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="nuvira-premium-card rounded-2xl px-4"
        >
          {sections.map(s => <AccordionItem key={s.title} {...s} />)}
        </motion.div>

        {/* CTA */}
        <div className="text-center pb-4">
          <Link to="/shop">
            <Button className="nuvira-gradient-button rounded-full px-8">Shop Now</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
