import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Building2, Dumbbell, Briefcase, Heart, Mail, Check, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';

const LOGO_URL = "https://media.base44.com/images/public/69d48d0c39891f7945481152/b04d63077_Asset18322x.png";

const partnerTypes = [
  { icon: Dumbbell, label: 'Gym / Fitness Studio', example: 'F45 Training, CrossFit, HIIT studios' },
  { icon: Heart, label: 'Wellness Center', example: 'P6 Wellness, yoga studios, spas' },
  { icon: Building2, label: 'Office / Corporate', example: 'Break rooms, team wellness programs' },
  { icon: Briefcase, label: 'Other Business', example: 'Cafes, health shops, events' },
];

const perks = [
  'Fresh cold-pressed juice supplied on your schedule',
  'Custom bundle options for your volume needs',
  'Wholesale pricing (coming soon)',
  'Co-branded marketing support',
  'Priority production slots',
  'Dedicated account contact',
];

export default function Partner() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', business: '', email: '', phone: '', type: '', notes: '' });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!form.name || !form.email || !form.business) {
      toast.error('Please fill in your name, business, and email.');
      return;
    }
    setLoading(true);
    await base44.integrations.Core.SendEmail({
      to: 'info@nuvirajuice.com',
      subject: `New Partnership Inquiry — ${form.business}`,
      body: `Partnership inquiry received:\n\nName: ${form.name}\nBusiness: ${form.business}\nType: ${form.type || 'Not specified'}\nEmail: ${form.email}\nPhone: ${form.phone || 'Not provided'}\nNotes: ${form.notes || 'None'}`,
    });
    setLoading(false);
    toast.success("We got your inquiry! We'll be in touch within 48 hours.");
    setForm({ name: '', business: '', email: '', phone: '', type: '', notes: '' });
  };

  return (
    <div className="min-h-screen bg-background pb-10">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border/40 flex items-center gap-3 px-4 py-3">
        <button onClick={() => navigate(-1)} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-muted transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <span className="font-heading text-base font-semibold">Partner With Us</span>
      </div>

      {/* Hero */}
      <div className="bg-gradient-to-b from-primary/15 to-transparent px-5 pt-6 pb-4 text-center">
        <img src={LOGO_URL} alt="NuVira" className="h-10 mx-auto mb-3" />
        <h1 className="font-heading text-2xl font-bold mb-2">Bring NuVira to Your Space</h1>
        <p className="text-sm text-muted-foreground leading-relaxed max-w-sm mx-auto">
          We partner with gyms, wellness studios, offices, and local businesses to deliver fresh cold-pressed juice directly to your community.
        </p>
      </div>

      {/* Partner Types */}
      <div className="px-4 mt-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Who We Work With</p>
        <div className="grid grid-cols-2 gap-3">
          {partnerTypes.map(({ icon: Icon, label, example }, i) => (
            <motion.div
              key={label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.07 }}
              className="bg-card border border-border/50 rounded-2xl p-4"
            >
              <div className="w-9 h-9 bg-primary/10 rounded-xl flex items-center justify-center mb-2">
                <Icon className="w-4 h-4 text-primary" />
              </div>
              <p className="text-sm font-semibold leading-snug">{label}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug">{example}</p>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Perks */}
      <div className="px-4 mt-6">
        <div className="bg-primary/5 border border-primary/20 rounded-2xl p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">What You Get</p>
          <div className="space-y-2">
            {perks.map(perk => (
              <div key={perk} className="flex items-start gap-2.5">
                <Check className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
                <p className="text-sm text-foreground/80">{perk}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Form */}
      <div className="px-4 mt-6 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Get in Touch</p>

        <div className="grid grid-cols-2 gap-3">
          <Input placeholder="Your Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="rounded-xl h-11" />
          <Input placeholder="Business Name" value={form.business} onChange={e => setForm({ ...form, business: e.target.value })} className="rounded-xl h-11" />
        </div>

        <Input placeholder="Email Address" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className="rounded-xl h-11" />
        <Input placeholder="Phone (optional)" type="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} className="rounded-xl h-11" />

        {/* Business Type Select */}
        <Select value={form.type} onValueChange={val => setForm({ ...form, type: val })}>
          <SelectTrigger className="w-full h-11 rounded-xl">
            <SelectValue placeholder="Business Type (optional)" />
          </SelectTrigger>
          <SelectContent>
            {partnerTypes.map(t => (
              <SelectItem key={t.label} value={t.label}>{t.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <textarea
          placeholder="Tell us about your space and what you're looking for (optional)"
          value={form.notes}
          onChange={e => setForm({ ...form, notes: e.target.value })}
          rows={3}
          className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
        />

        <Button onClick={handleSubmit} disabled={loading} className="w-full h-12 rounded-xl font-semibold text-sm">
          {loading ? 'Sending...' : 'Send Partnership Inquiry'}
          {!loading && <Mail className="w-4 h-4 ml-1" />}
        </Button>

        <p className="text-center text-[10px] text-muted-foreground">
          We'll respond within 48 hours. No commitment required.
        </p>
      </div>
    </div>
  );
}