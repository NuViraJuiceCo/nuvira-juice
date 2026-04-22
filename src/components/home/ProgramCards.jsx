import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';

const PROGRAMS = [
  {
    key: 'radiance',
    name: 'Radiance',
    tagline: 'Glow from within',
    description: 'Antioxidant-rich blend designed to brighten skin, boost energy, and support cellular repair.',
    composition: '9 Aura · 3 Oasis',
    bottles: 12,
    days: 3,
    price: 144,
    color: 'from-amber-50 to-orange-50',
    accent: 'text-amber-700',
    border: 'border-amber-200',
    dot: 'bg-amber-400',
    emoji: '✨',
  },
  {
    key: 'hydration',
    name: 'Hydration',
    tagline: 'Deep cellular replenishment',
    description: 'Electrolyte-dense formula to restore hydration, reduce inflammation, and optimize performance.',
    composition: '9 Oasis · 3 Aura',
    bottles: 12,
    days: 3,
    price: 144,
    color: 'from-sky-50 to-blue-50',
    accent: 'text-sky-700',
    border: 'border-sky-200',
    dot: 'bg-sky-400',
    emoji: '💧',
  },
  {
    key: 'reset',
    name: 'Reset',
    tagline: 'Cleanse & restore',
    description: 'Detox-forward blend to clear the body, reduce bloat, and reset your system from the inside out.',
    composition: '9 Re-Nu · 3 Oasis',
    bottles: 12,
    days: 3,
    price: 144,
    color: 'from-emerald-50 to-green-50',
    accent: 'text-emerald-700',
    border: 'border-emerald-200',
    dot: 'bg-emerald-400',
    emoji: '🌿',
  },
];

export { PROGRAMS };

export default function ProgramCards() {
  return (
    <div className="px-4 space-y-3">
      {PROGRAMS.map((program, i) => (
        <motion.div
          key={program.key}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.08 }}
        >
          <Link to={`/program/${program.key}`}>
            <div className={`bg-gradient-to-br ${program.color} border ${program.border} rounded-2xl p-5 active:scale-[0.98] transition-transform`}>
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg">{program.emoji}</span>
                    <p className="font-heading text-xl font-bold text-foreground">{program.name}</p>
                  </div>
                  <p className={`text-xs font-semibold ${program.accent}`}>{program.tagline}</p>
                </div>
                <div className="text-right shrink-0 ml-3">
                  <p className="font-heading text-2xl font-bold text-foreground">${program.price}</p>
                  <p className="text-[10px] text-muted-foreground">{program.days}-day · {program.bottles} bottles</p>
                </div>
              </div>

              <p className="text-xs text-foreground/70 leading-relaxed mb-4">{program.description}</p>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <div className={`w-2 h-2 rounded-full ${program.dot}`} />
                  <p className="text-[11px] font-medium text-foreground/60">{program.composition}</p>
                </div>
                <div className={`flex items-center gap-1 ${program.accent} font-semibold text-xs`}>
                  Start Program <ArrowRight className="w-3.5 h-3.5" />
                </div>
              </div>
            </div>
          </Link>
        </motion.div>
      ))}
    </div>
  );
}