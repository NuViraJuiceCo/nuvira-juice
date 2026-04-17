import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Leaf, Minus, Plus } from 'lucide-react';

const OPTIONS = [
  { key: 'none', label: 'No Return' },
  { key: 'small', label: 'Return 1 Small Lunch Bag', credit: '$1 credit' },
  { key: 'tote', label: 'Return 1 Tote Bag', credit: '$2 credit' },
  { key: 'multiple', label: 'Return Multiple Bags' },
];

function CounterInput({ value, onChange, min = 0, max = 10 }) {
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center active:scale-90 transition-transform"
      >
        <Minus className="w-3.5 h-3.5" />
      </button>
      <span className="text-sm font-semibold w-4 text-center">{value}</span>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center active:scale-90 transition-transform"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export default function BagReturnSelector({ totalBottles, lastOrderBottles, onChange }) {
  const [selected, setSelected] = useState('none');
  const [smallCount, setSmallCount] = useState(1);
  const [toteCount, setToteCount] = useState(1);

  // Smart suggestion based on last order
  const suggestion = lastOrderBottles
    ? lastOrderBottles <= 3
      ? 'small'
      : 'tote'
    : null;

  const suggestText = suggestion === 'small'
    ? 'Based On Your Previous Order, You Likely Have A Small Lunch Bag'
    : suggestion === 'tote'
    ? 'Based On Your Previous Order, You Likely Have A Tote Bag'
    : null;

  const handleSelect = (key) => {
    setSelected(key);
    let small = 0, tote = 0;
    if (key === 'small') { small = 1; }
    else if (key === 'tote') { tote = 1; }
    else if (key === 'multiple') { small = smallCount; tote = toteCount; }
    onChange({ smallBags: small, toteBags: tote });
  };

  const handleCountChange = (type, val) => {
    if (type === 'small') setSmallCount(val);
    else setToteCount(val);
    if (selected === 'multiple') {
      onChange({
        smallBags: type === 'small' ? val : smallCount,
        toteBags: type === 'tote' ? val : toteCount,
      });
    }
  };

  return (
    <div className="mx-4 mb-5">
      {/* Header */}
      <div className="mb-3">
        <div className="flex items-center gap-2 mb-1">
          <Leaf className="w-4 h-4 text-primary" />
          <p className="text-sm font-semibold">Return + Reward</p>
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Leave your previous NuVira bag outside at delivery to receive credit.
        </p>
        {/* Bag type education */}
        <div className="mt-2 flex gap-3">
          <span className="text-[10px] bg-secondary rounded-full px-2.5 py-1 font-medium text-muted-foreground">3 Bottles = Small Lunch Bag</span>
          <span className="text-[10px] bg-secondary rounded-full px-2.5 py-1 font-medium text-muted-foreground">4–12 Bottles = Tote Bag</span>
        </div>
      </div>

      {/* Smart Suggestion */}
      {suggestText && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-3 bg-primary/5 border border-primary/15 rounded-xl px-3.5 py-2.5"
        >
          <p className="text-[11px] text-primary font-medium">✦ {suggestText}</p>
        </motion.div>
      )}

      {/* Options */}
      <div className="space-y-2">
        {OPTIONS.map(opt => (
          <button
            key={opt.key}
            type="button"
            onClick={() => handleSelect(opt.key)}
            className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border text-left transition-all ${
              selected === opt.key
                ? 'border-primary bg-primary/5'
                : 'border-border/50 bg-card'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                selected === opt.key ? 'border-primary' : 'border-muted-foreground/40'
              }`}>
                {selected === opt.key && <div className="w-2 h-2 rounded-full bg-primary" />}
              </div>
              <span className="text-sm font-medium">{opt.label}</span>
            </div>
            {opt.credit && (
              <span className="text-[10px] font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-full">{opt.credit}</span>
            )}
          </button>
        ))}
      </div>

      {/* Multiple bags counters */}
      <AnimatePresence>
        {selected === 'multiple' && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden mt-3 bg-secondary/40 rounded-xl p-4 space-y-4"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Small Lunch Bags</p>
                <p className="text-[10px] text-muted-foreground">$1 credit each</p>
              </div>
              <CounterInput value={smallCount} onChange={v => handleCountChange('small', v)} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Tote Bags</p>
                <p className="text-[10px] text-muted-foreground">$2 credit each</p>
              </div>
              <CounterInput value={toteCount} onChange={v => handleCountChange('tote', v)} />
            </div>
            <p className="text-[10px] text-muted-foreground">
              Estimated credit: <span className="font-semibold text-primary">${((smallCount * 1) + (toteCount * 2)).toFixed(2)}</span> — applied after verification
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Eligibility notice */}
      {selected !== 'none' && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-[10px] text-muted-foreground mt-3 leading-relaxed"
        >
          Credit applied after verification. Bags must be clean, odor-free, and reusable.
        </motion.p>
      )}
    </div>
  );
}