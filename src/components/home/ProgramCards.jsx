import React, { useRef } from 'react';
import { Link } from 'react-router-dom';
import MobileCarousel from '@/components/carousel/MobileCarousel';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { PROGRAMS } from '@/lib/program-catalog';

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
              <div className="relative overflow-hidden border rounded-2xl active:scale-[0.98] transition-transform shadow-lg"
                style={{ borderColor: program.palette.border, boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}>
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
                <div className="p-3.5" style={{ background: `linear-gradient(135deg, ${program.palette.soft}, color-mix(in srgb, ${program.palette.accent} 22%, white))` }}>
                  <p className="text-xs leading-relaxed mb-3 line-clamp-2" style={{ color: program.palette.ink }}>{program.description}</p>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: program.palette.primary }} />
                      <p className="text-xs font-semibold" style={{ color: program.palette.ink }}>{program.bottles} bottles · {program.days} days</p>
                    </div>
                    <div className="flex items-center gap-1 font-semibold text-xs" style={{ color: program.palette.primary }}>
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
              <div className="relative overflow-hidden border rounded-2xl active:scale-[0.98] hover:scale-[1.01] transition-transform h-full flex flex-col shadow-lg"
                style={{ borderColor: program.palette.border, boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}>
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
                <div className="p-4 flex-1 flex flex-col justify-between" style={{ background: `linear-gradient(135deg, ${program.palette.soft}, color-mix(in srgb, ${program.palette.accent} 22%, white))` }}>
                  <p className="text-xs leading-relaxed mb-3" style={{ color: program.palette.ink }}>{program.description}</p>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: program.palette.primary }} />
                      <p className="text-xs font-semibold" style={{ color: program.palette.ink }}>{program.bottles} bottles · {program.days} days</p>
                    </div>
                    <div className="flex items-center gap-1 font-semibold text-xs" style={{ color: program.palette.primary }}>
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
