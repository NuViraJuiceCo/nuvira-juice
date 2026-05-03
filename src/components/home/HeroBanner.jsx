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
    <div className="relative mt-3 mx-3 overflow-hidden rounded-3xl" style={{ height: '72vw', maxHeight: '300px', minHeight: '220px' }}>

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
        {/* Bright & fresh overlay — light on right, soft white fade on left */}
        <div className="absolute inset-0 bg-gradient-to-r from-white/80 via-white/40 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-b from-white/20 via-transparent to-white/10" />
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
            <div className="absolute inset-0 bg-gradient-to-r from-white/80 via-white/40 to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-b from-white/20 via-transparent to-white/10" />
          </motion.div>
        </AnimatePresence>
      )}

      {/* Floating delivery badge */}
      {deliveryText && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="absolute top-3 right-3 bg-primary/90 backdrop-blur-sm rounded-full px-2.5 py-1 flex items-center gap-1 shadow-sm"
        >
          <Zap className="w-2.5 h-2.5 text-yellow-300 fill-yellow-300" />
          <span className="text-white text-[9px] font-semibold">{deliveryText}</span>
        </motion.div>
      )}

      {/* Content */}
      <div className="absolute inset-0 flex flex-col p-5">
        <img
          src={LOGO_URL}
          alt="NuVira"
          className="w-24 drop-shadow"
          width="96"
          height="32"
        />
        <div className="flex-1 flex flex-col justify-center pb-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-primary mb-1">Cold-Pressed · Made Fresh</p>
          <p
            className="text-foreground font-heading text-xl sm:text-2xl font-bold leading-tight mb-1.5"
            style={{ whiteSpace: 'pre-line' }}
          >
            {banner.title}
          </p>
          <p className="text-muted-foreground text-xs mb-4 line-clamp-2">
            {banner.subtitle}
          </p>
          <div className="flex items-center gap-3">
            <Link to={banner.link_to || '/shop'}>
              <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90 font-bold rounded-full px-6 h-9 text-xs shadow-md">
                Order Now <ArrowRight className="w-3.5 h-3.5 ml-1" />
              </Button>
            </Link>
            {activeBanners.length > 1 && (
              <div className="flex gap-1.5">
                {activeBanners.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setCurrent(i)}
                    aria-label={`Go to slide ${i + 1}`}
                    className={`h-1.5 rounded-full transition-all duration-300 ${i === current ? 'bg-primary w-5' : 'bg-primary/25 w-1.5'}`}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}