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
      className="mb-5"
    >
      <div className="bg-primary dark:bg-white rounded-2xl p-6 relative overflow-hidden border border-primary/20 dark:border-border">
        <div className="absolute -bottom-6 -right-6 w-32 h-32 bg-white/10 dark:bg-primary/5 rounded-full" />
        
        {/* Main content */}
        <div className="flex items-start gap-4 relative mb-4">
          <div className="w-10 h-10 bg-white/15 dark:bg-primary/20 rounded-xl flex items-center justify-center shrink-0">
            <Clock className="w-5 h-5 text-white dark:text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-widest text-white/70 dark:text-primary/70 mb-2">Coming Soon</p>
            <p className="font-heading text-lg font-bold text-white dark:text-primary/90 leading-tight mb-3">We're Launching May 1st</p>
            <p className="text-white/80 dark:text-foreground/85 text-xs leading-relaxed">
              Get ready for fresh cold-pressed juice. Pre-orders open <span className="font-semibold text-white dark:text-foreground">April 23rd</span>. Everything ships <span className="font-semibold text-white dark:text-foreground">May 2nd</span>.
            </p>
          </div>
          {daysUntilLaunch > 0 && (
            <div className="shrink-0 bg-white/15 dark:bg-primary/20 rounded-xl px-3 py-2 text-center">
              <p className="font-heading text-2xl font-bold text-white dark:text-primary/90 leading-none">{daysUntilLaunch}</p>
              <p className="text-[9px] text-white/70 dark:text-primary/70 font-medium mt-1">days</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-1.5 relative pt-3 border-t border-white/10 dark:border-primary/20">
          <Clock className="w-3 h-3 text-white/50 dark:text-primary/50 shrink-0" />
          <p className="text-[10px] text-white/60 dark:text-foreground/80">Pre-orders open April 23rd · Delivery May 2nd</p>
        </div>
      </div>
    </motion.div>
  );
}