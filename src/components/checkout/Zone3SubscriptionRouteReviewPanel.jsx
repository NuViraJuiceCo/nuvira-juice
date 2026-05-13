import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { MapPin, Clock, CheckCircle2, Loader2, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';

/**
 * Zone3SubscriptionRouteReviewPanel
 *
 * Shown on the Subscribe page when the delivery address falls in Zone 3 (route_review)
 * and subscriptions are not yet available there.
 *
 * Flow:
 *  1. Display clear explanation of route review process
 *  2. Customer confirms their info and submits a review request
 *  3. Backend creates DeliveryApprovalRequest (no Stripe subscription created)
 *  4. Customer sees confirmation with request number
 *
 * Props:
 *  address: { street, city, state, zip } — pre-filled from parent
 *  selectedPlan: SubscriptionPlan object
 *  user: auth user object
 *  distanceMiles: number
 *  onBack: () => void — back to normal flow
 */
export default function Zone3SubscriptionRouteReviewPanel({ address, selectedPlan, user, distanceMiles, onBack }) {
  const [phone, setPhone] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [requestNumber, setRequestNumber] = useState('');

  const addressString = [address.street, address.city, address.state, address.zip].filter(Boolean).join(', ');

  const handleSubmit = async () => {
    if (!acknowledged) {
      toast.error('Please acknowledge the route review process to continue.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await base44.functions.invoke('createZone3SubscriptionReviewRequest', {
        plan_id: selectedPlan.id,
        customer_email: user.email,
        customer_phone: phone.trim() || undefined,
        delivery_address: addressString,
        address_line1: address.street || '',
        address_city: address.city || '',
        address_state: address.state || '',
        address_postal_code: address.zip || '',
        save_payment_method: false,
      });

      const data = res?.data;
      if (data?.success) {
        setRequestNumber(data.request_number);
        setSubmitted(true);
      } else {
        toast.error(data?.error || 'Failed to submit route review request. Please try again.');
      }
    } catch (err) {
      toast.error(err?.message || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // Success state
  if (submitted) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mx-4 mt-6 space-y-4"
      >
        <div className="bg-primary/5 border border-primary/20 rounded-2xl p-6 text-center">
          <CheckCircle2 className="w-12 h-12 text-primary mx-auto mb-3" />
          <h2 className="font-heading text-xl font-bold mb-1">Route Review Submitted!</h2>
          <p className="text-sm text-muted-foreground mb-4">
            We'll review your delivery route and notify you within 24–48 hours.
          </p>
          <div className="bg-background rounded-xl px-4 py-3 mb-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Request Number</p>
            <p className="font-mono font-bold text-base">{requestNumber}</p>
          </div>
          <div className="space-y-2 text-left text-xs text-muted-foreground">
            <p className="flex items-start gap-2"><Clock className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-500" /> Review takes 24–48 hours</p>
            <p className="flex items-start gap-2"><CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary" /> You'll be notified by email and in-app when approved</p>
            <p className="flex items-start gap-2"><CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary" /> No charge until your subscription is active</p>
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-4 mt-4 space-y-4"
    >
      {/* Header */}
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 bg-amber-100 rounded-xl flex items-center justify-center shrink-0 mt-0.5">
            <MapPin className="w-4 h-4 text-amber-600" />
          </div>
          <div>
            <p className="font-semibold text-sm text-amber-900">Subscription Route Review Required</p>
            <p className="text-xs text-amber-700 mt-0.5 leading-relaxed">
              Your address is {distanceMiles ? `${distanceMiles.toFixed(1)} miles` : 'outside our standard zone'} from our kitchen. 
              Subscriptions for your area require a quick route review before we can activate recurring deliveries.
            </p>
          </div>
        </div>
      </div>

      {/* Plan summary */}
      <div className="bg-card border border-border/50 rounded-2xl p-4">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Selected Plan</p>
        <div className="flex items-center justify-between">
          <div>
            <p className="font-semibold text-sm">{selectedPlan.name}</p>
            <p className="text-xs text-muted-foreground">{selectedPlan.frequency === 'weekly' ? '1 delivery/week' : '4 deliveries/month'} · {selectedPlan.bottle_count} bottles</p>
          </div>
          <p className="font-bold text-primary">${selectedPlan.base_price}<span className="text-xs font-normal text-muted-foreground">/{selectedPlan.frequency === 'weekly' ? 'wk' : 'mo'}</span></p>
        </div>
      </div>

      {/* Delivery address */}
      <div className="bg-card border border-border/50 rounded-2xl p-4">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Delivery Address</p>
        <p className="text-sm font-medium">{addressString}</p>
      </div>

      {/* Optional phone */}
      <div>
        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-1.5">Phone (optional — for faster contact)</label>
        <input
          type="tel"
          value={phone}
          onChange={e => setPhone(e.target.value)}
          placeholder="(314) 555-0100"
          className="w-full h-11 px-3 rounded-xl border border-input bg-card text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      {/* What happens next */}
      <div className="bg-secondary/40 rounded-2xl p-4 space-y-2">
        <p className="text-xs font-semibold">What happens next:</p>
        <div className="space-y-1.5 text-xs text-muted-foreground">
          <p>1. We review your address and delivery route (24–48 hours)</p>
          <p>2. If approved, you'll receive a notification to complete payment</p>
          <p>3. Your subscription activates after payment is confirmed</p>
          <p>4. <strong className="text-foreground">No charge is made until your route is approved</strong></p>
        </div>
      </div>

      {/* Acknowledgment */}
      <label className="flex items-start gap-3 cursor-pointer">
        <div
          onClick={() => setAcknowledged(!acknowledged)}
          className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
            acknowledged ? 'bg-primary border-primary' : 'border-border'
          }`}
        >
          {acknowledged && <CheckCircle2 className="w-3 h-3 text-primary-foreground" />}
        </div>
        <span className="text-xs text-muted-foreground leading-relaxed">
          I understand this is a route review request, not an immediate subscription. No payment will be taken until my route is approved and I complete checkout.
        </span>
      </label>

      {/* Actions */}
      <div className="space-y-2 pb-6">
        <Button
          onClick={handleSubmit}
          disabled={submitting || !acknowledged}
          className="w-full h-12 rounded-xl font-semibold text-sm"
        >
          {submitting ? (
            <span className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Submitting...</span>
          ) : 'Submit Route Review Request'}
        </Button>
        <button
          onClick={onBack}
          disabled={submitting}
          className="w-full flex items-center justify-center gap-1.5 text-xs text-muted-foreground py-1 hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-3 h-3" />
          Change address or plan
        </button>
      </div>
    </motion.div>
  );
}