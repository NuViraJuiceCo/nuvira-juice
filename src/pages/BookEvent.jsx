import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Calendar, Users, Sparkles, Heart, PartyPopper, GlassWater, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { submitCustomerInquiry } from '@/lib/customerCommunications';

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

const juiceOptions = [
  { value: 'bottles', label: 'Full Bottles', desc: '12oz fresh cold-pressed' },
  { value: 'samples', label: 'Tasting Samples', desc: '2-4oz tastings' },
];

const serviceModels = [
  { value: 'prepurchase', label: 'You Pre-Purchase', desc: 'You buy bottles, provide free to guests' },
  { value: 'consignment', label: 'We Sell On-Site', desc: 'We bring bottles, you set deposit for special pricing' },
];

function getTomorrowMinDate() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.toISOString().split('T')[0];
}

const includes = [
  'Fresh cold-pressed juice bar setup',
  'Our full menu of available flavors',
  'Pre-packaged bottles or samples',
  'Flexible quantities for any group size',
  'Optional event pricing with deposit',
  'A beautiful, wellness-forward experience',
];

export default function BookEvent() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: '', email: '', phone: '', eventType: '', date: '', guests: '', juiceType: '', serviceModel: '', venue: '', notes: '',
  });
  const [loading, setLoading] = useState(false);

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));
  const minDate = getTomorrowMinDate();

  const handleSubmit = async () => {
    if (!form.name || !form.email || !form.eventType) {
      toast.error('Please fill in your name, email, and event type.');
      return;
    }
    setLoading(true);
    const juiceTypeLabel = juiceOptions.find(j => j.value === form.juiceType)?.label || 'Not specified';
    const serviceModelLabel = serviceModels.find(s => s.value === form.serviceModel)?.label || 'Not specified';
    try {
      await submitCustomerInquiry('event', {
        customer_name: form.name,
        customer_email: form.email,
        customer_phone: form.phone,
        subject: `${form.eventType} event inquiry`,
        message: form.notes,
        source: 'book_event_page',
        metadata: {
          event_type: form.eventType,
          event_date: form.date,
          guest_count: form.guests,
          juice_type: juiceTypeLabel,
          service_model: serviceModelLabel,
          venue: form.venue,
        },
      });
      toast.success("We received your inquiry! We'll be in touch within 48 hours to plan your event.");
      setForm({ name: '', email: '', phone: '', eventType: '', date: '', guests: '', juiceType: '', serviceModel: '', venue: '', notes: '' });
    } catch {
      toast.error('We could not send your inquiry. Please email support@nuvirajuice.com.');
    } finally {
      setLoading(false);
    }
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
        <div className="absolute inset-0 bg-gradient-to-b from-primary/40 via-primary/60 to-primary/90" />
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
                  ? 'border-primary bg-nuvira-gradient-soft'
                  : 'border-border/40 bg-card'
              }`}
            >
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                form.eventType === label ? 'nuvira-icon-badge' : 'bg-secondary text-muted-foreground'
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
        <div className="nuvira-premium-card rounded-2xl p-5">
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
          <Input placeholder="Event Date" type="date" value={form.date} onChange={e => set('date', e.target.value)} min={minDate} className="rounded-xl h-11" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input placeholder="# of Guests" type="number" min="1" value={form.guests} onChange={e => set('guests', e.target.value)} className="rounded-xl h-11" />
          <Input placeholder="Venue / Location" value={form.venue} onChange={e => set('venue', e.target.value)} className="rounded-xl h-11" />
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">What Kind of Juice Service?</p>
          <div className="grid grid-cols-2 gap-2">
            {juiceOptions.map(({ value, label, desc }) => (
              <button
                key={value}
                onClick={() => set('juiceType', value)}
                className={`p-3 rounded-xl border-2 transition-all text-left ${
                  form.juiceType === value
                    ? 'border-primary bg-nuvira-gradient-soft'
                    : 'border-border/40 bg-card'
                }`}
              >
                <p className="text-sm font-semibold">{label}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{desc}</p>
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">How Will This Work?</p>
          <div className="grid grid-cols-2 gap-2">
            {serviceModels.map(({ value, label, desc }) => (
              <button
                key={value}
                onClick={() => set('serviceModel', value)}
                className={`p-3 rounded-xl border-2 transition-all text-left ${
                  form.serviceModel === value
                    ? 'border-primary bg-nuvira-gradient-soft'
                    : 'border-border/40 bg-card'
                }`}
              >
                <p className="text-sm font-semibold">{label}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{desc}</p>
              </button>
            ))}
          </div>
        </div>

        <textarea
          placeholder="Tell us more about your event — vibe, theme, any special requests..."
          value={form.notes}
          onChange={e => set('notes', e.target.value)}
          rows={3}
          className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
        />

        <Button onClick={handleSubmit} disabled={loading} className="nuvira-gradient-button w-full h-12 rounded-xl font-semibold text-sm">
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
