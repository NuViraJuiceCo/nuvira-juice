import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getDeliveryDisplayText } from '@/lib/deliveryUtils';

const LOGO_URL = "https://media.base44.com/images/public/69d48d0c39891f7945481152/b04d63077_Asset18322x.png";

export default function HeroBanner({ banners = [], scheduleRules = [] }) {
  const [current, setCurrent] = useState(0);
  const deliveryText = getDeliveryDisplayText(scheduleRules);

  const activeBanners = banners.length > 0 ? banners : [
    {
      title: 'Cold-Pressed.\nNever Compromised.',
      subtitle: 'Real ingredients. Made fresh for you.',
      image_url: "https://media.base44.com/images/public/69d48d0c39891f7945481152/99e225ed4_DSC02438-Edit-2.jpg",
      link_to: '/shop',
    }
  ];

  useEffect(() => {
    if (activeBanners.length <= 1) return;
    const t = setInterval(() => setCurrent(c => (c + 1) % activeBanners.length), 4500);
    return () => clearInterval(t);
  }, [activeBanners.length]);

  const banner = activeBanners[current];

  return (
    <div className="relative mt-3 overflow-hidden" style={{ height: '72vw', maxHeight: '300px', minHeight: '220px' }}>

      {/* LCP image: rendered immediately, no animation, fetchpriority high */}
      <div className="absolute inset-0">
        <img
          src={activeBanners[0].image_url}
          alt={activeBanners[0].title}
          className="w-full h-full object-cover"
          fetchpriority="high"
          decoding="sync"
          width="800"
          height="576"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-primary/90 via-primary/65 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
      </div>

      {/* Animated layer for multi-banner transitions only */}
      {activeBanners.length > 1 && (
        <AnimatePresence mode="wait">
          <motion.div
            key={current}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            className="absolute inset-0"
          >
            <img
              src={banner.image_url}
              alt={banner.title}
              className="w-full h-full object-cover"
              decoding="async"
              width="800"
              height="576"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-primary/90 via-primary/65 to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
          </motion.div>
        </AnimatePresence>
      )}

      {/* Floating delivery badge */}
      {deliveryText && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="absolute top-3 right-3 bg-white/15 backdrop-blur-sm border border-white/25 rounded-full px-2.5 py-1 flex items-center gap-1"
        >
          <Zap className="w-2.5 h-2.5 text-yellow-300 fill-yellow-300" />
          <span className="text-white text-[9px] font-semibold">{deliveryText}</span>
        </motion.div>
      )}

      {/* Content */}
      <div className="absolute inset-0 flex flex-col justify-between p-5">
        <img
          src={LOGO_URL}
          alt="NuVira"
          className="w-24 drop-shadow-lg brightness-0 invert opacity-90"
          width="96"
          height="32"
        />
        <div>
          <p
            className="text-white font-heading text-lg sm:text-2xl font-bold leading-tight mb-1.5 drop-shadow-lg"
            style={{ whiteSpace: 'pre-line' }}
          >
            {banner.title}
          </p>
          <p className="text-white/80 text-xs mb-4 drop-shadow line-clamp-2">
            {banner.subtitle}
          </p>
          <Link to={banner.link_to || '/shop'}>
            <Button size="sm" className="bg-white text-primary hover:bg-white/90 font-bold rounded-full px-6 h-9 text-xs shadow-lg shadow-black/20">
              Order Now <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </Button>
          </Link>
        </div>
      </div>

      {/* Dots */}
      {activeBanners.length > 1 && (
        <div className="absolute bottom-4 right-5 flex gap-1.5">
          {activeBanners.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrent(i)}
              aria-label={`Go to slide ${i + 1}`}
              className={`h-1.5 rounded-full transition-all duration-300 ${i === current ? 'bg-white w-5' : 'bg-white/40 w-1.5'}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}