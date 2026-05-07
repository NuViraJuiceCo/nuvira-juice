import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Shirt, ArrowRight } from 'lucide-react';

export default function MerchTeaser() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.25 }}
      className="mx-5 mt-6"
    >
      <Link to="/merch">
        <div className="relative bg-gradient-to-r from-foreground to-foreground/80 rounded-2xl p-5 overflow-hidden flex items-center justify-between">
          {/* BG texture */}
          <div className="absolute inset-0 opacity-10"
            style={{ backgroundImage: 'radial-gradient(circle at 80% 50%, hsl(var(--accent)) 0%, transparent 60%)' }}
          />
          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-1">
              <Shirt className="w-4 h-4 text-primary-foreground/70" />
              <span className="text-[10px] font-bold text-primary-foreground/50 uppercase tracking-widest">Coming Soon</span>
            </div>
            <p className="font-heading text-lg font-bold text-primary-foreground">NuVira Merch</p>
            <p className="text-xs text-primary-foreground/60 mt-0.5">Gear for the wellness lifestyle.</p>
          </div>
          <div className="relative z-10 flex items-center gap-1 text-primary-foreground/80">
            <span className="text-xs font-medium">Preview</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </div>
        </div>
      </Link>
    </motion.div>
  );
}