import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle, ArrowLeft } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { Link } from 'react-router-dom';

export default function WaitlistForm({ zip, onSuccess, onBack }) {
  const [form, setForm] = useState({ first_name: '', email: '', phone: '' });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    setError('');
    if (!form.first_name.trim()) { setError('Please enter your first name.'); return; }
    if (!form.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      setError('Please enter a valid email address.');
      return;
    }

    setSubmitting(true);
    try {
      // Deduplication check — don't create duplicate for same email + ZIP
      const existing = await base44.entities.DeliveryWaitlist.filter({
        customer_email: form.email.trim().toLowerCase(),
        postal_code: zip,
      });
      if (existing.length === 0) {
        const createData = {
          customer_name: form.first_name.trim(),
          customer_email: form.email.trim().toLowerCase(),
          delivery_address: zip,
          postal_code: zip,
          source: 'checkout',
          status: 'new',
          reason: 'outside_zone',
          admin_notes: 'Submitted via homepage delivery availability checker',
        };
        if (form.phone.trim()) createData.customer_phone = form.phone.trim();
        await base44.entities.DeliveryWaitlist.create(createData);
      }
      setSubmitted(true);
      onSuccess?.();
    } catch (err) {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="p-5 text-center"
      >
        <div className="w-12 h-12 rounded-full nuvira-icon-badge flex items-center justify-center mx-auto mb-3">
          <CheckCircle className="w-6 h-6 text-white" />
        </div>
        <p className="font-heading text-base font-bold text-foreground mb-1">You're On The List</p>
        <p className="text-xs text-muted-foreground leading-relaxed max-w-xs mx-auto">
          We'll notify you as soon as NuVira delivery becomes available in your area.
        </p>
        <div className="flex gap-2 mt-4">
          <Link to="/shop" className="flex-1">
            <button className="w-full h-10 rounded-xl nuvira-gradient-button text-sm font-semibold active:scale-[0.98] transition-transform">
              Continue Browsing
            </button>
          </Link>
        </div>
      </motion.div>
    );
  }

  return (
    <div className="p-5">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-xs text-muted-foreground mb-4 active:opacity-60 transition-opacity"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Back
      </button>

      <p className="font-heading text-sm font-bold text-foreground mb-0.5">Join The Waitlist</p>
      <p className="text-xs text-muted-foreground mb-4">
        Be the first to know when NuVira delivers to <span className="font-semibold text-foreground">{zip}</span>.
      </p>

      <div className="space-y-2.5">
        <input
          type="text"
          placeholder="First name *"
          value={form.first_name}
          onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))}
          className="w-full h-11 px-4 rounded-xl border border-border/60 bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/50 transition-all"
        />
        <input
          type="email"
          inputMode="email"
          placeholder="Email address *"
          value={form.email}
          onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
          className="w-full h-11 px-4 rounded-xl border border-border/60 bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/50 transition-all"
        />
        <input
          type="tel"
          inputMode="tel"
          placeholder="Phone (optional)"
          value={form.phone}
          onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
          className="w-full h-11 px-4 rounded-xl border border-border/60 bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/50 transition-all"
        />
      </div>

      {error && (
        <p className="text-xs text-destructive mt-2 font-medium">{error}</p>
      )}

      <button
        onClick={handleSubmit}
        disabled={submitting}
        className="w-full h-11 rounded-xl nuvira-gradient-button text-sm font-semibold mt-4 disabled:opacity-60 active:scale-[0.98] transition-transform"
      >
        {submitting ? (
          <span className="flex items-center justify-center gap-2">
            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Joining...
          </span>
        ) : 'Join The Waitlist'}
      </button>

      <p className="text-[10px] text-muted-foreground/70 text-center mt-2">
        No spam, ever. Just a heads-up when your area opens.
      </p>
    </div>
  );
}
