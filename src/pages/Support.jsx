import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, MessageCircle, HelpCircle, Mail, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { motion, AnimatePresence } from 'framer-motion';

const faqs = [
  {
    q: 'How does delivery work?',
    a: 'We produce fresh juice in small batches. Depending on when you order, your juice will be delivered on the next scheduled delivery day. You can see your estimated delivery date at checkout.',
  },
  {
    q: 'Can I change or cancel my order?',
    a: 'You can contact us before your order enters production. Once juicing begins, we cannot modify the order to ensure freshness.',
  },
  {
    q: 'What areas do you deliver to?',
    a: "We currently deliver within our local area. Check at checkout if we deliver to your address. We're expanding coverage regularly.",
  },
  {
    q: 'How should I store my juice?',
    a: 'Keep your juice refrigerated at all times. Our cold-pressed juices are best consumed within 3-5 days of delivery for maximum freshness and nutrients.',
  },
  {
    q: 'Do you offer subscriptions?',
    a: "We're working on a subscription service so you can get fresh juice delivered on a regular schedule. Stay tuned!",
  },
  {
    q: 'Are your juices organic?',
    a: 'We source the highest quality ingredients, prioritizing organic and locally-sourced produce whenever possible.',
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
        <a href="mailto:hello@nuvirajuice.com">
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
              transition={{ delay: i * 0.05 }}
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
    </div>
  );
}