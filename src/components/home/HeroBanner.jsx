import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getDeliveryDisplayText } from '@/lib/deliveryUtils';

const LOGO_URL = "https://media.base44.com/images/public/69d48d0c39891f7945481152/b04d63077_Asset18322x.png";

export default function HeroBanner({ banners = [], scheduleRules = [] }) {
  const [current, setCurrent] = useState(0);
  const deliveryText = getDeliveryDisplayText(scheduleRules);

  const activeBanners = banners.length > 0 ? banners : [
    {
      title: 'Cold-Pressed. Never Compromised.',
      subtitle: deliveryText || 'Real ingredients. Made fresh for you.',
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
    <div className="relative mx-4 mt-4 rounded-2xl overflow-hidden h-52">
      <AnimatePresence mode="wait">
        <motion.div
          key={current}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
          className="absolute inset-0"
        >
          <img
            src={banner.image_url}
            alt={banner.title}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-primary/85 via-primary/60 to-transparent" />
        </motion.div>
      </AnimatePresence>

      <div className="absolute inset-0 flex flex-col justify-between p-5">
        <img src={LOGO_URL} alt="NuVira" className="w-24 drop-shadow-md" />
        <div>
          <p className="text-primary-foreground font-heading text-lg font-bold leading-tight mb-1 drop-shadow">
            {banner.title}
          </p>
          <p className="text-primary-foreground/80 text-xs mb-3 drop-shadow">
            {banner.subtitle}
          </p>
          <Link to={banner.link_to || '/shop'}>
            <Button size="sm" className="bg-white text-primary hover:bg-white/90 font-semibold rounded-full px-5 h-8 text-xs">
              Order Now <ArrowRight className="w-3 h-3 ml-1" />
            </Button>
          </Link>
        </div>
      </div>

      {/* Dots */}
      {activeBanners.length > 1 && (
        <div className="absolute bottom-3 right-4 flex gap-1">
          {activeBanners.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrent(i)}
              className={`w-1.5 h-1.5 rounded-full transition-all ${i === current ? 'bg-white w-3' : 'bg-white/50'}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}