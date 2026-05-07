import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Repeat2, ArrowRight } from 'lucide-react';

export default function SubscriptionCard() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5 }}
      className="mx-5 my-6"
    >
      <Link to="/subscribe">
        <div className="rounded-2xl p-5 overflow-hidden border border-primary/20 cursor-pointer active:scale-[0.98] transition-transform shadow-md"
          style={{ background: `linear-gradient(135deg, rgba(11,61,46,0.12) 0%, rgba(14,90,67,0.08) 100%)` }}>
          
          {/* Top row: Icon + Headline + Spacer */}
          <div className="flex items-start gap-3 mb-2">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-primary/15 shrink-0 mt-0.5">
              <Repeat2 className="w-4 h-4 text-primary" />
            </div>
            <div className="flex-1">
              <p className="font-heading text-base font-bold text-foreground leading-snug">Make It A Weekly Ritual</p>
            </div>
          </div>

          {/* Body copy */}
          <p className="text-xs text-muted-foreground leading-relaxed mb-4 pl-12">
            Set your favorite NuVira juices on repeat and keep your wellness routine effortless.
          </p>

          {/* CTA row */}
          <div className="flex items-center gap-2 text-primary font-semibold text-sm pl-12">
            Explore Subscriptions
            <ArrowRight className="w-3.5 h-3.5" />
          </div>
        </div>
      </Link>
    </motion.div>
  );
}