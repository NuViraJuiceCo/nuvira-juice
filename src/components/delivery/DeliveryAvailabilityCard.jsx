import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MapPin, CheckCircle, ArrowRight, Leaf } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import {
  getDeliveryAvailability,
  setDeliveryAvailability,
  getEligibilityStatus,
} from '@/lib/deliveryAvailability';
import WaitlistForm from '@/components/delivery/WaitlistForm';
import { Link } from 'react-router-dom';

export default function DeliveryAvailabilityCard() {
  const [zip, setZip] = useState('');
  const [status, setStatus] = useState('idle'); // idle | checking | eligible | ineligible | error
  const [showWaitlist, setShowWaitlist] = useState(false);
  const [zipError, setZipError] = useState('');

  // On mount, restore any prior session check
  useEffect(() => {
    const saved = getDeliveryAvailability();
    if (saved?.checked_zip_code) {
      setZip(saved.checked_zip_code);
      setStatus(saved.delivery_eligibility_status === 'eligible' ? 'eligible' : 'ineligible');
    }
  }, []);

  // If already confirmed eligible this session, show compact success state
  const sessionStatus = getEligibilityStatus();
  if (sessionStatus === 'eligible' && status === 'idle') {
    // Will be caught by the useEffect above
  }

  const handleCheck = async () => {
    setZipError('');
    const clean = zip.trim();
    if (!/^\d{5}$/.test(clean)) {
      setZipError('Please enter a valid 5-digit ZIP code.');
      return;
    }

    setStatus('checking');
    try {
      const res = await base44.functions.invoke('validateDeliveryEligibility', {
        delivery_address: clean,
        address_postal_code: clean,
        cart_subtotal: 0,
        order_type: 'one_time',
        zip_only_check: true,
      });
      const eligibility = res.data;
      const isEligible = !!eligibility?.checkout_allowed && (
        eligibility.zone_type === 'core' ||
        eligibility.zone_type === 'extended' ||
        eligibility.zone_type === 'route_review'
      );

      setDeliveryAvailability({
        checked_zip_code: clean,
        delivery_eligibility_status: isEligible ? 'eligible' : 'ineligible',
        matched_delivery_zone_id: eligibility?.zone_key || null,
        matched_delivery_zone_name: eligibility?.zone_name || null,
      });

      setStatus(isEligible ? 'eligible' : 'ineligible');
    } catch {
      // Network/unexpected error — do NOT mark ineligible; let customer try again
      setStatus('idle');
      setZipError('Something went wrong. Please try again.');
    }
  };

  const handleReset = () => {
    setStatus('idle');
    setZip('');
    setZipError('');
    setShowWaitlist(false);
  };

  return (
    <div className="mx-5 my-8">
      <div
        className="rounded-2xl border border-border/60 overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, hsl(var(--card)) 0%, hsl(var(--primary) / 0.04) 100%)',
        }}
      >
        {/* ── Eligible State ── */}
        <AnimatePresence mode="wait">
          {status === 'eligible' && (
            <motion.div
              key="eligible"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="p-5"
            >
              <div className="flex items-start gap-3.5">
                <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center shrink-0 border border-primary/20">
                  <CheckCircle className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-heading text-base font-bold text-foreground leading-snug">
                    Your Area May Be Eligible For Fresh Delivery
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                    NuVira currently serves select areas near ZIP {zip}. Your full delivery address will be confirmed at checkout.
                  </p>
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <Link to="/shop" className="flex-1">
                  <button className="w-full h-10 rounded-xl bg-primary text-primary-foreground text-sm font-semibold flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform">
                    Start My Order <ArrowRight className="w-4 h-4" />
                  </button>
                </Link>
                <button
                  onClick={handleReset}
                  className="h-10 px-4 rounded-xl border border-border/60 text-xs text-muted-foreground active:bg-secondary/50 transition-colors"
                >
                  Change ZIP
                </button>
              </div>
            </motion.div>
          )}

          {/* ── Ineligible / Waitlist State ── */}
          {status === 'ineligible' && !showWaitlist && (
            <motion.div
              key="ineligible"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="p-5"
            >
              <div className="flex items-start gap-3.5">
                <div className="w-10 h-10 rounded-xl bg-accent/15 flex items-center justify-center shrink-0 border border-accent/20">
                  <Leaf className="w-5 h-5 text-accent" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-heading text-base font-bold text-foreground leading-snug">
                    We're Not In Your Area Yet — But We're Expanding
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                    NuVira is currently delivering within select St. Louis-area zones. Join the delivery waitlist and we'll notify you as soon as your area opens.
                  </p>
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => setShowWaitlist(true)}
                  className="flex-1 h-10 rounded-xl bg-primary text-primary-foreground text-sm font-semibold active:scale-[0.98] transition-transform"
                >
                  Join The Waitlist
                </button>
                <button
                  onClick={handleReset}
                  className="h-10 px-4 rounded-xl border border-border/60 text-xs text-muted-foreground active:bg-secondary/50 transition-colors"
                >
                  Try Another ZIP
                </button>
              </div>
            </motion.div>
          )}

          {/* ── Waitlist Form ── */}
          {status === 'ineligible' && showWaitlist && (
            <motion.div
              key="waitlist"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              <WaitlistForm
                zip={zip}
                onSuccess={() => setShowWaitlist(false)}
                onBack={() => setShowWaitlist(false)}
              />
            </motion.div>
          )}

          {/* ── Idle / Input State ── */}
          {(status === 'idle' || status === 'checking') && (
            <motion.div
              key="idle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="p-5"
            >
              {/* Header */}
              <div className="flex items-center gap-2.5 mb-4">
                <div className="w-9 h-9 rounded-xl bg-primary/12 flex items-center justify-center border border-primary/15">
                  <MapPin className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="font-heading text-sm font-bold text-foreground leading-tight">
                    Fresh Delivery In The St. Louis Area
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Currently serving select St. Louis, St. Charles County, and surrounding areas.
                  </p>
                </div>
              </div>

              {/* ZIP Input */}
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={5}
                    value={zip}
                    onChange={e => {
                      setZipError('');
                      setZip(e.target.value.replace(/\D/g, '').slice(0, 5));
                    }}
                    onKeyDown={e => e.key === 'Enter' && handleCheck()}
                    placeholder="Enter ZIP code"
                    className="w-full h-11 px-4 rounded-xl border border-border/60 bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/50 transition-all"
                  />
                </div>
                <button
                  onClick={handleCheck}
                  disabled={status === 'checking'}
                  className="h-11 px-5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold shrink-0 disabled:opacity-60 active:scale-[0.97] transition-transform"
                >
                  {status === 'checking' ? (
                    <span className="flex items-center gap-1.5">
                      <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" />
                      Checking
                    </span>
                  ) : 'Check Availability'}
                </button>
              </div>

              {zipError && (
                <p className="text-xs text-destructive mt-1.5 font-medium">{zipError}</p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}