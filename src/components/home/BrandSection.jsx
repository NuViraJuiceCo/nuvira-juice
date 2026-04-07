import React from 'react';
import { Link } from 'react-router-dom';
import { Leaf, Heart, Sparkles, ChevronRight } from 'lucide-react';
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
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 }}
      className="mt-8 mx-4 mb-4 space-y-4"
    >
      {/* NuVira Difference */}
      <div className="relative rounded-2xl overflow-hidden">
        <img src={TRIO_URL} alt="NuVira Juices" className="w-full h-32 object-cover" />
        <div className="absolute inset-0 bg-primary/80" />
        <div className="absolute inset-0 p-4">
          <p className="font-heading text-primary-foreground font-bold text-base mb-3">
            The NuVira Difference
          </p>
          <div className="grid grid-cols-3 gap-2">
            {values.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="text-center">
                <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-1">
                  <Icon className="w-3.5 h-3.5 text-white" />
                </div>
                <p className="text-white text-[10px] font-semibold">{title}</p>
                <p className="text-white/70 text-[9px]">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Brand Nav Links */}
      <div className="bg-card border border-border/40 rounded-2xl overflow-hidden divide-y divide-border/40">
        {brandLinks.map(({ label, to, desc }) => (
          <Link key={to} to={to}>
            <div className="flex items-center justify-between px-4 py-3.5 hover:bg-muted/50 transition-colors">
              <div>
                <p className="text-sm font-medium">{label}</p>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </div>
          </Link>
        ))}
      </div>
    </motion.div>
  );
}