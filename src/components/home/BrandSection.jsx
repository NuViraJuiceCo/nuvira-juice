import React from 'react';
import { Link } from 'react-router-dom';
import { Leaf, Heart, Sparkles, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';

const TRIO_URL = "https://media.base44.com/images/public/69d48d0c39891f7945481152/99e225ed4_DSC02438-Edit-2.jpg";

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
      {/* NuVira Difference */}
      <div className="mx-4">
        <div className="relative rounded-2xl overflow-hidden">
          <img src={TRIO_URL} alt="NuVira Juices" className="w-full h-36 object-cover" />
          <div className="absolute inset-0 bg-gradient-to-br from-primary/90 via-primary/75 to-primary/50" />
          <div className="absolute inset-0 p-4 flex flex-col justify-between">
            <p className="font-heading text-primary-foreground font-bold text-lg leading-tight">
              The NuVira Difference
            </p>
            <div className="grid grid-cols-3 gap-2">
              {values.map(({ icon: Icon, title, desc }, i) => (
                <motion.div
                  key={title}
                  initial={{ opacity: 0, y: 10 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                  className="text-center"
                >
                  <div className="w-9 h-9 bg-white/20 rounded-xl flex items-center justify-center mx-auto mb-1.5 backdrop-blur-sm">
                    <Icon className="w-4 h-4 text-white" />
                  </div>
                  <p className="text-white text-[10px] font-bold">{title}</p>
                  <p className="text-white/70 text-[9px] leading-tight">{desc}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Brand Nav Links */}
      <div className="mx-4 bg-card border border-border/40 rounded-2xl overflow-hidden divide-y divide-border/40">
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