import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Leaf, ArrowRight, Sparkles } from 'lucide-react';

export default function SustainabilityTeaser() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="mx-5 my-5 grid grid-cols-2 gap-3"
    >
      {/* Return + Reward */}
      <Link to="/return-reward">
        <div className="bg-primary rounded-2xl p-4 h-full flex flex-col justify-between min-h-[130px] active:scale-[0.98] transition-transform">
          <div className="w-9 h-9 bg-white/15 rounded-xl flex items-center justify-center mb-3">
            <Leaf className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-[9px] font-bold uppercase tracking-widest text-white/60 mb-0.5">Sustainability</p>
            <h3 className="font-heading text-base font-bold text-white leading-tight">Return + Reward</h3>
            <div className="flex items-center gap-1 mt-2 text-white/80 text-[10px] font-semibold">
              Earn credits <ArrowRight className="w-3 h-3" />
            </div>
          </div>
        </div>
      </Link>

      {/* NuVira Difference */}
      <Link to="/why-nuvira">
        <div className="bg-accent rounded-2xl p-4 h-full flex flex-col justify-between min-h-[130px] active:scale-[0.98] transition-transform">
          <div className="w-9 h-9 bg-white/20 rounded-xl flex items-center justify-center mb-3">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-[9px] font-bold uppercase tracking-widest text-white/60 mb-0.5">The Difference</p>
            <h3 className="font-heading text-base font-bold text-white leading-tight">Why NuVira?</h3>
            <div className="flex items-center gap-1 mt-2 text-white/80 text-[10px] font-semibold">
              Our philosophy <ArrowRight className="w-3 h-3" />
            </div>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}