import React, { useState } from 'react';
import SEO from '@/components/SEO';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ShieldCheck, FileText, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const LAST_UPDATED = 'April 12, 2026';

const sections = [
  {
    icon: ShieldCheck,
    title: 'Privacy Policy',
    content: `Last Updated: ${LAST_UPDATED}

NuVira Juice Company ("NuVira," "we," "us," or "our") is committed to protecting your privacy. This policy explains how we collect, use, and safeguard your information when you use our app or website.

INFORMATION WE COLLECT
• Personal identifiers: name, email address, phone number, delivery address
• Order data: items purchased, order history, delivery preferences
• Payment data: processed securely via Stripe — we never store card numbers
• App usage: crash logs and page views (for app performance only)

HOW WE USE YOUR INFORMATION
• To process and fulfill your orders
• To send order status updates and notifications
• To improve our products and service
• We do NOT sell or share your data with third parties for advertising

THIRD-PARTY SERVICES
• Stripe — payment processing (stripe.com/privacy)
• Base44 — app infrastructure (base44.com/privacy)

DATA RETENTION
Your data is retained as long as your account is active. You may request deletion at any time.

YOUR RIGHTS
• Access or correct your personal data at any time in Account Settings
• Request full deletion by emailing info@nuvirajuice.com
• California residents may exercise CCPA rights by contacting us

CONTACT
info@nuvirajuice.com · Wentzville, MO`,
  },
  {
    icon: FileText,
    title: 'Terms of Service',
    content: `Last Updated: ${LAST_UPDATED}

By placing an order with NuVira Juice Company, you agree to the following:

• Orders are subject to availability and delivery schedule. We reserve the right to substitute an ingredient of equal or greater quality if a specific item is unavailable.

• Refunds or replacements are offered at our discretion in cases where products arrive damaged or do not meet quality standards. Please contact us within 24 hours of delivery.

• Delivery addresses must be within our active service area. Orders placed outside our range will be contacted for resolution.

• NuVira is not responsible for product quality issues resulting from improper storage after delivery.

• We reserve the right to modify pricing, product availability, and service terms at any time with reasonable notice.`,
  },
  {
    icon: FileText,
    title: 'Refund & Return Policy',
    content: `We stand behind the quality of every bottle we produce.

REFUNDS
• If your order arrives damaged, incorrect, or does not meet our quality standards, contact us within 24 hours of delivery and we will issue a full refund or replacement at no charge.
• Refunds are issued to the original payment method within 5–10 business days.

NO RETURNS ON FOOD PRODUCTS
• For health and safety reasons, we cannot accept returns on consumable products once delivered.

CANCELLATIONS
• Orders may be cancelled before production begins (typically the day before your scheduled delivery). Contact us ASAP at info@nuvirajuice.com.

SUBSCRIPTIONS
• Subscriptions may be paused or cancelled at any time with 48 hours notice before the next billing cycle.

Contact: info@nuvirajuice.com`,
  },
  {
    icon: AlertTriangle,
    title: 'Product Disclaimers',
    content: `Our cold-pressed juices are made from raw, unpasteurized fruits and vegetables. Please be aware of the following:

• Raw juices may contain harmful bacteria. Persons with weakened immune systems, elderly individuals, young children, and pregnant women should consult a physician before consuming unpasteurized products.

• Our products are not intended to diagnose, treat, cure, or prevent any disease or health condition.

• Juices should be refrigerated at all times and consumed within 3–5 days of delivery for optimal freshness and safety.

• Nutritional content may vary depending on seasonal ingredient availability.`,
  },
  {
    icon: FileText,
    title: 'Allergen Information',
    content: `NuVira juices are made in a facility that handles a wide variety of fruits, vegetables, and wellness ingredients. While we take precautions to prevent cross-contamination, we cannot guarantee that any product is completely free from allergens.

Common allergens that may be present in our facility include: citrus, ginger, beets, leafy greens, and various tropical fruits.

If you have a known food allergy or sensitivity, please contact us before placing an order so we can advise on ingredient details for specific products.`,
  },
  {
    icon: ShieldCheck,
    title: 'Health & Safety License',
    content: `NuVira Juice Company operates under a valid food handler's license issued by the St. Charles County Health Department, located in Wentzville, Missouri. Our facility and production practices are inspected and approved in accordance with Missouri state food safety regulations.

License Holder: NuVira Juice Company
Jurisdiction: St. Charles County Health Department
Home Base: Wentzville, MO
Insurance: FLIP (Food Liability Insurance Program)

We maintain strict sanitation and food handling protocols to ensure every bottle meets or exceeds health department standards.`,
  },
];

export default function Legal() {
  const navigate = useNavigate();
  const [openIndex, setOpenIndex] = useState(0);

  return (
    <div className="pb-8">
      <SEO title="Legal & Privacy" description="NuVira Juice Company privacy policy, terms of service, refund policy, licenses, disclaimers, and allergen information." />
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pb-3" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
        <button onClick={() => navigate(-1)} className="w-9 h-9 bg-secondary rounded-full flex items-center justify-center">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="font-heading text-xl font-bold">Legal & Privacy</h1>
          <p className="text-[10px] text-muted-foreground">Policies, licenses & disclaimers</p>
        </div>
      </div>

      {/* Compliance Badge */}
      <div className="mx-4 mb-5 bg-primary/5 border border-primary/20 rounded-2xl p-4 flex items-center gap-3">
        <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center shrink-0">
          <ShieldCheck className="w-5 h-5 text-primary" />
        </div>
        <div>
          <p className="text-sm font-semibold">Licensed & Insured</p>
          <p className="text-xs text-muted-foreground">St. Charles County Health Dept · FLIP Insured · Wentzville, MO</p>
        </div>
      </div>

      {/* Sections */}
      <div className="px-4 space-y-2">
        {sections.map((section, i) => {
          const Icon = section.icon;
          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className="bg-card rounded-xl border border-border/50 overflow-hidden"
            >
              <button
                onClick={() => setOpenIndex(openIndex === i ? null : i)}
                className="w-full flex items-center justify-between p-4 text-left"
              >
                <div className="flex items-center gap-3">
                  <Icon className="w-4 h-4 text-primary shrink-0" />
                  <span className="text-sm font-semibold">{section.title}</span>
                </div>
                {openIndex === i
                  ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
                  : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                }
              </button>
              <AnimatePresence>
                {openIndex === i && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="px-4 pb-4">
                      <div className="h-px bg-border/40 mb-3" />
                      <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-line">
                        {section.content}
                      </p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>

      {/* Footer note */}
      <div className="mx-4 mt-6 text-center space-y-1">
        <p className="text-[10px] text-muted-foreground">
          Questions? Contact us at{' '}
          <a href="mailto:info@nuvirajuice.com" className="text-primary underline">info@nuvirajuice.com</a>
        </p>
        <p className="text-[10px] text-muted-foreground">© {new Date().getFullYear()} NuVira Juice Company · Wentzville, MO</p>
        <p className="text-[10px] text-muted-foreground">Last updated: {LAST_UPDATED}</p>
      </div>
    </div>
  );
}