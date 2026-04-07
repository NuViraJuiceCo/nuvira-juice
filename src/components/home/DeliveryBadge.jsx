import React from 'react';
import { Truck } from 'lucide-react';
import { getDeliveryShortText } from '@/lib/deliveryUtils';

export default function DeliveryBadge({ scheduleRules }) {
  const text = getDeliveryShortText(scheduleRules);

  return (
    <div className="flex items-center gap-1.5 bg-secondary/70 rounded-full px-3 py-1.5">
      <Truck className="w-3 h-3 text-primary" />
      <span className="text-[10px] font-medium text-foreground">{text}</span>
    </div>
  );
}