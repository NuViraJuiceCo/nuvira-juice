import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, CheckCircle, MapPin, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import SEO from '@/components/SEO';

/**
 * Zone3ReviewSubmitted — shown after customer successfully authorizes a Zone 3 route review.
 * Accessed via navigate('/zone3-review-submitted', { state: { requestNumber, darId, total, address } })
 */
export default function Zone3ReviewSubmitted() {
  const navigate = useNavigate();
  const state = window.history.state?.usr || {};
  const { requestNumber, total, address } = state;

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 pb-12 text-center">
      <SEO title="Route Review Submitted" noindex={true} />

      <div className="w-20 h-20 rounded-full bg-cyan-100 dark:bg-cyan-900/30 flex items-center justify-center mb-6">
        <Clock className="w-10 h-10 text-cyan-600" />
      </div>

      <h1 className="font-heading text-2xl font-bold mb-3">Route Review Submitted</h1>
      <p className="text-sm text-muted-foreground leading-relaxed max-w-xs mb-6">
        We've received your delivery request and placed a temporary authorization hold on your card.
        Our team will review your route and respond within <strong className="text-foreground">24–48 hours</strong>.
      </p>

      {requestNumber && (
        <div className="bg-secondary/50 rounded-xl px-4 py-3 mb-6 w-full max-w-xs text-left">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Request Details</p>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-muted-foreground">Request #</span>
            <span className="font-mono font-semibold">{requestNumber}</span>
          </div>
          {total != null && (
            <div className="flex justify-between text-sm mb-1">
              <span className="text-muted-foreground">Auth Hold</span>
              <span className="font-semibold">${Number(total).toFixed(2)}</span>
            </div>
          )}
          {address && (
            <div className="flex items-start gap-1.5 mt-2">
              <MapPin className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
              <span className="text-xs text-muted-foreground leading-snug">{address}</span>
            </div>
          )}
        </div>
      )}

      <div className="space-y-3 w-full max-w-xs mb-6">
        <div className="flex items-start gap-3 text-left">
          <CheckCircle className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground">If approved, your card will be charged and your order will be scheduled immediately.</p>
        </div>
        <div className="flex items-start gap-3 text-left">
          <CheckCircle className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground">If denied, the hold is released right away — no charge, ever.</p>
        </div>
        <div className="flex items-start gap-3 text-left">
          <CheckCircle className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground">You'll receive an in-app notification and email with the decision.</p>
        </div>
      </div>

      <Button
        onClick={() => navigate('/account/orders')}
        className="w-full max-w-xs h-12 rounded-xl font-semibold mb-3"
      >
        View My Orders <ArrowRight className="w-4 h-4 ml-1" />
      </Button>

      <button onClick={() => navigate('/')} className="text-xs text-muted-foreground underline">
        Back to Home
      </button>
    </div>
  );
}