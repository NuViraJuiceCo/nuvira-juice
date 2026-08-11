import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { MapPin, CheckCircle2, X, Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { submitCustomerInquiry } from '@/lib/customerCommunications';

export default function OutOfAreaModal({ address, zip, onClose }) {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!email.trim() || !email.includes('@')) {
      toast.error('Please enter a valid email address');
      return;
    }
    setLoading(true);

    try {
      await base44.entities.DeliveryWaitlist.create({
        customer_email: email.trim().toLowerCase(),
        delivery_address: address || zip || 'Area not provided',
        postal_code: zip || '',
        reason: 'outside_zone',
        source: 'checkout',
        status: 'new',
      });
      await submitCustomerInquiry('delivery_waitlist', {
        customer_email: email,
        subject: 'Delivery-area request',
        source: 'checkout_out_of_area',
        metadata: { delivery_address: address, postal_code: zip, requested_area: zip },
      });
      setSubmitted(true);
    } catch {
      toast.error('We could not save your request. Please email support@nuvirajuice.com.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center px-4">
      <motion.div
        initial={{ scale: 0.92, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.92, opacity: 0 }}
        className="relative bg-card rounded-2xl p-6 w-full max-w-sm shadow-2xl"
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 bg-secondary rounded-full flex items-center justify-center"
        >
          <X className="w-4 h-4" />
        </button>

        {!submitted ? (
          <>
            <div className="w-14 h-14 bg-cyan-500/10 rounded-2xl flex items-center justify-center mb-4">
              <MapPin className="w-7 h-7 text-cyan-500" />
            </div>

            <h2 className="font-heading text-xl font-bold mb-2">Outside Our Delivery Area</h2>
            <p className="text-sm text-muted-foreground mb-1 leading-relaxed">
              We're currently delivering within <span className="font-semibold text-foreground">15 miles</span> of O'Fallon, MO — but we're expanding soon!
            </p>
            <p className="text-sm text-muted-foreground mb-5 leading-relaxed">
              Drop your email below and we'll notify you the moment your area is covered. 🌿
            </p>

            <div className="space-y-3">
              <Input
                type="email"
                placeholder="Your email address"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                className="rounded-xl h-11"
                autoFocus
              />
              <Button
                onClick={handleSubmit}
                disabled={loading || !email.trim()}
                className="w-full h-11 rounded-xl font-semibold"
              >
                {loading ? 'Signing you up...' : (
                  <>
                    <Bell className="w-4 h-4 mr-2" />
                    Notify Me When You're in My Area
                  </>
                )}
              </Button>
            </div>

            <p className="text-[10px] text-muted-foreground mt-3 text-center">
              No spam — just one email when we expand to your region.
            </p>
          </>
        ) : (
          <div className="text-center py-4">
            <CheckCircle2 className="w-14 h-14 text-primary mx-auto mb-3" />
            <h2 className="font-heading text-xl font-bold mb-2">You're on the list! 🎉</h2>
            <p className="text-sm text-muted-foreground mb-5">
              We'll email you at <span className="font-semibold text-foreground">{email}</span> as soon as we start delivering to your area.
            </p>
            <Button onClick={onClose} variant="outline" className="rounded-xl w-full">Close</Button>
          </div>
        )}
      </motion.div>
    </div>
  );
}
