import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Mail, MapPin, Clock, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import SEO from '@/components/SEO';
import { submitCustomerInquiry } from '@/lib/customerCommunications';

export default function Contact() {
  const [form, setForm] = useState({ name: '', email: '', subject: '', message: '' });
  const [sending, setSending] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name || !form.email || !form.subject || !form.message) {
      toast.error('Please fill in all fields');
      return;
    }
    setSending(true);
    try {
      await submitCustomerInquiry('contact', {
        customer_name: form.name,
        customer_email: form.email,
        subject: form.subject,
        message: form.message,
        source: 'contact_page',
      });
      toast.success("Message sent! We'll get back to you soon.");
      setForm({ name: '', email: '', subject: '', message: '' });
    } catch {
      toast.error('Failed to send. Please try again.');
    }
    setSending(false);
  };

  return (
    <div className="min-h-screen bg-background pb-10">
      <SEO
        title="Contact Us"
        description="Get in touch with NuVira Juice Co. in Wentzville, MO. Questions about orders, delivery, or wholesale? We'd love to hear from you."
      />

      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border/40 flex items-center gap-3 px-4 py-3">
        <Link to="/">
          <button className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-muted transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
        </Link>
        <span className="font-heading text-base font-semibold">Contact Us</span>
      </div>

      <div className="px-4 pt-6 space-y-6">
        {/* Hero */}
        <div>
          <h1 className="font-heading text-2xl font-bold mb-1">We'd Love to Hear from You</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Questions about an order, delivery, wholesale, or just want to say hi? Reach out and we'll get back to you quickly.
          </p>
        </div>

        {/* Contact Info */}
        <div className="grid grid-cols-1 gap-3">
          <div className="nuvira-premium-card flex items-center gap-3 p-4 rounded-2xl">
            <div className="nuvira-icon-badge w-9 h-9 rounded-full flex items-center justify-center shrink-0">
              <Mail className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium">Email</p>
              <a href="mailto:support@nuvirajuice.com" className="text-sm font-semibold text-primary">support@nuvirajuice.com</a>
            </div>
          </div>

          <div className="nuvira-premium-card flex items-center gap-3 p-4 rounded-2xl">
            <div className="nuvira-icon-badge w-9 h-9 rounded-full flex items-center justify-center shrink-0">
              <MapPin className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium">Location</p>
              <p className="text-sm font-semibold">Wentzville, MO 63385</p>
              <p className="text-xs text-muted-foreground">Serving Wentzville, O'Fallon, St. Charles & St. Louis</p>
            </div>
          </div>

          <div className="nuvira-premium-card flex items-center gap-3 p-4 rounded-2xl">
            <div className="nuvira-icon-badge w-9 h-9 rounded-full flex items-center justify-center shrink-0">
              <Clock className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium">Response Time</p>
              <p className="text-sm font-semibold">Within 24 hours</p>
              <p className="text-xs text-muted-foreground">Mon – Sat, 8am – 6pm CST</p>
            </div>
          </div>
        </div>

        {/* Contact Form */}
        <div className="nuvira-premium-card rounded-2xl p-5">
          <h2 className="font-heading text-base font-semibold mb-4">Send a Message</h2>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground">Your Name</Label>
              <Input
                placeholder="Jane Smith"
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                className="rounded-lg h-10 mt-1"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Email Address</Label>
              <Input
                type="email"
                placeholder="you@example.com"
                value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })}
                className="rounded-lg h-10 mt-1"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Subject</Label>
              <Input
                placeholder="Order question, wholesale inquiry..."
                value={form.subject}
                onChange={e => setForm({ ...form, subject: e.target.value })}
                className="rounded-lg h-10 mt-1"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Message</Label>
              <textarea
                placeholder="Tell us how we can help..."
                value={form.message}
                onChange={e => setForm({ ...form, message: e.target.value })}
                className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring mt-1 resize-none"
                rows="4"
              />
            </div>
            <Button type="submit" disabled={sending} className="nuvira-gradient-button w-full h-10 rounded-lg">
              <Send className="w-3.5 h-3.5 mr-2" />
              {sending ? 'Sending...' : 'Send Message'}
            </Button>
          </form>
        </div>

        {/* Social Links */}
        <div className="text-center pb-4">
          <p className="text-xs text-muted-foreground mb-2">Follow us for daily drops & wellness tips</p>
          <div className="flex justify-center gap-4">
            <a href="https://www.instagram.com/nuvirajuiceco/" target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-primary">Instagram</a>
            <a href="https://www.facebook.com/nuvirajuiceco" target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-primary">Facebook</a>
          </div>
        </div>
      </div>
    </div>
  );
}
