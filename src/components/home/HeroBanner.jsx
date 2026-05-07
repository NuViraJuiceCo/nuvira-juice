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
      image_url: "https://media.base44.com/images/public/69d48d0c39891f7945481152/19cc41d64_DSC02565.jpg",
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
    <div className="relative mt-2 md:mx-3 md:rounded-3xl overflow-hidden" style={{ height: '85vw', maxHeight: '380px', minHeight: '260px' }}>

      {/* LCP image */}
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
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
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
            <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
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

      {/* Content — no logo (already in page header above) */}
      <div className="absolute inset-0 flex flex-col justify-end p-6 pb-8">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.5 }}
        >
          <p
            className="text-white font-heading text-3xl sm:text-4xl font-bold leading-tight mb-2 drop-shadow-lg"
            style={{ whiteSpace: 'pre-line' }}
          >
            {banner.title}
          </p>
          <p className="text-white/80 text-sm mb-5 drop-shadow line-clamp-2">
            {banner.subtitle}
          </p>
          <div className="flex items-center gap-3">
            <Link to={banner.link_to || '/shop'}>
              <Button className="bg-white text-primary hover:bg-white/90 font-bold rounded-full px-8 h-11 text-sm shadow-lg shadow-black/25">
                Order Now <ArrowRight className="w-4 h-4 ml-1.5" />
              </Button>
            </Link>
            {activeBanners.length > 1 && (
              <div className="flex gap-1.5">
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
        </motion.div>
      </div>
    </div>
  );
}