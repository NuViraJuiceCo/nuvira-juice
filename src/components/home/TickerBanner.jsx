import React from 'react';
import { motion } from 'framer-motion';

const TICKER_ITEMS = ['Cold-Pressed', 'No Additives', 'Made in STL', 'Small-Batch', 'Never Heated', 'Vegan', 'Non-GMO', 'Gluten-Free', 'Real Ingredients', 'Locally Sourced', 'No Fillers', 'No Compromises'];

export default function TickerBanner() {
  return (
    <div className="overflow-hidden bg-primary py-2.5">
      <motion.div
        animate={{ x: ['0%', '-50%'] }}
        transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
        className="flex gap-0 whitespace-nowrap"
      >
        {[...TICKER_ITEMS, ...TICKER_ITEMS].map((item, i) => (
          <span key={i} className="text-primary-foreground/90 text-xs font-semibold uppercase tracking-widest px-5 flex items-center gap-3">
            {item}
            <span className="w-1 h-1 rounded-full bg-primary-foreground/40 inline-block" />
          </span>
        ))}
      </motion.div>
    </div>
  );
}