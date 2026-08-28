import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { ArrowLeft, MessageCircle, HelpCircle, ChevronDown, ChevronUp, ShieldCheck, Star, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import SEO from '@/components/SEO';
import { submitCustomerInquiry } from '@/lib/customerCommunications';

const faqs = [
  {
    q: 'What makes NuVira juices different?',
    a: 'Our juices are cold-pressed from whole fruits and vegetables and crafted to support hydration, clarity, and wellness. Never heated, never compromised.',
  },
  {
    q: 'Do you use any preservatives?',
    a: 'Never. Each bottle is 100% natural with zero artificial additives. Clean ingredients, nothing else.',
  },
  {
    q: 'How long do the juices last?',
    a: 'Keep refrigerated. Enjoy within 3 days of opening for best freshness and maximum nutrients.',
  },
  {
    q: 'How does delivery work?',
    a: 'We produce fresh juice in small batches. Depending on when you order, your juice will be delivered on the next scheduled delivery day. You can see your estimated delivery date at checkout.',
  },
  {
    q: 'What areas do you deliver to?',
    a: "We currently deliver within the St. Louis area. Check at checkout if we deliver to your address. We're expanding coverage regularly.",
  },
  {
    q: 'Can I customize my juice order?',
    a: 'Yes! You can mix and match flavors or choose from our curated bundles to fit your lifestyle and wellness goals.',
  },
  {
    q: 'Do you have bulk or corporate packages?',
    a: 'We sure do! We provide special pricing for bulk orders and corporate wellness programs — perfect for teams, events, and offices. Email us to learn more.',
  },
  {
    q: 'Are your bottles recyclable?',
    a: 'Yes. Our bottles and packaging are eco-friendly and recyclable.',
  },
  {
    q: 'Can I change or cancel my order?',
    a: 'You can contact us before your order enters production. Once juicing begins, we cannot modify the order to ensure freshness.',
  },
];

// Only render FAQPage schema on Support page, not anywhere else
const FAQ_SCHEMA_SUPPORT = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": faqs.map(faq => ({
    "@type": "Question",
    "name": faq.q,
    "acceptedAnswer": {
      "@type": "Answer",
      "text": faq.a,
    },
  })),
};



export default function Support() {
  const navigate = useNavigate();
  const [openIndex, setOpenIndex] = useState(null);
  const [contactForm, setContactForm] = useState({ name: '', email: '', subject: '', message: '' });
  const [isSending, setIsSending] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!contactForm.name || !contactForm.email || !contactForm.subject || !contactForm.message) {
      toast.error('Please fill in all fields');
      return;
    }
    setIsSending(true);
    try {
      await submitCustomerInquiry('support', {
        customer_name: contactForm.name,
        customer_email: contactForm.email,
        subject: contactForm.subject,
        message: contactForm.message,
        source: 'support_page',
      });
      toast.success('Message sent! We\'ll get back to you soon.');
      setContactForm({ name: '', email: '', subject: '', message: '' });
    } catch (err) {
      toast.error('Failed to send message. Please try again.');
    }
    setIsSending(false);
  };

  return (
    <div className="pb-4">
      <SEO
        title="Help & Support — FAQ"
        description="Frequently asked questions about NuVira Juice Co. — delivery, ingredients, programs, and customer support."
        structuredData={FAQ_SCHEMA_SUPPORT}
      />
      <div className="flex items-center gap-3 px-4 pt-4 pb-3">
        <button onClick={() => navigate(-1)} className="w-9 h-9 bg-secondary rounded-full flex items-center justify-center">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="font-heading text-xl font-bold">Help & Support</h1>
      </div>

      {/* Contact Form */}
      <div className="mx-4 mb-6 bg-card rounded-2xl border border-border/50 p-5">
        <div className="flex items-center gap-2 mb-4">
          <MessageCircle className="w-5 h-5 text-primary" />
          <h2 className="font-heading text-base font-semibold">Get in Touch</h2>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <Label className="text-xs text-muted-foreground">Your Name</Label>
            <Input
              placeholder="John Doe"
              value={contactForm.name}
              onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })}
              className="rounded-lg h-10 mt-1"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Email Address</Label>
            <Input
              type="email"
              placeholder="you@example.com"
              value={contactForm.email}
              onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
              className="rounded-lg h-10 mt-1"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Subject</Label>
            <Input
              placeholder="How can we help?"
              value={contactForm.subject}
              onChange={(e) => setContactForm({ ...contactForm, subject: e.target.value })}
              className="rounded-lg h-10 mt-1"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Message</Label>
            <textarea
              placeholder="Tell us what's on your mind..."
              value={contactForm.message}
              onChange={(e) => setContactForm({ ...contactForm, message: e.target.value })}
              className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring mt-1 resize-none"
              rows="4"
            />
          </div>
          <Button type="submit" disabled={isSending} className="w-full h-10 rounded-lg">
            <Send className="w-3.5 h-3.5 mr-2" />
            {isSending ? 'Sending...' : 'Send Message'}
          </Button>
        </form>
      </div>

      {/* FAQ */}
      <div className="px-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Frequently Asked Questions
        </h2>
        <div className="space-y-2">
          {faqs.map((faq, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className="bg-card rounded-xl border border-border/50 overflow-hidden"
            >
              <button
                onClick={() => setOpenIndex(openIndex === i ? null : i)}
                className="w-full flex items-center justify-between p-3.5 text-left"
              >
                <div className="flex items-center gap-2.5">
                  <HelpCircle className="w-4 h-4 text-primary shrink-0" />
                  <span className="text-sm font-medium">{faq.q}</span>
                </div>
                {openIndex === i ? (
                  <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                )}
              </button>
              <AnimatePresence>
                {openIndex === i && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <p className="px-3.5 pb-3.5 text-xs text-muted-foreground leading-relaxed pl-10">
                      {faq.a}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Google Review */}
      <div className="px-4 mt-6">
        <a
          href="https://www.google.com/maps/place/NuVira+Juice+Company/@38.7028093,-90.7162366,11z/data=!3m1!4b1!4m6!3m5!1s0x6ba31dd76fc40465:0x251d9ffa6e774456!8m2!3d38.702657!4d-90.5514294!16s%2Fg%2F11xsw1cxfz"
          target="_blank"
          rel="noopener noreferrer"
        >
          <div className="flex items-center justify-between p-4 bg-lime-50 rounded-xl border border-lime-200 active:bg-lime-100 transition-colors">
            <div className="flex items-center gap-3">
              <Star className="w-4 h-4 text-lime-500 fill-lime-400" />
              <div>
                <p className="text-sm font-medium">Leave a Google Review</p>
                <p className="text-[10px] text-muted-foreground">Share your NuVira experience</p>
              </div>
            </div>
            <span className="text-xs text-lime-600">›</span>
          </div>
        </a>
      </div>

      {/* Legal & Compliance */}
      <div className="px-4 mt-4 mb-2">
        <Link to="/legal">
          <div className="flex items-center justify-between p-4 bg-card rounded-xl border border-border/50 active:bg-secondary transition-colors">
            <div className="flex items-center gap-3">
              <ShieldCheck className="w-4 h-4 text-primary" />
              <div>
                <p className="text-sm font-medium">Legal & Compliance</p>
                <p className="text-[10px] text-muted-foreground">Licenses, disclaimers & policies</p>
              </div>
            </div>
            <span className="text-xs text-muted-foreground">›</span>
          </div>
        </Link>
      </div>
    </div>
  );
}
