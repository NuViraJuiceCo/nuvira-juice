import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ShoppingBag, ArrowRight } from 'lucide-react';
import { BRAND_IMAGES } from '@/lib/brandImages';

export default function MerchTeaser() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.25 }}
      className="mx-5 mt-6"
    >
      <Link to="/merch">
        <div className="relative bg-foreground rounded-2xl overflow-hidden flex min-h-[132px] items-stretch justify-between">
          <img
            src={BRAND_IMAGES.toteBag}
            alt="Large NuVira tote bag"
            className="absolute inset-y-0 right-0 h-full w-40 object-cover opacity-80"
            loading="lazy"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-foreground via-foreground/92 to-foreground/35" />
          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-1 px-5 pt-5">
              <ShoppingBag className="w-4 h-4 text-primary-foreground/70" />
              <span className="text-[10px] font-bold text-primary-foreground/55 uppercase tracking-widest">Now Available</span>
            </div>
            <div className="px-5 pb-5">
              <p className="font-heading text-lg font-bold text-primary-foreground">Large NuVira Tote Bag</p>
              <p className="text-xs text-primary-foreground/65 mt-0.5 max-w-[170px]">Reusable event-day carryall.</p>
            </div>
          </div>
          <div className="relative z-10 flex items-end gap-1 p-5 text-primary-foreground/80">
            <span className="text-xs font-medium">Preview</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
