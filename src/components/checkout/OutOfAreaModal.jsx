import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { MapPin, CheckCircle2, X, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';

export default function OutOfAreaModal({ address, zip, onClose, cartItems = [] }) {
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    message: '',
  });
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const set = (field) => (e) => setForm(prev => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.email.trim()) {
      toast.error('Please fill in your name and email');
      return;
    }
    setLoading(true);

    const itemsSummary = cartItems.length > 0
      ? cartItems.map(i => `${i.quantity}x ${i.title} ($${(i.price * i.quantity).toFixed(2)})`).join('\n')
      : 'No items specified';

    const emailBody = `
New out-of-area delivery inquiry from NuVira website:

Name: ${form.name}
Email: ${form.email}
Phone: ${form.phone || 'Not provided'}
Delivery Address: ${address || 'Not provided'}

Items They Want to Order:
${itemsSummary}

Additional Message:
${form.message || 'None'}
    `.trim();

    await base44.integrations.Core.SendEmail({
      to: 'info@nuvirajuice.com',
      subject: `Out-of-Area Delivery Inquiry — ${form.name}`,
      body: emailBody,
    });

    // Also add to waitlist for future expansion
    await base44.entities.DeliveryWaitlist.create({
      email: form.email.trim(),
      address,
      zip,
    });

    setLoading(false);
    setSubmitted(true);
  };

  return (
    <div className="fixed inset-0 z-40 bg-black/50 flex items-end justify-center px-4 pb-8">
      <motion.div
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 80, opacity: 0 }}
        className="bg-card rounded-2xl p-6 w-full max-w-md shadow-xl max-h-[90vh] overflow-y-auto"
      >
        <button onClick={onClose} className="absolute top-4 right-4 w-8 h-8 bg-secondary rounded-full flex items-center justify-center">
          <X className="w-4 h-4" />
        </button>

        {!submitted ? (
          <>
            <div className="w-12 h-12 bg-amber-500/10 rounded-2xl flex items-center justify-center mb-4">
              <MapPin className="w-6 h-6 text-amber-500" />
            </div>
            <h2 className="font-heading text-xl font-bold mb-1">Just Outside Our Range</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Your address is outside our standard 15-mile delivery area — but we may still be able to get to you! Fill out the form below and our team will reach out.
            </p>

            <div className="space-y-3">
              <Input
                placeholder="Your name *"
                value={form.name}
                onChange={set('name')}
                className="rounded-xl h-11"
              />
              <Input
                type="email"
                placeholder="Email address *"
                value={form.email}
                onChange={set('email')}
                className="rounded-xl h-11"
              />
              <Input
                type="tel"
                placeholder="Phone number (optional)"
                value={form.phone}
                onChange={set('phone')}
                className="rounded-xl h-11"
              />
              {/* Address pre-filled but editable */}
              <Input
                placeholder="Delivery address"
                value={address}
                readOnly
                className="rounded-xl h-11 bg-muted/50 text-muted-foreground"
              />
              {cartItems.length > 0 && (
                <div className="bg-secondary/50 rounded-xl p-3 text-xs text-muted-foreground">
                  <p className="font-semibold text-foreground mb-1">Items you'd like to order:</p>
                  {cartItems.map((item, i) => (
                    <p key={i}>{item.quantity}x {item.title} — ${(item.price * item.quantity).toFixed(2)}</p>
                  ))}
                </div>
              )}
              <textarea
                placeholder="Anything else you'd like us to know? (optional)"
                value={form.message}
                onChange={set('message')}
                rows={3}
                className="w-full rounded-xl border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
              />
            </div>

            <Button
              onClick={handleSubmit}
              disabled={loading || !form.name.trim() || !form.email.trim()}
              className="w-full h-11 rounded-xl mt-4 font-semibold"
            >
              {loading ? 'Sending...' : (
                <>
                  <Send className="w-4 h-4 mr-2" />
                  Send Inquiry to Our Team
                </>
              )}
            </Button>
            <p className="text-[10px] text-muted-foreground mt-2 text-center">
              We'll follow up with you within 24 hours.
            </p>
          </>
        ) : (
          <div className="text-center py-4">
            <CheckCircle2 className="w-12 h-12 text-primary mx-auto mb-3" />
            <h2 className="font-heading text-xl font-bold mb-1">Inquiry Sent! 🎉</h2>
            <p className="text-sm text-muted-foreground mb-5">
              Our team at <span className="font-semibold text-foreground">info@nuvirajuice.com</span> will review your request and get back to you within 24 hours to see if we can make it work!
            </p>
            <Button onClick={onClose} variant="outline" className="rounded-xl">Close</Button>
          </div>
        )}
      </motion.div>
    </div>
  );
}