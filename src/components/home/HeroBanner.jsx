import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, Sparkles, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getDeliveryDisplayText } from '@/lib/deliveryUtils';
import { BRAND_IMAGES } from '@/lib/brandImages';

// Product image mapping for hero slides
const PRODUCT_IMAGE_MAP = {
  'Aura': 'https://media.base44.com/images/public/69d48d0c39891f7945481152/32667c02e_DSC02688.jpg',
  'Oasis': 'https://media.base44.com/images/public/69d48d0c39891f7945481152/d2cd55af2_DSC02471-Edit.jpg',
  'Re-Nu': 'https://media.base44.com/images/public/69d48d0c39891f7945481152/3e9fe43e6_DSC02709.jpg',
};

export default function HeroBanner({ banners = [], scheduleRules = [] }) {
  const [current, setCurrent] = useState(0);
  const deliveryText = getDeliveryDisplayText(scheduleRules);
  const compactDeliveryText = deliveryText
    ?.replace(/^Delivered\s+/, '')
    ?.replace(/^Ready for pickup\s+/, 'Pickup ');
  const heroStats = [
    ['Small batch', 'Pressed fresh'],
    ['Local routes', 'STL area'],
    ['Real produce', 'No shortcuts'],
  ];

  const activeBanners = banners.length > 0 ? banners.map(banner => {
    // CRITICAL: Force correct product images based on title — zero fallback to wrong images
    let image = banner.image_url;
    
    // Product-specific overrides (absolute priority)
    if (banner.title?.toLowerCase().includes('oasis')) {
      image = PRODUCT_IMAGE_MAP.Oasis;
    } else if (banner.title?.toLowerCase().includes('re-nu')) {
      image = PRODUCT_IMAGE_MAP['Re-Nu'];
    } else if (banner.title?.toLowerCase().includes('aura')) {
      image = PRODUCT_IMAGE_MAP.Aura;
    }
    
    return { ...banner, image_url: image };
  }) : [
    {
      title: 'Cold-Pressed.\nNever Compromised.',
      subtitle: 'Real ingredients. Made fresh for you.',
      image_url: BRAND_IMAGES.bottlesCoolerWide,
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
    <section
      className="relative mt-1 overflow-hidden bg-[#061c14] md:mt-0"
      style={{ minHeight: 'clamp(500px, 72svh, 680px)' }}
    >
      {/* LCP image */}
      <div className="absolute inset-0">
        <img
          src={activeBanners[0].image_url}
          alt={activeBanners[0].title}
          className="h-full w-full object-cover object-[58%_center] sm:object-center"
          fetchPriority="high"
          decoding="sync"
          width="1600"
          height="1000"
        />
        <div className="absolute inset-0 bg-[linear-gradient(102deg,rgba(3,28,18,0.97)_0%,rgba(6,63,39,0.84)_45%,rgba(2,18,13,0.22)_100%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_82%_18%,rgba(184,239,91,0.22)_0%,transparent_34%),linear-gradient(180deg,rgba(0,0,0,0.06)_0%,rgba(0,0,0,0.62)_100%)]" />
      </div>

      {/* Animated layer for multi-banner transitions only */}
      {activeBanners.length > 1 && (
        <AnimatePresence mode="wait">
          <motion.div
            key={current}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.7, ease: 'easeOut' }}
            className="absolute inset-0"
          >
            <img
              src={banner.image_url}
              alt={banner.title}
              className="h-full w-full object-cover object-[58%_center] sm:object-center"
              decoding="async"
              width="1600"
              height="1000"
            />
            <div className="absolute inset-0 bg-[linear-gradient(102deg,rgba(3,28,18,0.97)_0%,rgba(6,63,39,0.84)_45%,rgba(2,18,13,0.22)_100%)]" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_82%_18%,rgba(184,239,91,0.22)_0%,transparent_34%),linear-gradient(180deg,rgba(0,0,0,0.06)_0%,rgba(0,0,0,0.62)_100%)]" />
          </motion.div>
        </AnimatePresence>
      )}

      <div className="relative z-10 flex min-h-[clamp(500px,72svh,680px)] flex-col justify-between px-5 py-5 sm:px-7 md:px-10 md:py-8">
        <div className="flex items-center justify-between gap-2">
          <div className="inline-flex shrink-0 items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-white/85 backdrop-blur-md sm:text-[11px]">
            <Sparkles className="h-3.5 w-3.5 text-[#C8E86A]" />
            Fresh Drop
          </div>

          {deliveryText && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35 }}
              className="hidden min-w-0 max-w-[46vw] items-center gap-1.5 rounded-full border border-white/15 bg-black/20 px-3 py-1.5 text-[10px] font-bold text-white backdrop-blur-md min-[360px]:flex sm:max-w-none"
            >
              <Zap className="h-3 w-3 shrink-0 fill-[#C8E86A] text-[#C8E86A]" />
              <span className="truncate sm:hidden">{compactDeliveryText}</span>
              <span className="hidden sm:inline">{deliveryText}</span>
            </motion.div>
          )}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.55 }}
          className="max-w-3xl pb-4 md:pb-5"
        >
          <p
            className="max-w-[12ch] text-balance font-heading text-[2.25rem] font-bold leading-[0.92] text-white drop-shadow-2xl min-[360px]:text-[2.75rem] min-[390px]:text-[3rem] min-[430px]:text-[3.35rem] sm:text-6xl md:max-w-[14ch] md:text-7xl lg:text-8xl"
            style={{ whiteSpace: 'pre-line' }}
          >
            {banner.title}
          </p>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-white/80 drop-shadow md:text-lg">
            {banner.subtitle}
          </p>

          <div className="mt-7 grid w-full max-w-[22rem] grid-cols-1 items-center gap-3 min-[360px]:grid-cols-2 sm:flex sm:max-w-md sm:flex-wrap">
            <Link to={banner.link_to || '/shop'} className="min-w-0">
              <Button className="h-12 w-full rounded-full bg-[linear-gradient(135deg,#b8ef5b_0%,#35c848_48%,#0fa34a_100%)] px-5 text-sm font-bold text-white shadow-2xl shadow-black/30 hover:brightness-105 sm:w-auto sm:px-8 md:px-9">
                Order Now <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
            <Link
              to="/shop?filter=bundles"
              className="inline-flex h-12 min-w-0 items-center justify-center overflow-hidden rounded-full border border-white/20 bg-white/10 px-4 text-sm font-bold text-white/90 backdrop-blur-md transition hover:bg-white/15 sm:px-5"
            >
              <span className="truncate">Shop Bundles</span>
            </Link>

            {activeBanners.length > 1 && (
              <div className="col-span-2 flex items-center gap-1.5 pl-1 sm:col-span-1">
                {activeBanners.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setCurrent(i)}
                    aria-label={`Go to slide ${i + 1}`}
                    className={`h-1.5 rounded-full transition-all duration-300 ${i === current ? 'w-8 bg-white' : 'w-1.5 bg-white/35 hover:bg-white/60'}`}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="mt-7 flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-bold uppercase tracking-[0.12em] text-white/80 sm:hidden">
            {heroStats.map(([title]) => (
              <span key={title} className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-[#C8E86A]" />
                {title}
              </span>
            ))}
          </div>

          <div className="mt-8 hidden max-w-3xl grid-cols-3 gap-3 text-white sm:grid">
            {heroStats.map(([title, subtitle]) => (
              <div key={title} className="rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur-md">
                <p className="font-heading text-sm font-bold md:text-base">{title}</p>
                <p className="mt-1 text-[11px] text-white/68 md:text-xs">{subtitle}</p>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
