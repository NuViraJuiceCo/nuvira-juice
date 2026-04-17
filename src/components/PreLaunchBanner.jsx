import React from 'react';
import { motion } from 'framer-motion';
import { Clock, Sparkles } from 'lucide-react';
import { LAUNCH_DATE, FIRST_DELIVERY_DATE } from '@/lib/preorderConfig';

export default function PreLaunchBanner() {
  const now = new Date();
  if (now >= LAUNCH_DATE) return null;

  const daysUntilLaunch = Math.ceil((LAUNCH_DATE - now) / (1000 * 60 * 60 * 24));

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-4 mb-5"
    >
      <div className="bg-primary rounded-2xl p-4 relative overflow-hidden">
        <div className="absolute -top-4 -right-4 w-24 h-24 bg-white/5 rounded-full" />
        <div className="flex items-start gap-3 relative">
          <div className="w-9 h-9 bg-white/15 rounded-xl flex items-center justify-center shrink-0 mt-0.5">
            <Clock className="w-4 h-4 text-white" />
          </div>
          <div className="flex-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-white/60 mb-0.5">Coming Soon</p>
            <p className="font-heading text-base font-bold text-white leading-tight">We're Launching May 1st</p>
            <p className="text-white/70 text-xs mt-1 leading-relaxed">
              Get ready for fresh cold-pressed juice. Pre-orders open <span className="font-semibold text-white">April 23rd</span>. Everything ships <span className="font-semibold text-white">May 2nd</span>.
            </p>
          </div>
          {daysUntilLaunch > 0 && (
            <div className="shrink-0 bg-white/15 rounded-xl px-2.5 py-1.5 text-center">
              <p className="font-heading text-xl font-bold text-white leading-none">{daysUntilLaunch}</p>
              <p className="text-[9px] text-white/60 font-medium">days</p>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-3 relative">
          <Clock className="w-3 h-3 text-white/50" />
          <p className="text-[10px] text-white/50">Pre-orders open April 23rd · Delivery May 2nd</p>
        </div>
      </div>
    </motion.div>
  );
}