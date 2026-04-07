import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getDeliveryDisplayText } from '@/lib/deliveryUtils';

export default function HeroBanner({ scheduleRules }) {
  const deliveryText = getDeliveryDisplayText(scheduleRules);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="relative overflow-hidden rounded-2xl mx-4 mt-4"
    >
      <div className="bg-gradient-to-br from-primary to-primary/80 p-6 pb-8 relative">
        <div className="absolute top-0 right-0 w-40 h-40 bg-white/5 rounded-full -translate-y-10 translate-x-10" />
        <div className="absolute bottom-0 left-0 w-24 h-24 bg-white/5 rounded-full translate-y-8 -translate-x-8" />
        
        <div className="relative z-10">
          <p className="text-primary-foreground/70 text-xs font-medium tracking-wider uppercase mb-1">
            Fresh & Cold-Pressed
          </p>
          <h2 className="text-primary-foreground font-heading text-2xl font-bold leading-tight mb-2">
            Nourish Your<br />Body Today
          </h2>
          <p className="text-primary-foreground/80 text-sm mb-1">
            {deliveryText}
          </p>
          <p className="text-primary-foreground/60 text-xs mb-4">
            Order now for our next fresh batch
          </p>
          <Link to="/shop">
            <Button
              size="sm"
              className="bg-white text-primary hover:bg-white/90 font-semibold rounded-full px-5"
            >
              Order Now
              <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </Link>
        </div>
      </div>
    </motion.div>
  );
}