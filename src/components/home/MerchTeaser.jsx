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
        <div className="relative bg-nuvira-gradient rounded-2xl p-5 overflow-hidden flex items-center justify-between shadow-lg shadow-emerald-950/20">          {/* BG texture */}
          <div className="absolute inset-0 opacity-10"
            style={{ backgroundImage: 'radial-gradient(circle at 80% 50%, hsl(var(--accent)) 0%, transparent 60%)' }}
          />
          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-1">
              <Shirt className="w-4 h-4 text-white/75" />
              <span className="text-[10px] font-bold text-white/65 uppercase tracking-widest">Now Available</span>            </div>
            <p className="font-heading text-lg font-bold text-white">NuVira Merch</p>
            <p className="text-xs text-white/70 mt-0.5">Totes and limited event drops.</p>
          </div>
          <div className="relative z-10 flex items-center gap-1 text-white/85">            <span className="text-xs font-medium">Shop</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
