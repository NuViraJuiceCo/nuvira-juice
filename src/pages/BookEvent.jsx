import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Calendar, Users, Sparkles, Heart, PartyPopper, GlassWater, Mail, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';

const HERO_URL = "https://media.base44.com/images/public/69d48d0c39891f7945481152/99e225ed4_DSC02438-Edit-2.jpg";
const LOGO_URL = "https://media.base44.com/images/public/69d48d0c39891f7945481152/b04d63077_Asset18322x.png";

const eventTypes = [
  { icon: PartyPopper, label: 'Birthday Party' },
  { icon: Heart, label: 'Bridal Shower' },
  { icon: Sparkles, label: 'Baby Shower' },
  { icon: GlassWater, label: 'Corporate Event' },
  { icon: Users, label: 'Wellness Retreat' },
  { icon: Calendar, label: 'Other' },
];

const includes = [
  'Fresh cold-pressed juice bar setup',
  'Custom bottle labels for your event',
  'Curated flavor menu for your guests',
  'On-site or pre-packaged service options',
  'Flexible quantities for any group size',
  'A beautiful, wellness-forward experience',
];

export default function BookEvent() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: '', email: '', phone: '', eventType: '', date: '', guests: '', venue: '', notes: '',
  });
  const [loading, setLoading] = useState(false);

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const handleSubmit = async () => {
    if (!form.name || !form.email || !form.eventType) {
      toast.error('Please fill in your name, email, and event type.');
      return;
    }
    setLoading(true);
    await base44.integrations.Core.SendEmail({
      to: 'nuvirajuiceco@gmail.com',
      subject: `Event Booking Inquiry — ${form.eventType} · ${form.name}`,
      body: `New event booking inquiry:\n\nName: ${form.name}\nEmail: ${form.email}\nPhone: ${form.phone || 'Not provided'}\nEvent Type: ${form.eventType}\nEvent Date: ${form.date || 'Not specified'}\nGuest Count: ${form.guests || 'Not specified'}\nVenue: ${form.venue || 'Not specified'}\nAdditional Notes: ${form.notes || 'None'}`,
    });
    setLoading(false);
    toast.success("We received your inquiry! We'll be in touch within 48 hours to plan your event.");
    setForm({ name: '', email: '', phone: '', eventType: '', date: '', guests: '', venue: '', notes: '' });
  };

  return (
    <div className="min-h-screen bg-background pb-10">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border/40 flex items-center gap-3 px-4 py-3">
        <button onClick={() => navigate(-1)} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-muted transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <span className="font-heading text-base font-semibold">Book Us for Your Event</span>
      </div>

      {/* Hero */}
      <div className="relative h-56 overflow-hidden">
        <img src={HERO_URL} alt="NuVira Event" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-primary/70 via-primary/60 to-primary/90" />
        <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
          <img src={LOGO_URL} alt="NuVira" className="h-9 mb-3 drop-shadow-lg" />
          <h1 className="font-heading text-2xl font-bold text-white leading-tight">
            Make Your Event<br />Unforgettable
          </h1>
          <p className="text-white/80 text-xs mt-2 leading-relaxed">
            Fresh cold-pressed juice experiences for life's most special moments
          </p>
        </div>
      </div>

      {/* Event Type Selector */}
      <div className="px-4 mt-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">What's the Occasion?</p>
        <div className="grid grid-cols-3 gap-2">
          {eventTypes.map(({ icon: Icon, label }, i) => (
            <motion.button
              key={label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              onClick={() => set('eventType', label)}
              className={`flex flex-col items-center gap-1.5 p-3 rounded-2xl border-2 transition-all ${
                form.eventType === label
                  ? 'border-primary bg-primary/10'
                  : 'border-border/40 bg-card'
              }`}
            >
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                form.eventType === label ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'
              }`}>
                <Icon className="w-4 h-4" />
              </div>
              <p className="text-[10px] font-semibold text-center leading-tight">{label}</p>
            </motion.button>
          ))}
        </div>
      </div>

      {/* What's Included */}
      <div className="px-4 mt-6">
        <div className="bg-gradient-to-br from-primary/10 to-accent/5 border border-primary/20 rounded-2xl p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">What's Included</p>
          <div className="space-y-2">
            {includes.map(item => (
              <div key={item} className="flex items-start gap-2.5">
                <Check className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
                <p className="text-sm text-foreground/80">{item}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Form */}
      <div className="px-4 mt-6 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Event Details</p>

        <div className="grid grid-cols-2 gap-3">
          <Input placeholder="Your Name" value={form.name} onChange={e => set('name', e.target.value)} className="rounded-xl h-11" />
          <Input placeholder="Email Address" type="email" value={form.email} onChange={e => set('email', e.target.value)} className="rounded-xl h-11" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input placeholder="Phone (optional)" type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} className="rounded-xl h-11" />
          <Input placeholder="Event Date" type="date" value={form.date} onChange={e => set('date', e.target.value)} className="rounded-xl h-11" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input placeholder="# of Guests" type="number" min="1" value={form.guests} onChange={e => set('guests', e.target.value)} className="rounded-xl h-11" />
          <Input placeholder="Venue / Location" value={form.venue} onChange={e => set('venue', e.target.value)} className="rounded-xl h-11" />
        </div>

        <textarea
          placeholder="Tell us more about your event — vibe, theme, any special requests..."
          value={form.notes}
          onChange={e => set('notes', e.target.value)}
          rows={3}
          className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
        />

        <Button onClick={handleSubmit} disabled={loading} className="w-full h-12 rounded-xl font-semibold text-sm">
          {loading ? 'Sending...' : 'Request Your Event Quote'}
          {!loading && <Sparkles className="w-4 h-4 ml-1" />}
        </Button>

        <p className="text-center text-[10px] text-muted-foreground">
          We respond within 48 hours. Pricing is customized based on your event size and needs.
        </p>
      </div>
    </div>
  );
}