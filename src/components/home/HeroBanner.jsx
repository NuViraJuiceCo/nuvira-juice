import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BRAND_IMAGES } from '@/lib/brandImages';

// Product-focused hero photography. These are deployed with the app so the
// homepage does not depend on older remote banner image crops.
const DEFAULT_HERO_IMAGE = {
  image_url: BRAND_IMAGES.aboutBottleCooler,
  object_position: '58% center',
};

const HIDDEN_HERO_TITLES = ['meet oasis'];

const PRODUCT_HERO_IMAGE_MAP = {
  'Trio': {
    image_url: BRAND_IMAGES.trioOutdoorEvent,
    object_position: '72% center',
  },
  'Aura': {
    image_url: BRAND_IMAGES.bottlesCoolerWide,
    object_position: '48% center',
  },
  'Oasis': {
    image_url: BRAND_IMAGES.ogCooler,
    object_position: '58% center',
  },
  'Re-Nu': {
    image_url: BRAND_IMAGES.bottlesCoolerWide,
    object_position: '54% center',
  },
};

export default function HeroBanner({ banners = [] }) {
  const [current, setCurrent] = useState(0);
  const heroStats = [
    ['Made to order', 'Pressed for your route'],
    ['Signature trio', 'AURA + OASIS + RE-NU'],
    ['Local routes', 'Wentzville + greater St. Louis'],
  ];

  const visibleBanners = banners.filter((banner) => {
    const title = banner.title?.trim().toLowerCase();
    return !HIDDEN_HERO_TITLES.includes(title);
  });

  const activeBanners = visibleBanners.length > 0 ? visibleBanners.map(banner => {
    let image = DEFAULT_HERO_IMAGE.image_url;
    let objectPosition = DEFAULT_HERO_IMAGE.object_position;

    // Use curated product photography for active home banners when the CMS title
    // identifies a NuVira bottle line.
    if (banner.title?.toLowerCase().includes('trio')) {
      image = PRODUCT_HERO_IMAGE_MAP.Trio.image_url;
      objectPosition = PRODUCT_HERO_IMAGE_MAP.Trio.object_position;
    } else if (banner.title?.toLowerCase().includes('oasis')) {
      image = PRODUCT_HERO_IMAGE_MAP.Oasis.image_url;
      objectPosition = PRODUCT_HERO_IMAGE_MAP.Oasis.object_position;
    } else if (banner.title?.toLowerCase().includes('re-nu')) {
      image = PRODUCT_HERO_IMAGE_MAP['Re-Nu'].image_url;
      objectPosition = PRODUCT_HERO_IMAGE_MAP['Re-Nu'].object_position;
    } else if (banner.title?.toLowerCase().includes('aura')) {
      image = PRODUCT_HERO_IMAGE_MAP.Aura.image_url;
      objectPosition = PRODUCT_HERO_IMAGE_MAP.Aura.object_position;
    }
    
    return { ...banner, image_url: image, hero_object_position: objectPosition };
  }) : [
    {
      title: 'Cold-Pressed.\nNever Compromised.',
      subtitle: 'Real ingredients. Made fresh for you.',
      image_url: DEFAULT_HERO_IMAGE.image_url,
      hero_object_position: DEFAULT_HERO_IMAGE.object_position,
      link_to: '/shop',
    }
  ];
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
          srcSet={activeBanners[0].image_url === DEFAULT_HERO_IMAGE.image_url
            ? `${BRAND_IMAGES.aboutBottleCoolerMobile} 840w, ${DEFAULT_HERO_IMAGE.image_url} 1440w`
            : undefined}
          sizes="100vw"
          alt={activeBanners[0].title}
          className="h-full w-full object-cover"
          style={{ objectPosition: activeBanners[0].hero_object_position || '58% center' }}
          fetchPriority="high"
          decoding="sync"
          width="1440"
          height="960"
        />
        <div className="absolute inset-0 bg-[linear-gradient(102deg,rgba(3,28,18,0.97)_0%,rgba(6,63,39,0.84)_45%,rgba(2,18,13,0.22)_100%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_82%_18%,rgba(184,239,91,0.22)_0%,transparent_34%),linear-gradient(180deg,rgba(0,0,0,0.06)_0%,rgba(0,0,0,0.62)_100%)]" />
      </div>

      {/* Animated layer for multi-banner transitions only */}
      {activeBanners.length > 1 && current !== 0 && (
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
              className="h-full w-full object-cover"
              style={{ objectPosition: banner.hero_object_position || '58% center' }}
              loading="lazy"
              decoding="async"
              width="1440"
              height="960"
            />
            <div className="absolute inset-0 bg-[linear-gradient(102deg,rgba(3,28,18,0.97)_0%,rgba(6,63,39,0.84)_45%,rgba(2,18,13,0.22)_100%)]" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_82%_18%,rgba(184,239,91,0.22)_0%,transparent_34%),linear-gradient(180deg,rgba(0,0,0,0.06)_0%,rgba(0,0,0,0.62)_100%)]" />
          </motion.div>
        </AnimatePresence>
      )}

      <div className="relative z-10 flex min-h-[clamp(500px,72svh,680px)] flex-col justify-between px-5 py-5 sm:px-7 md:px-10 md:py-8">
        <div className="flex items-center gap-2">
          <div className="inline-flex shrink-0 items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-white/85 backdrop-blur-md sm:text-[11px]">
            <Sparkles className="h-3.5 w-3.5 text-[#C8E86A]" />
            Fresh Drop
          </div>
        </div>

        <motion.div
          initial={false}
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
            <Button asChild className="h-12 w-full rounded-full bg-[linear-gradient(135deg,#b8ef5b_0%,#35c848_48%,#0fa34a_100%)] px-5 text-sm font-bold text-white shadow-2xl shadow-black/30 hover:brightness-105 sm:w-auto sm:px-8 md:px-9">
              <Link to={banner.link_to || '/shop'} className="min-w-0">
                Order Now <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Link
              to="/shop?filter=bundles"
              className="inline-flex h-12 min-w-0 items-center justify-center overflow-hidden rounded-full border border-white/20 bg-white/10 px-4 text-sm font-bold text-white/90 backdrop-blur-md transition hover:bg-white/15 sm:px-5"
            >
              <span className="truncate">Shop Bundles</span>
            </Link>

            {activeBanners.length > 1 && (
              <div className="col-span-2 flex items-center gap-0 pl-1 sm:col-span-1">
                {activeBanners.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setCurrent(i)}
                    aria-label={`Go to slide ${i + 1}`}
                    className="group flex h-11 w-11 items-center justify-center rounded-full"
                  >
                    <span className={`h-1.5 rounded-full transition-all duration-300 ${i === current ? 'w-8 bg-white' : 'w-1.5 bg-white/35 group-hover:bg-white/60'}`} />
                  </button>
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
