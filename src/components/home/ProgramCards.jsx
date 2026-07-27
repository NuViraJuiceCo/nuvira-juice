import React, { useRef } from 'react';
import { Link } from 'react-router-dom';
import MobileCarousel from '@/components/carousel/MobileCarousel';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';

// Tap-vs-scroll guard — only navigate if vertical movement < 8px
function useTapGuard() {
  const startY = useRef(null);
  const scrolled = useRef(false);
  return {
    onTouchStart: (e) => { startY.current = e.touches[0].clientY; scrolled.current = false; },
    onTouchMove: (e) => { if (startY.current !== null && Math.abs(e.touches[0].clientY - startY.current) > 8) scrolled.current = true; },
    onClick: (e) => { if (scrolled.current) e.preventDefault(); },
  };
}

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
    image: 'https://media.base44.com/images/public/69d48d0c39891f7945481152/32667c02e_DSC02688.jpg',
    imagePosition: 'object-[center_40%]',
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
    image: 'https://media.base44.com/images/public/69d48d0c39891f7945481152/bc50c9427_DSC02532.jpg',
    imagePosition: 'object-[center_35%]',
  },
  {
    key: 'reset',
    name: 'Reset',
    tagline: 'Refresh & renew',
    description: 'Nutrient-forward blend to support digestive wellness, reduce bloating, and help your body feel refreshed from the inside out.',
    composition: '9 Re-Nu · 3 Oasis',
    bottles: 12,
    days: 3,
    price: 144,
    color: 'from-green-100 to-green-200',
    accent: 'text-green-800',
    border: 'border-green-300',
    dot: 'bg-green-500',
    emoji: '🌿',
    image: 'https://media.base44.com/images/public/69d48d0c39891f7945481152/3e9fe43e6_DSC02709.jpg',
    imagePosition: 'object-[center_40%]',
  },
];

export { PROGRAMS };

export default function ProgramCards() {
  const tapGuard = useTapGuard();
  return (
    <>
      {/* Mobile: horizontal scroll, peek next card */}
      <MobileCarousel className="md:hidden">
        {PROGRAMS.map((program, i) => (
          <motion.div
            key={program.key}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
            className="w-[78vw]"
          >
            <Link to={`/program/${program.key}`} onTouchStart={tapGuard.onTouchStart} onTouchMove={tapGuard.onTouchMove} onClick={tapGuard.onClick}>
              <div className={`relative overflow-hidden border ${program.border} rounded-2xl active:scale-[0.98] transition-transform shadow-lg`}
                style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}>
                {program.image && (
                  <div className="relative h-44 overflow-hidden">
                    <img
                      src={program.image}
                      alt={program.name}
                      className={`w-full h-full object-cover ${program.imagePosition || 'object-center'}`}
                      loading="lazy"
                    />
                    <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/60" />
                    <div className="absolute bottom-3 left-4">
                      <p className="font-heading text-xl font-bold text-white drop-shadow">{program.name} <span className="text-base">{program.emoji}</span></p>
                      <p className="text-white/80 text-xs font-semibold">{program.tagline}</p>
                    </div>
                  </div>
                )}
                <div className={`bg-gradient-to-br ${program.color} p-3.5`}>
                  <p className="text-xs text-gray-900 leading-relaxed mb-3 line-clamp-2">{program.description}</p>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`w-2.5 h-2.5 rounded-full ${program.dot}`} />
                      <p className="text-xs text-gray-800 font-semibold">{program.bottles} bottles · {program.days} days</p>
                    </div>
                    <div className={`flex items-center gap-1 ${program.accent} font-semibold text-xs`}>
                      Build It <ArrowRight className="w-3.5 h-3.5" />
                    </div>
                  </div>
                </div>
              </div>
            </Link>
          </motion.div>
        ))}
      </MobileCarousel>

      {/* Desktop: 3 columns side by side */}
      <div className="hidden md:grid md:grid-cols-3 gap-4 px-4">
        {PROGRAMS.map((program, i) => (
          <motion.div
            key={program.key}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
          >
            <Link to={`/program/${program.key}`}>
              <div className={`relative overflow-hidden border ${program.border} rounded-2xl active:scale-[0.98] hover:scale-[1.01] transition-transform h-full flex flex-col shadow-lg`}
                style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}>
                {program.image && (
                  <div className="relative h-52 overflow-hidden">
                    <img
                      src={program.image}
                      alt={program.name}
                      className={`w-full h-full object-cover ${program.imagePosition || 'object-center'}`}
                      loading="lazy"
                    />
                    <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/60" />
                    <div className="absolute bottom-3 left-4">
                      <p className="font-heading text-xl font-bold text-white drop-shadow">{program.name} <span className="text-base">{program.emoji}</span></p>
                      <p className="text-white/80 text-xs font-semibold">{program.tagline}</p>
                    </div>
                  </div>
                )}
                <div className={`bg-gradient-to-br ${program.color} p-4 flex-1 flex flex-col justify-between`}>
                  <p className="text-xs text-gray-900 leading-relaxed mb-3">{program.description}</p>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`w-2.5 h-2.5 rounded-full ${program.dot}`} />
                      <p className="text-xs text-gray-800 font-semibold">{program.bottles} bottles · {program.days} days</p>
                    </div>
                    <div className={`flex items-center gap-1 ${program.accent} font-semibold text-xs`}>
                      Build It <ArrowRight className="w-3.5 h-3.5" />
                    </div>
                  </div>
                </div>
              </div>
            </Link>
          </motion.div>
        ))}
      </div>
    </>
  );
}