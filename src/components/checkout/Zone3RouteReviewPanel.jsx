import React, { useState } from 'react';
import { MapPin, Clock, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Disclosure only: the main checkout owns validation, benefits, pricing,
// recovery and the payment element. There is no separate pricing engine here.
export default function Zone3RouteReviewPanel({ zoneEligibility, total, isSubmitting, onPrepare, onCancel }) {
  const [acknowledged, setAcknowledged] = useState(false);
  return <section className="mx-4 mb-5 rounded-2xl border border-cyan-500/30 bg-cyan-500/10 p-4">
    <div className="flex items-center gap-2"><MapPin size={18} className="text-primary" />
      <h3 className="font-semibold">Delivery route review</h3></div>
    <p className="mt-3 text-sm text-muted-foreground">Your address is outside our automatic routes.
      Our team needs to approve delivery for your selected date.</p>
    <p className="mt-3 text-sm">{total === 0
      ? 'Your selected benefits cover this order. They remain reserved until approval; no card payment is required.'
      : 'We will authorize the total shown below, without charging your card. Payment is captured only after route approval.'}</p>
    <p className="mt-3 flex gap-2 text-xs text-muted-foreground"><Clock size={16} className="shrink-0" />
      We aim to review requests within 24–48 hours. If denied or expired, selected benefits are released and any card authorization is canceled. Your bank controls when a pending hold disappears.</p>
    <p className="mt-4 flex justify-between border-t border-cyan-500/20 pt-3 font-semibold">
      <span>{total === 0 ? 'Amount due' : 'Authorization amount'}</span><span>${Number(total).toFixed(2)}</span></p>
    <label className="mt-4 flex items-start gap-3 text-xs leading-relaxed">
      <input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} className="mt-0.5" />
      <span>I agree to reserve my selected benefits and authorize any amount due while NuVira reviews this delivery request. My card is charged only if approved.</span>
    </label>
    <Button type="button" disabled={!acknowledged || isSubmitting || !zoneEligibility?.checkout_allowed}
      onClick={() => onPrepare(true)} className="mt-4 h-12 w-full rounded-xl">
      {isSubmitting ? 'Preparing secure checkout…' : 'Continue to route review'}<ChevronRight size={16} />
    </Button>
    <button type="button" disabled={isSubmitting} onClick={onCancel} className="mt-3 w-full text-xs underline">Back to cart</button>
  </section>;
}
