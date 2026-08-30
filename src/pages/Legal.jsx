import React, { useState } from 'react';
import SEO from '@/components/SEO';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ShieldCheck, FileText, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { isNativeAppRuntime } from '@/lib/nativeRuntime';
import { resetAnalyticsConsent } from '@/lib/googleAnalytics';
import { resetMarketingConsent } from '@/lib/metaPixel';

const LAST_UPDATED = 'August 27, 2026';

const sections = [
  {
    icon: ShieldCheck,
    title: 'Privacy Policy',
    content: `Last Updated: ${LAST_UPDATED}

NuVira Juice Company ("NuVira," "we," "us," or "our") is committed to protecting your privacy. This policy explains how we collect, use, and safeguard your information when you use our app or website.

INFORMATION WE COLLECT
• Account and profile data: name, email address, phone number, delivery address, and optional birthday, profile photo, wellness goals, juice experience, flavor preferences, and preferred drink time
• Order and service data: items, totals, purchase history, discounts, payment and refund status, delivery preferences, fulfillment status, delivery proof, support requests, and related communications
• Rewards and program data: points, credits, referrals, program journeys and check-ins, notification choices, and in-app updates
• Payment data: Stripe processes payment details; NuVira does not store your full card number, but we retain transaction identifiers and payment, refund, and tax records needed to operate and document purchases
• Device and technical data: push-notification tokens or endpoints, device platform, app version or build, and technical records needed to provide, secure, and maintain the service
• Optional website measurement: pages visited, product and cart activity, checkout steps, and non-personal purchase totals/item details, only after you allow the applicable choice
• Active delivery-route location: when an authorized NuVira operator starts route tracking, their device sends precise location to NuVira and Google Routes to calculate traffic-aware ETAs and privacy-safe delivery progress. NuVira does not persist the raw coordinates in its route record after calculation; it retains accuracy and time metadata plus derived route progress. Customers do not receive the operator's exact location, and this data is not used for advertising

HOW WE USE YOUR INFORMATION
• To create and secure accounts, maintain profiles, rewards, referrals, and guided program experiences
• To process payments, orders, refunds, fulfillment, delivery, and food-safety or compliance records
• To provide customer support and send requested order, delivery, program, or account notifications
• To calculate delivery eligibility, routing, ETAs, and privacy-safe live delivery progress
• To maintain, troubleshoot, and improve our products and service
• To measure website performance and advertising only when you enable the applicable optional choice
• We do NOT sell your personal information

THIRD-PARTY SERVICES
• Stripe — payment processing (stripe.com/privacy)
• Base44 — app infrastructure (base44.com/privacy)
• Apple and Google — optional account sign-in providers (apple.com/legal/privacy; policies.google.com/privacy)
• Google Maps Platform and Google Routes — address assistance and active delivery-route calculations (policies.google.com/privacy)
• Resend, Apple Push Notification service, and Firebase Cloud Messaging — transactional email and app notification delivery
• Google Analytics — optional, consent-based website and purchase measurement (policies.google.com/privacy)
• Meta Pixel — optional, consent-based ad and shopping-journey measurement (facebook.com/privacy/policy)
• Snapchat Pixel — optional, consent-based ad, catalog, and shopping-journey measurement (values.snap.com/privacy/privacy-policy)

MEASUREMENT PRIVACY
Google Analytics remains off unless you enable Website analytics. Meta and Snapchat measurement remain off unless you enable Ad insights. Browser events do not include your raw name, email, phone number, street address, or payment details. After a consented paid website purchase, our secure payment webhook may send Google Analytics a pseudonymous browser client and session identifier with the non-personal order number, total, delivery fee, coupon, and catalog item details needed to measure purchase attribution; it does not send your raw contact, address, or payment details. After a consented purchase, our secure payment webhook may send Meta one-way SHA-256 hashes of your normalized email and phone solely to match the purchase to an ad interaction; Meta does not receive the raw values from this server event. Google advertising storage, signals, and personalization remain disabled. Meta browser measurement is limited to eligible website shopping, inquiry, and purchase actions and is not loaded on account, sign-in, checkout-confirmation, order-tracking, or admin page views. Snapchat browser measurement is limited to eligible website shopping, inquiry, registration, and paid purchase actions. A paid Snapchat Purchase event may be sent from the order-confirmation page after Ad insights consent, using non-personal order totals and catalog item identifiers without raw contact, address, or payment details. These optional web tools are not enabled inside the native iOS or Android app. You can reopen both choices from this page at any time.

DATA RETENTION
We retain information for as long as needed for the purposes described above and to meet legal, tax, payment, fraud-prevention, fulfillment, delivery, food-safety, compliance, and audit requirements. You may request account-data deletion at any time. A completed deletion request removes NuVira app profile, notification preference, push subscription, in-app notification, and loyalty or reward records associated with the verified account. Order, payment, refund, tax, fulfillment, delivery, food-safety, compliance, sync, and audit records may be retained when required for legitimate business or legal obligations. Records held independently by service providers are also subject to their retention duties and privacy policies.

YOUR RIGHTS
• Access or correct your personal data at any time in Account Settings
• Request account-data deletion in Account Settings or by emailing support@nuvirajuice.com; the confirmation identifies categories that may be retained
• Review or change optional Website analytics and Ad insights choices from this page
• California residents may exercise CCPA rights by contacting us

CONTACT
support@nuvirajuice.com · Based in Wentzville, MO`,
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
• Orders may be cancelled before production begins (typically the day before your scheduled delivery). Contact us ASAP at support@nuvirajuice.com.

Contact: support@nuvirajuice.com`,
  },
  {
    icon: AlertTriangle,
    title: 'Product Disclaimers',
    content: `Our cold-pressed juices are made from raw, unpasteurized fruits and vegetables. Please be aware of the following:

• Raw juices may contain harmful bacteria. Persons with weakened immune systems, elderly individuals, young children, and pregnant women should consult a physician before consuming unpasteurized products.

• Our products are not intended to diagnose, treat, cure, or prevent any disease or health condition.

• Keep juices refrigerated at 40°F or below. Follow the use-by date printed on each bottle; NuVira juices typically have a 5–7 day refrigerated shelf life from production.

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
        <Link to="/returns.html" className="mb-2 inline-flex min-h-11 items-center text-xs font-semibold text-primary underline">
          View dedicated refund & return policy
        </Link>
        {!isNativeAppRuntime() && (
          <button
            type="button"
            onClick={() => {
              resetAnalyticsConsent();
              resetMarketingConsent();
            }}
            className="mb-3 inline-flex h-10 items-center justify-center rounded-xl border border-border bg-card px-4 text-xs font-semibold text-foreground"
          >
            Review measurement choices
          </button>
        )}
        <p className="text-[10px] text-muted-foreground">
          Questions? Contact us at{' '}
          <a href="mailto:support@nuvirajuice.com" className="text-primary underline">support@nuvirajuice.com</a>
        </p>
        <p className="text-[10px] text-muted-foreground">© {new Date().getFullYear()} NuVira Juice Company · Wentzville, MO</p>
        <p className="text-[10px] text-muted-foreground">Last updated: {LAST_UPDATED}</p>
      </div>
    </div>
  );
}
