import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Leaf, ArrowRight } from 'lucide-react';

export default function SustainabilityTeaser() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="mx-4 my-5"
    >
      <Link to="/return-reward">
        <div className="relative overflow-hidden bg-primary rounded-2xl p-5">
          {/* Decorative circles */}
          <div className="absolute -top-6 -right-6 w-28 h-28 bg-white/5 rounded-full" />
          <div className="absolute -bottom-4 -right-2 w-16 h-16 bg-white/5 rounded-full" />

          <div className="flex items-start gap-4 relative">
            <div className="w-11 h-11 bg-white/15 rounded-xl flex items-center justify-center shrink-0">
              <Leaf className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-white/60 mb-0.5">Sustainability</p>
              <h3 className="font-heading text-xl font-bold text-white leading-tight">Return + Reward</h3>
              <p className="text-white/60 text-xs mt-1">The NuVira Way</p>
              <div className="flex items-center gap-1 mt-4 text-white text-xs font-semibold">
                Earn credits — see how <ArrowRight className="w-3.5 h-3.5" />
              </div>
            </div>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}