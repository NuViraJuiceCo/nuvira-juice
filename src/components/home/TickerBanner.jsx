import React from 'react';
import { motion } from 'framer-motion';

const TICKER_ITEMS = ['Cold-Pressed', 'No Additives', 'Made in STL', 'Small-Batch', 'Never Heated', 'Vegan', 'Non-GMO', 'Gluten-Free', 'Real Ingredients', 'Locally Sourced', 'No Fillers', 'No Compromises'];

export default function TickerBanner() {
  return (
    <div className="overflow-hidden bg-nuvira-gradient py-2.5 mt-5 shadow-lg shadow-primary/10">
      <motion.div
        animate={{ x: ['0%', '-50%'] }}
        transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
        className="flex gap-0 whitespace-nowrap"
      >
        {[...TICKER_ITEMS, ...TICKER_ITEMS].map((item, i) => (
          <span key={i} className="text-white text-xs font-semibold uppercase tracking-widest flex items-center">
            <span className="px-6">{item}</span>
            <span className="w-1.5 h-1.5 rounded-full bg-white/50 inline-block shrink-0" />
          </span>
        ))}
      </motion.div>
    </div>
  );
}
