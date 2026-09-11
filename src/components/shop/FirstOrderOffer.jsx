import React from 'react';
import { TicketPercent } from 'lucide-react';

// Informational only: eligibility and application remain owned by checkout.
export default function FirstOrderOffer({ className = '' }) {
  return (
    <aside aria-label="First-order offer" className={`rounded-2xl border border-primary/20 bg-primary/5 p-3.5 ${className}`}>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
        <TicketPercent className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-sm font-bold text-foreground">First order? Enjoy 10% off.</p>
        <span className="rounded-lg border border-primary/20 bg-background/70 px-2.5 py-1 text-xs font-bold tracking-wider text-primary">WELCOME10</span>
      </div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        Enter WELCOME10 at checkout. First orders only, once per customer. Cannot be combined with other discounts or reward redemptions. Order minimums, delivery fees and applicable taxes apply. Eligibility is verified at checkout.
      </p>
    </aside>
  );
}
