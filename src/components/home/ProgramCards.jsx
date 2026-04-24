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
    color: 'from-orange-100 to-orange-200',
    accent: 'text-orange-800',
    border: 'border-orange-300',
    dot: 'bg-orange-500',
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
    color: 'from-red-100 to-red-200',
    accent: 'text-red-800',
    border: 'border-red-300',
    dot: 'bg-red-500',
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
    color: 'from-green-100 to-green-200',
    accent: 'text-green-800',
    border: 'border-green-300',
    dot: 'bg-green-500',
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
                    <p className="font-heading text-xl font-bold text-gray-900">{program.name}</p>
                    <span className="text-lg">{program.emoji}</span>
                  </div>
                  <p className={`text-xs font-semibold ${program.accent}`}>{program.tagline}</p>
                </div>
                <div className="text-right shrink-0 ml-3">
                  <p className="text-[10px] text-gray-600">{program.days}-day · {program.bottles} bottles</p>
                </div>
              </div>

              <p className="text-xs text-gray-700 leading-relaxed mb-4">{program.description}</p>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-full ${program.dot}`} />
                  <p className="text-sm font-semibold text-gray-800">{program.composition}</p>
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