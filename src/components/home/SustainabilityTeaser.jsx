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
        <div className="relative overflow-hidden rounded-2xl" style={{ minHeight: '120px' }}>
          <img
            src="https://media.base44.com/images/public/69d48d0c39891f7945481152/35783d2fc_DSC02706.jpg"
            alt="NuVira delivery bag"
            className="absolute inset-0 w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-primary/80" />

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