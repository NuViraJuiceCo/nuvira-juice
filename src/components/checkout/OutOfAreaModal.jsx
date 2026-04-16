import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { MapPin, Mail, CheckCircle2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { base44 } from '@/api/base44Client';

export default function OutOfAreaModal({ address, zip, onClose }) {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!email.trim()) return;
    setLoading(true);
    await base44.entities.DeliveryWaitlist.create({
      email: email.trim(),
      address,
      zip,
    });
    setLoading(false);
    setSubmitted(true);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end justify-center px-4 pb-8">
      <motion.div
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 80, opacity: 0 }}
        className="bg-card rounded-2xl p-6 w-full max-w-md shadow-xl"
      >
        <button onClick={onClose} className="absolute top-4 right-4 w-8 h-8 bg-secondary rounded-full flex items-center justify-center">
          <X className="w-4 h-4" />
        </button>

        {!submitted ? (
          <>
            <div className="w-12 h-12 bg-amber-500/10 rounded-2xl flex items-center justify-center mb-4">
              <MapPin className="w-6 h-6 text-amber-500" />
            </div>
            <h2 className="font-heading text-xl font-bold mb-1">We're not in your area yet</h2>
            <p className="text-sm text-muted-foreground mb-5">
              We currently deliver locally in the Wentzville & St. Louis area. Shipping is coming soon — drop your email and you'll be the first to know when we expand!
            </p>

            <div className="flex gap-2">
              <Input
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="rounded-xl h-11 flex-1"
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              />
              <Button onClick={handleSubmit} disabled={loading || !email.trim()} className="rounded-xl h-11 px-4">
                <Mail className="w-4 h-4" />
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground mt-3 text-center">No spam — just a heads up when delivery comes to you.</p>
          </>
        ) : (
          <div className="text-center py-4">
            <CheckCircle2 className="w-12 h-12 text-primary mx-auto mb-3" />
            <h2 className="font-heading text-xl font-bold mb-1">You're on the list!</h2>
            <p className="text-sm text-muted-foreground mb-5">We'll email you as soon as we expand to your area.</p>
            <Button onClick={onClose} variant="outline" className="rounded-xl">Close</Button>
          </div>
        )}
      </motion.div>
    </div>
  );
}