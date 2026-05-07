import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Repeat2, ArrowRight } from 'lucide-react';

export default function SubscriptionCard() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
      className="mx-5 my-8"
    >
      <Link to="/subscribe">
        <div className="rounded-3xl p-6 overflow-hidden border border-primary/25 cursor-pointer active:scale-[0.97] transition-all duration-200 shadow-lg hover:shadow-xl"
          style={{ background: `linear-gradient(135deg, rgba(11,61,46,0.08) 0%, rgba(14,90,67,0.04) 100%), linear-gradient(to bottom, rgba(255,255,255,0.05), transparent)` }}>
          
          {/* Subtle accent line */}
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-primary/0 via-primary/30 to-primary/0" />

          {/* Content container */}
          <div className="relative">
            {/* Icon + Headline */}
            <div className="flex items-start gap-4 mb-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-primary/15 shrink-0 flex-shrink-0">
                <Repeat2 className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-heading text-lg font-bold text-foreground leading-snug">Make It A Weekly Ritual</p>
              </div>
            </div>

            {/* Body copy — clean and minimal */}
            <p className="text-xs text-muted-foreground leading-relaxed mb-4 ml-14">
              Set your favorite NuVira juices on repeat. Pause, adjust, or cancel anytime.
            </p>

            {/* CTA row — premium text link */}
            <div className="flex items-center justify-between ml-14">
              <div className="flex items-center gap-2.5 text-primary font-semibold text-sm group">
                <span>Explore Rituals</span>
                <ArrowRight className="w-4 h-4 transition-transform group-active:translate-x-1" />
              </div>
            </div>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}