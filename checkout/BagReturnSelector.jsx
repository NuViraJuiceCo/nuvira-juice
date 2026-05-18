import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Leaf, Minus, Plus } from 'lucide-react';

function Stepper({ value, onChange, min = 0, max = 10 }) {
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        className="w-9 h-9 rounded-full border border-border flex items-center justify-center active:scale-95 transition-all disabled:opacity-30 disabled:pointer-events-none"
      >
        <Minus className="w-3.5 h-3.5 text-foreground" />
      </button>
      <span className="text-sm font-semibold w-5 text-center tabular-nums">{value}</span>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        className="w-9 h-9 rounded-full border border-border flex items-center justify-center active:scale-95 transition-all disabled:opacity-30 disabled:pointer-events-none"
      >
        <Plus className="w-3.5 h-3.5 text-foreground" />
      </button>
    </div>
  );
}

const OPTIONS = [
  { key: 'none', label: 'No Return' },
  { key: 'small', label: 'Return 1 Small Lunch Bag', note: '+$1 NuVira Credit', small: 1, tote: 0 },
  { key: 'tote', label: 'Return 1 Tote Bag', note: '+$2 NuVira Credit', small: 0, tote: 1 },
  { key: 'multiple', label: 'Return Multiple Bags', small: 0, tote: 0 },
];

export default function BagReturnSelector({ totalBottles, lastOrderBottles, onChange }) {
  const [selected, setSelected] = useState('none');
  const [smallCount, setSmallCount] = useState(1);
  const [toteCount, setToteCount] = useState(1);

  const suggestText = lastOrderBottles
    ? 'Based on your previous order, you likely have a NuVira bag to return.'
    : null;

  const handleSelect = (key) => {
    setSelected(key);
    const opt = OPTIONS.find(o => o.key === key);
    if (key === 'multiple') {
      onChange({ smallBags: smallCount, toteBags: toteCount });
    } else {
      onChange({ smallBags: opt?.small ?? 0, toteBags: opt?.tote ?? 0 });
    }
  };

  const handleCountChange = (type, val) => {
    const small = type === 'small' ? val : smallCount;
    const tote = type === 'tote' ? val : toteCount;
    if (type === 'small') setSmallCount(val);
    else setToteCount(val);
    if (selected === 'multiple') onChange({ smallBags: small, toteBags: tote });
  };

  const estimatedCredit = (smallCount * 1) + (toteCount * 2);

  return (
    <div className="mx-4 mb-5">
      <div className="bg-card border border-border/50 rounded-2xl overflow-hidden">
        {/* Header */}
        <div className="px-5 pt-5 pb-4 border-b border-border/40">
          <div className="flex items-center gap-2 mb-1.5">
            <Leaf className="w-4 h-4 text-primary shrink-0" />
            <p className="font-heading text-base font-bold">Return + Reward</p>
          </div>
          <p className="text-[12px] text-muted-foreground leading-relaxed">
            Leave your previous NuVira bag outside at delivery to receive order credit.
          </p>

          {/* Bag type guide */}
          <div className="mt-3 flex gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 text-[11px] bg-muted/60 text-muted-foreground rounded-lg px-3 py-1.5 font-medium">
              <span className="w-1.5 h-1.5 bg-primary/60 rounded-full shrink-0" />
              Small Lunch Bag
            </span>
            <span className="inline-flex items-center gap-1.5 text-[11px] bg-muted/60 text-muted-foreground rounded-lg px-3 py-1.5 font-medium">
              <span className="w-1.5 h-1.5 bg-primary/60 rounded-full shrink-0" />
              Tote Bag
            </span>
          </div>
        </div>

        {/* Smart Suggestion */}
        <AnimatePresence>
          {suggestText && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="px-5 py-3 bg-primary/5 border-b border-border/40 flex items-start gap-2">
                <span className="text-primary text-[10px] mt-0.5">✦</span>
                <p className="text-[11px] text-primary font-medium leading-relaxed">{suggestText}</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Options */}
        <div className="px-5 py-4 space-y-2.5">
          {OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => handleSelect(opt.key)}
              className={`w-full flex items-center justify-between px-4 py-3.5 rounded-xl border text-left transition-all duration-200 ${
                selected === opt.key
                  ? 'border-primary bg-primary/5'
                  : 'border-border/50 bg-background hover:border-border'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                  selected === opt.key ? 'border-primary' : 'border-muted-foreground/30'
                }`}>
                  {selected === opt.key && <div className="w-2 h-2 rounded-full bg-primary" />}
                </div>
                <span className="text-sm font-medium">{opt.label}</span>
              </div>
              {opt.note && (
                <span className="text-[10px] font-semibold text-primary">{opt.note}</span>
              )}
            </button>
          ))}
        </div>

        {/* Multiple bag counters */}
        <AnimatePresence>
          {selected === 'multiple' && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="px-5 pb-4 pt-0 space-y-4 border-t border-border/40 mt-0 pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Small Lunch Bags</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">$1 NuVira credit each</p>
                  </div>
                  <Stepper value={smallCount} onChange={v => handleCountChange('small', v)} />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Tote Bags</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">$2 NuVira credit each</p>
                  </div>
                  <Stepper value={toteCount} onChange={v => handleCountChange('tote', v)} />
                </div>
                {estimatedCredit > 0 && (
                  <div className="bg-primary/5 rounded-xl px-4 py-3 flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">Estimated credit</p>
                    <p className="text-sm font-semibold text-primary">+${estimatedCredit.toFixed(2)} after verification</p>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Eligibility footer */}
        <AnimatePresence>
          {selected !== 'none' && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="px-5 pb-5"
            >
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                Credits are applied after verification. Bags must be clean, odor-free, and reusable.
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}