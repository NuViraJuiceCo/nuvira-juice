import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { ArrowLeft, MessageCircle, HelpCircle, Mail, ChevronDown, ChevronUp, ShieldCheck, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { motion, AnimatePresence } from 'framer-motion';

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
    q: 'Can I subscribe to receive juices regularly?',
    a: 'Yes! We offer flexible subscription plans so you can enjoy your favorite juices every week without reordering. Visit the Subscribe section in your account.',
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

export default function Support() {
  const navigate = useNavigate();
  const [openIndex, setOpenIndex] = useState(null);

  return (
    <div className="pb-4">
      <div className="flex items-center gap-3 px-4 pt-4 pb-3">
        <button onClick={() => navigate(-1)} className="w-9 h-9 bg-secondary rounded-full flex items-center justify-center">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="font-heading text-xl font-bold">Help & Support</h1>
      </div>

      {/* Contact */}
      <div className="mx-4 mb-6 bg-primary/5 rounded-2xl p-5 text-center">
        <MessageCircle className="w-8 h-8 text-primary mx-auto mb-2" />
        <h2 className="font-heading text-base font-semibold mb-1">Need Help?</h2>
        <p className="text-xs text-muted-foreground mb-3">We're here for you</p>
        <a href="mailto:nuvirajuiceco@gmail.com">
          <Button size="sm" className="rounded-full px-5">
            <Mail className="w-3.5 h-3.5 mr-1.5" />
            Email Us
          </Button>
        </a>
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
          <div className="flex items-center justify-between p-4 bg-yellow-50 rounded-xl border border-yellow-200 active:bg-yellow-100 transition-colors">
            <div className="flex items-center gap-3">
              <Star className="w-4 h-4 text-yellow-500 fill-yellow-400" />
              <div>
                <p className="text-sm font-medium">Leave a Google Review</p>
                <p className="text-[10px] text-muted-foreground">Share your NuVira experience</p>
              </div>
            </div>
            <span className="text-xs text-yellow-600">›</span>
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