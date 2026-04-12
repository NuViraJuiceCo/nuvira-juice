import React, { useState } from 'react';
import SEO from '@/components/SEO';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ShieldCheck, FileText, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const sections = [
  {
    icon: ShieldCheck,
    title: 'Health & Safety License',
    content: `NuVira Juice Company operates under a valid food handler's license issued by the St. Charles County Health Department, located in Wentzville, Missouri. Our facility and production practices are inspected and approved in accordance with Missouri state food safety regulations.

License Holder: NuVira Juice Company
Jurisdiction: St. Charles County Health Department
Home Base: Wentzville, MO

We maintain strict sanitation and food handling protocols to ensure every bottle meets or exceeds health department standards.`,
  },
  {
    icon: ShieldCheck,
    title: 'Food Liability Insurance',
    content: `NuVira Juice Company is insured through FLIP (Food Liability Insurance Program), providing comprehensive general liability coverage for our products and operations.

This insurance covers product liability claims related to our cold-pressed juices and any products sold under the NuVira brand. We take the safety of our customers seriously and maintain this coverage to protect both our customers and our business.`,
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
    icon: FileText,
    title: 'Terms of Service',
    content: `By placing an order with NuVira Juice Company, you agree to the following:

• Orders are subject to availability and delivery schedule. We reserve the right to substitute an ingredient of equal or greater quality if a specific item is unavailable.

• Refunds or replacements are offered at our discretion in cases where products arrive damaged or do not meet quality standards. Please contact us within 24 hours of delivery.

• Delivery addresses must be within our active service area. Orders placed outside our range will be contacted for resolution.

• NuVira is not responsible for product quality issues resulting from improper storage after delivery.`,
  },
  {
    icon: FileText,
    title: 'Privacy Policy',
    content: `NuVira Juice Company collects limited personal information (name, email, phone, delivery address) solely for the purpose of fulfilling your orders and communicating with you about your account.

• We do not sell or share your personal data with third parties for marketing purposes.
• Your information is stored securely and used only to operate and improve our service.
• You may request deletion of your account data at any time by contacting us at hello@nuvirajuice.com.`,
  },
];

export default function Legal() {
  const navigate = useNavigate();
  const [openIndex, setOpenIndex] = useState(null);

  return (
    <div className="pb-8">
      <SEO title="Legal & Compliance" description="NuVira Juice Company licenses, disclaimers, allergen info, terms of service, and privacy policy." />
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-4 pb-3">
        <button onClick={() => navigate(-1)} className="w-9 h-9 bg-secondary rounded-full flex items-center justify-center">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="font-heading text-xl font-bold">Legal & Compliance</h1>
          <p className="text-[10px] text-muted-foreground">Licenses, disclaimers & policies</p>
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
      <div className="mx-4 mt-6 text-center">
        <p className="text-[10px] text-muted-foreground">
          Questions? Contact us at{' '}
          <a href="mailto:hello@nuvirajuice.com" className="text-primary underline">hello@nuvirajuice.com</a>
        </p>
        <p className="text-[10px] text-muted-foreground mt-1">© {new Date().getFullYear()} NuVira Juice Company · Wentzville, MO</p>
      </div>
    </div>
  );
}