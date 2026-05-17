import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MapPin, X } from 'lucide-react';
import { getEligibilityStatus } from '@/lib/deliveryAvailability';
import DeliveryAvailabilityCard from '@/components/delivery/DeliveryAvailabilityCard';

export default function CartDeliveryCheckPrompt() {
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // Only show if ZIP hasn't been checked yet this session
  const status = getEligibilityStatus();
  if (status !== 'unknown' || dismissed) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-primary/20 overflow-hidden"
      style={{ background: 'linear-gradient(135deg, rgba(11,61,46,0.06) 0%, rgba(14,90,67,0.04) 100%)' }}
    >
      {!expanded ? (
        <div className="flex items-center gap-3 p-3.5">
          <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
            <MapPin className="w-4 h-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-foreground">Confirm Fresh Delivery</p>
            <p className="text-[10px] text-muted-foreground">Check your area before checkout</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => setExpanded(true)}
              className="text-[10px] font-bold bg-primary text-primary-foreground px-3 py-1.5 rounded-lg active:scale-95 transition-transform"
            >
              Check My Area
            </button>
            <button
              onClick={() => setDismissed(true)}
              className="w-7 h-7 flex items-center justify-center text-muted-foreground active:opacity-60 transition-opacity"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      ) : (
        <AnimatePresence>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            {/* Re-use the full card inline — override margin */}
            <div className="[&>div]:mx-0 [&>div]:my-0 [&>div]:rounded-none [&>div]:border-0">
              <DeliveryAvailabilityCard />
            </div>
          </motion.div>
        </AnimatePresence>
      )}
    </motion.div>
  );
}