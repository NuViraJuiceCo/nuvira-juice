import React from 'react';
import { Truck, Zap, Clock } from 'lucide-react';
import { getDeliveryShortText, getProductionInfo } from '@/lib/deliveryUtils';
export default function DeliveryBadge({ scheduleRules }) {
  const text = getDeliveryShortText(scheduleRules);
  const productionInfo = getProductionInfo(scheduleRules);

  if (productionInfo) {
    return (
      <div className="flex items-center gap-1.5 bg-amber-100 rounded-full px-3 py-1.5">
        <Zap className="w-3 h-3 text-amber-500 fill-amber-400" />
        <span className="text-[10px] font-semibold text-amber-800">In Production</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 bg-secondary/70 rounded-full px-3 py-1.5">
      <Truck className="w-3 h-3 text-primary" />
      <span className="text-[10px] font-semibold text-foreground/80">{text}</span>
    </div>
  );
}