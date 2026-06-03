import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MapPin, Clock, AlertTriangle, CheckSquare, Square, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { base44 } from '@/api/base44Client';
import EmbeddedPayment from './EmbeddedPayment';

/**
 * Zone3RouteReviewPanel
 * Shown in checkout when validateDeliveryEligibility returns zone_type=route_review.
 * Handles disclosure, authorization, and post-auth confirmation.
 */
export default function Zone3RouteReviewPanel({
  zoneEligibility,
  items,
  subtotal,
  address,
  phone,
  customerEmail,
  customerName,
  onSuccess,
  onCancel,
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [clientSecret, setClientSecret] = useState(null);
  const [publishableKey, setPublishableKey] = useState(null);
  const [requestNumber, setRequestNumber] = useState(null);
  const [darId, setDarId] = useState(null);
  const [effectiveTotal, setEffectiveTotal] = useState(0);
  const [error, setError] = useState(null);

  const estimatedFee = zoneEligibility?.delivery_fee ?? 12.99;
  const total = Math.round(((subtotal || 0) + estimatedFee) * 100) / 100;

  const handleAuthorize = async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      const addrString = [address.street, address.city, address.state, address.zip].filter(Boolean).join(', ');
      const res = await base44.functions.invoke('createZone3AuthorizationIntent', {
        items,
        subtotal,
        delivery_fee: estimatedFee,
        total,
        delivery_address: addrString,
        address_line1: address.street || '',
        address_line2: address.street2 || '',
        address_city: address.city || '',
        address_state: address.state || '',
        address_postal_code: address.zip || '',
        contact_phone: phone || '',
        customer_email: customerEmail || '',
        customer_name: customerName || '',
        customer_acknowledged_hold: true,
      });

      if (res.data?.clientSecret) {
        setClientSecret(res.data.clientSecret);
        setPublishableKey(res.data.publishableKey);
        setRequestNumber(res.data.requestNumber);
        setDarId(res.data.darId);
        setEffectiveTotal(res.data.effectiveTotal ?? total);
      } else {
        setError(res.data?.error || 'Failed to create authorization. Please try again.');
      }
    } catch (err) {
      setError(err.message || 'Failed to create authorization. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="px-4 pb-4">
      {/* Zone 3 Badge */}
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 bg-cyan-100 dark:bg-cyan-900/30 rounded-full flex items-center justify-center shrink-0">
          <MapPin className="w-4 h-4 text-cyan-600" />
        </div>
        <div>
          <p className="text-sm font-bold text-foreground">Route Review Required</p>
          <p className="text-xs text-muted-foreground">{zoneEligibility?.estimated_distance_miles?.toFixed(1)} miles from our facility</p>
        </div>
      </div>

      {/* Disclosure Card */}
      <div className="bg-cyan-50 dark:bg-cyan-900/20 border border-cyan-200 dark:border-cyan-800 rounded-xl p-4 mb-4">
        <div className="flex items-start gap-2.5 mb-3">
          <AlertTriangle className="w-4 h-4 text-cyan-600 mt-0.5 shrink-0" />
          <p className="text-sm font-semibold text-cyan-900 dark:text-cyan-200">Authorization Hold Notice</p>
        </div>
        <p className="text-xs text-cyan-800 dark:text-cyan-300 leading-relaxed mb-3">
          Your address is outside our automatic delivery routes. We may still be able to deliver depending on route availability.
          We'll place a <strong>temporary authorization hold</strong> on your card, but <strong>you will not be charged</strong> unless your delivery request is approved by our team.
        </p>
        <div className="flex items-start gap-2.5 mb-3">
          <Clock className="w-4 h-4 text-cyan-600 mt-0.5 shrink-0" />
          <p className="text-xs text-cyan-800 dark:text-cyan-300">
            Our team will review your request and respond within <strong>24–48 hours</strong>. If denied, the hold is released immediately — no charge.
          </p>
        </div>
        {/* Estimated fee */}
        <div className="bg-white/60 dark:bg-black/20 rounded-lg p-2.5 text-xs">
          <div className="flex justify-between mb-1"><span className="text-cyan-800 dark:text-cyan-300">Subtotal</span><span className="font-medium">${(subtotal || 0).toFixed(2)}</span></div>
          <div className="flex justify-between mb-1"><span className="text-cyan-800 dark:text-cyan-300">Est. Delivery Fee</span><span className="font-medium">${estimatedFee.toFixed(2)}</span></div>
          <div className="flex justify-between border-t border-cyan-200/60 pt-1 mt-1"><span className="font-semibold text-cyan-900 dark:text-cyan-200">Auth Hold Amount</span><span className="font-bold">${total.toFixed(2)}</span></div>
        </div>
      </div>

      {/* Acknowledgment Checkbox */}
      {!clientSecret && (
        <button
          onClick={() => setAcknowledged(!acknowledged)}
          className="flex items-start gap-3 w-full text-left mb-5 group"
        >
          <div className="mt-0.5 shrink-0">
            {acknowledged
              ? <CheckSquare className="w-5 h-5 text-primary" />
              : <Square className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors" />
            }
          </div>
          <span className="text-xs text-muted-foreground leading-relaxed">
            I understand this is an <strong>authorization hold only</strong>. My card will only be charged if NuVira approves my delivery request. The hold will be released if my request is denied or expires.
          </span>
        </button>
      )}

      {error && (
        <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-3 mb-4">
          <p className="text-xs text-destructive font-medium">{error}</p>
        </div>
      )}

      {/* Payment Step */}
      {clientSecret ? (
        <div>
          <div className="mb-4 bg-primary/5 rounded-xl p-3">
            <p className="text-xs font-semibold text-primary mb-0.5">Route Review #{requestNumber}</p>
            <p className="text-[11px] text-muted-foreground">Enter your card to place the authorization hold. No charge until approved.</p>
          </div>
          <EmbeddedPayment
            clientSecret={clientSecret}
            publishableKey={publishableKey}
            total={effectiveTotal}
            isSubmitting={isSubmitting}
            setIsSubmitting={setIsSubmitting}
            confirmLabel={`Authorize Hold · $${effectiveTotal.toFixed(2)}`}
            onSuccess={(paymentIntentId) => {
              onSuccess({ requestNumber, darId, paymentIntentId, total: effectiveTotal });
            }}
            onError={(msg) => setError(msg || 'Authorization failed. Please try again.')}
          />
          <button
            onClick={() => { setClientSecret(null); setRequestNumber(null); setDarId(null); }}
            className="w-full text-center text-xs text-muted-foreground underline mt-3"
          >
            ← Back to review details
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <Button
            onClick={handleAuthorize}
            disabled={!acknowledged || isSubmitting}
            className="w-full h-12 rounded-xl font-semibold text-sm bg-cyan-600 hover:bg-cyan-700 text-white"
          >
            {isSubmitting ? 'Processing...' : `Authorize Route Review · $${total.toFixed(2)}`}
            {!isSubmitting && <ChevronRight className="w-4 h-4 ml-1" />}
          </Button>
          <button onClick={onCancel} className="text-xs text-muted-foreground underline text-center">
            Cancel — go back to cart
          </button>
        </div>
      )}
    </div>
  );
}