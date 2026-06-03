import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Leaf, Truck, Star, Sparkles, ArrowRight } from 'lucide-react';
import MobileCarousel from '@/components/carousel/MobileCarousel';

const HIGHLIGHTS = [
  {
    id: 'crafted',
    title: 'Handcrafted Quality',
    subtitle: 'Small-batch juices made to order, never mass-produced.',
    icon: Leaf,
    color: '#0B3D2E',
    accentColor: '#7BDC48',
  },
  {
    id: 'local',
    title: 'Local & Sustainable',
    subtitle: 'Wentzville-made. Compostable bottles. Community-first.',
    icon: Truck,
    color: '#0B3D2E',
    accentColor: '#7BDC48',
  },
  {
    id: 'wellness',
    title: 'Real Wellness',
    subtitle: 'No added sugars, no fillers, no compromises.',
    icon: Sparkles,
    color: '#0B3D2E',
    accentColor: '#7BDC48',
  },
  {
    id: 'rewards',
    title: 'Earn with Every Sip',
    subtitle: 'Rewards program. Referral bonuses. Birthday perks.',
    icon: Star,
    color: '#0B3D2E',
    accentColor: '#7BDC48',
  },
];

export default function NuViraHighlights() {
  return (
    <div className="mt-10">
      <div className="px-5 mb-4">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          <p className="font-heading font-bold text-lg mb-1">NuVira Highlights</p>
          <p className="text-xs text-muted-foreground">What makes us different</p>
        </motion.div>
      </div>

      {/* Horizontal scrollable highlights */}
      <MobileCarousel className="gap-3">
        {HIGHLIGHTS.map((highlight, i) => {
          const Icon = highlight.icon;
          return (
            <motion.div
              key={highlight.id}
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08 }}
              className="w-[280px] rounded-2xl p-4 border shadow-sm bg-nuvira-gradient-card border-nuvira"
            >
              {/* Icon badge */}
              <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3 bg-nuvira-gradient shadow-md">
                <Icon className="w-5 h-5 text-white" />
              </div>

              {/* Content */}
              <p className="font-semibold text-sm mb-1">{highlight.title}</p>
              <p className="text-xs text-muted-foreground leading-snug">{highlight.subtitle}</p>
            </motion.div>
          );
        })}
      </MobileCarousel>

      {/* Optional CTA card */}
      <div className="px-5 mt-3">
        <Link to="/rewards">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.32 }}
            className="rounded-2xl p-4 flex items-center justify-between border border-border/50 shadow-sm"
            style={{
              background: 'linear-gradient(135deg, rgba(123,220,72,0.14) 0%, rgba(61,184,74,0.08) 100%)',
              borderColor: 'rgba(123,220,72,0.3)',
            }}
          >
            <div>
              <p className="text-sm font-semibold">Loyalty Awaits</p>
              <p className="text-[10px] text-muted-foreground">Join our rewards program</p>
            </div>
            <div className="flex items-center justify-center w-8 h-8 rounded-full" style={{ background: 'rgba(123,220,72,0.2)' }}>
              <ArrowRight className="w-4 h-4" style={{ color: '#2B8A46' }} />
            </div>
          </motion.div>
        </Link>
      </div>
    </div>
  );
}
