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
    // Legacy Tailwind fields (kept for any external references that may still use them)
    color: 'from-orange-100 to-orange-200',
    accent: 'text-orange-800',
    border: 'border-orange-300',
    dot: 'bg-orange-500',
    emoji: '✨',
    image: 'https://media.base44.com/images/public/69d48d0c39891f7945481152/32667c02e_DSC02688.jpg',
    imagePosition: 'object-[center_40%]',
    // Premium gradient tokens
    gradientBg: 'linear-gradient(135deg, #FFF3E0 0%, #FFE0B2 55%, #FFCC80 100%)',
    borderColor: 'rgba(251,140,0,0.45)',
    shadowColor: 'rgba(251,140,0,0.18)',
    chipBg: 'rgba(251,140,0,0.14)',
    chipBorder: 'rgba(251,140,0,0.35)',
    dotColor: '#FB8C00',
    accentColor: '#E65100',
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
    gradientBg: 'linear-gradient(135deg, #FFEBEE 0%, #FFCDD2 55%, #EF9A9A 100%)',
    borderColor: 'rgba(229,57,53,0.40)',
    shadowColor: 'rgba(229,57,53,0.16)',
    chipBg: 'rgba(229,57,53,0.12)',
    chipBorder: 'rgba(229,57,53,0.30)',
    dotColor: '#E53935',
    accentColor: '#B71C1C',
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
    gradientBg: 'linear-gradient(135deg, #E8F5E9 0%, #C8E6C9 55%, #A5D6A7 100%)',
    borderColor: 'rgba(56,142,60,0.40)',
    shadowColor: 'rgba(56,142,60,0.16)',
    chipBg: 'rgba(56,142,60,0.12)',
    chipBorder: 'rgba(56,142,60,0.30)',
    dotColor: '#388E3C',
    accentColor: '#1B5E20',
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
              <div
                className="relative overflow-hidden rounded-2xl active:scale-[0.98] transition-transform"
                style={{
                  border: `1.5px solid ${program.borderColor}`,
                  boxShadow: `0 8px 28px ${program.shadowColor}, 0 2px 6px rgba(0,0,0,0.07)`,
                }}
              >
                {program.image && (
                  <div className="relative h-44 overflow-hidden">
                    <img
                      src={program.image}
                      alt={program.name}
                      className={`w-full h-full object-cover ${program.imagePosition || 'object-center'}`}
                      loading="lazy"
                    />
                    <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/65" />
                    <div className="absolute bottom-3 left-4">
                      <p className="font-heading text-xl font-bold text-white drop-shadow">{program.name} <span className="text-base">{program.emoji}</span></p>
                      <p className="text-white/85 text-xs font-semibold">{program.tagline}</p>
                    </div>
                  </div>
                )}
                <div className="p-3.5" style={{ background: program.gradientBg }}>
                  <p className="text-xs leading-relaxed mb-3 line-clamp-2" style={{ color: 'rgba(0,0,0,0.72)' }}>{program.description}</p>
                  <div className="flex items-center justify-between">
                    <div
                      className="flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-semibold"
                      style={{ background: program.chipBg, border: `1px solid ${program.chipBorder}`, color: program.accentColor }}
                    >
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: program.dotColor }} />
                      {program.bottles} bottles · {program.days} days
                    </div>
                    <div className="flex items-center gap-1 font-bold text-xs" style={{ color: program.accentColor }}>
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
              <div
                className="relative overflow-hidden rounded-2xl active:scale-[0.98] hover:scale-[1.01] transition-transform h-full flex flex-col"
                style={{
                  border: `1.5px solid ${program.borderColor}`,
                  boxShadow: `0 8px 32px ${program.shadowColor}, 0 2px 8px rgba(0,0,0,0.07)`,
                }}
              >
                {program.image && (
                  <div className="relative h-52 overflow-hidden">
                    <img
                      src={program.image}
                      alt={program.name}
                      className={`w-full h-full object-cover ${program.imagePosition || 'object-center'}`}
                      loading="lazy"
                    />
                    <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/65" />
                    <div className="absolute bottom-3 left-4">
                      <p className="font-heading text-xl font-bold text-white drop-shadow">{program.name} <span className="text-base">{program.emoji}</span></p>
                      <p className="text-white/85 text-xs font-semibold">{program.tagline}</p>
                    </div>
                  </div>
                )}
                <div className="p-4 flex-1 flex flex-col justify-between" style={{ background: program.gradientBg }}>
                  <p className="text-xs leading-relaxed mb-3" style={{ color: 'rgba(0,0,0,0.72)' }}>{program.description}</p>
                  <div className="flex items-center justify-between">
                    <div
                      className="flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-semibold"
                      style={{ background: program.chipBg, border: `1px solid ${program.chipBorder}`, color: program.accentColor }}
                    >
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: program.dotColor }} />
                      {program.bottles} bottles · {program.days} days
                    </div>
                    <div className="flex items-center gap-1 font-bold text-xs" style={{ color: program.accentColor }}>
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