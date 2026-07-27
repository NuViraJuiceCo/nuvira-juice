import React from 'react';
import { Link } from 'react-router-dom';
import { Leaf, Heart, Sparkles, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { BRAND_IMAGES } from '@/lib/brandImages';

const values = [
  { icon: Leaf, title: 'Cold-Pressed', desc: '100% raw, never heated' },
  { icon: Heart, title: 'Made Fresh', desc: 'Small-batch, to order' },
  { icon: Sparkles, title: 'No Shortcuts', desc: 'Real ingredients only' },
];

const brandLinks = [
  { label: 'Our Story', to: '/our-story', desc: 'The NuVira origin and mission' },
  { label: 'Why NuVira', to: '/why-nuvira', desc: 'The philosophy behind every bottle' },
  { label: 'Events & Community', to: '/events', desc: 'STL pop-ups, drops & more' },
];

export default function BrandSection() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5 }}
      className="mt-8 mb-4 space-y-5"
    >
      <div className="mx-5 overflow-hidden rounded-2xl border border-border/50 bg-card shadow-md">
        <div className="grid h-[164px] grid-cols-[1.1fr_0.9fr] sm:h-[172px] lg:h-[176px]">
          <div className="p-4 sm:p-5 flex flex-col justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary/80">Fresh by design</p>
              <p className="mt-2 font-heading text-lg font-bold leading-tight text-foreground">
                Local cold-pressed juice, made around your order.
              </p>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              For delivery days, events, and everyday routines.
            </p>
          </div>
          <div className="relative overflow-hidden">
            <img
              src={BRAND_IMAGES.eventCollateral}
              alt="NuVira menu and local delivery cards on an event table"
              className="h-full w-full object-cover object-[44%_50%]"
              loading="lazy"
            />
            <div className="absolute inset-0 bg-gradient-to-l from-transparent via-transparent to-card/35" />
          </div>
        </div>
      </div>

      {/* NuVira Difference — values only, no photo bg */}
      <div className="mx-5">
        <div className="bg-card border border-border/50 rounded-2xl p-4 shadow-md" style={{ background: `linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)` }}>
          <p className="font-heading font-bold text-base mb-0.5">The NuVira Difference</p>
          <p className="text-[10px] text-muted-foreground mb-4">No fillers. No compromises.</p>
          <div className="grid grid-cols-3 gap-3">
            {values.map(({ icon: Icon, title, desc }, i) => (
              <motion.div
                key={title}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="text-center"
              >
                <div className="w-9 h-9 bg-primary/10 rounded-xl flex items-center justify-center mx-auto mb-1.5">
                  <Icon className="w-4 h-4 text-primary" />
                </div>
                <p className="text-foreground text-[10px] font-bold">{title}</p>
                <p className="text-muted-foreground text-[9px] leading-tight">{desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </div>

      {/* Brand Nav Links */}
      <div className="mx-5 bg-card border border-border/50 rounded-2xl overflow-hidden divide-y divide-border/50 shadow-md" style={{ background: `linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.01) 100%)` }}>
        {brandLinks.map(({ label, to, desc }, i) => (
          <motion.div
            key={to}
            initial={{ opacity: 0, x: -10 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.08 }}
          >
            <Link to={to}>
              <div className="flex items-center justify-between px-4 py-3.5 active:bg-muted/50 transition-colors">
                <div>
                  <p className="text-sm font-semibold">{label}</p>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                </div>
                <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
                  <ArrowRight className="w-3.5 h-3.5 text-primary" />
                </div>
              </div>
            </Link>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}
