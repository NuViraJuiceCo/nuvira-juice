import React from 'react';
import { Link } from 'react-router-dom';
import { Leaf, Heart, Sparkles, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';

const TRIO_URL = "https://media.base44.com/images/public/69d48d0c39891f7945481152/801123d05_DSC02744.jpg";

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