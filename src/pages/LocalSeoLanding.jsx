import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Calendar, CheckCircle2, GlassWater, Leaf, MapPin, Truck } from 'lucide-react';
import SEO from '@/components/SEO';
import { absoluteUrl } from '@/lib/seo-slugs';
import { BRAND_IMAGES, brandImageUrl } from '@/lib/brandImages';

const DELIVERY_URL = BRAND_IMAGES.bottlesCoolerWide;
const FRESH_URL = BRAND_IMAGES.bottlesCoolerVertical;
const LOCAL_URL = BRAND_IMAGES.eventCollateral;
const EVENT_URL = BRAND_IMAGES.eventBoothField;
const EVENT_SAMPLING_URL = BRAND_IMAGES.eventSampling;

const AREAS = ['Wentzville', 'Lake Saint Louis', "O'Fallon", 'Dardenne Prairie', 'St. Peters', 'St. Charles', 'Greater St. Louis'];

const VISUAL_PROOF = [
  {
    src: BRAND_IMAGES.bottlesCoolerWide,
    alt: 'Chilled NuVira cold-pressed juice bottles ready for service',
    label: 'Freshly bottled and chilled',
  },
  {
    src: BRAND_IMAGES.eventSampling,
    alt: 'NuVira serving fresh juice samples at a local event',
    label: 'Built for local events',
  },
  {
    src: BRAND_IMAGES.eventCollateral,
    alt: 'NuVira event table cards and local delivery information',
    label: 'Simple ways to order',
  },
];

export const SEO_LANDING_PAGES = {
  'cold-pressed-juice-delivery': {
    path: '/cold-pressed-juice-delivery',
    title: 'Cold-Pressed Juice Delivery in Wentzville & St. Louis',
    h1: 'Cold-Pressed Juice Delivery in Wentzville & St. Louis',
    eyebrow: 'Local juice delivery',
    summary: 'Fresh NuVira juices are pressed in small batches, bottled cold, and prepared around local delivery windows across Wentzville, St. Charles County, and nearby St. Louis communities.',
    metaDescription: "Order fresh cold-pressed juice delivery from NuVira Juice Co. in Wentzville, O'Fallon, St. Charles, and the St. Louis area.",
    keywords: 'cold pressed juice delivery, cold pressed juice Wentzville, juice delivery St. Louis, fresh juice delivery near me',
    image: DELIVERY_URL,
    icon: Truck,
    serviceType: 'Cold-pressed juice delivery',
    primaryLink: '/shop',
    primaryLabel: 'Shop Juices',
    secondaryLink: '/program/hydration',
    secondaryLabel: 'View Programs',
    sections: [
      {
        title: 'Made fresh for local delivery',
        body: 'NuVira is built around freshness, not warehouse stock. Orders are prepared for active production windows so bottles arrive cold, clean, and ready for your routine.',
      },
      {
        title: 'Designed for real weekly routines',
        body: 'Order single bottles, wellness shots, bundles, or structured 2- and 3-day programs online. Delivery availability depends on your address and the current schedule shown at checkout.',
      },
      {
        title: 'Helpful for busy homes and offices',
        body: 'Customers use NuVira for weekday wellness, post-workout recovery, event prep, and convenient fridge-ready juice without an extra grocery stop.',
      },
    ],
    highlights: ['Cold-pressed', 'Small-batch', 'Local delivery windows', 'Online ordering'],
    faqs: [
      ['Do you offer cold-pressed juice delivery near me?', 'NuVira serves Wentzville and nearby St. Charles County and St. Louis area communities. Enter your delivery address during checkout to confirm availability.'],
      ['Are the juices made before delivery?', 'Yes. NuVira juices are made in small batches around production windows instead of sitting in long-term warehouse storage.'],
      ['Can I order individual bottles and programs?', 'Yes. The shop includes single bottles, wellness shots, bundles, and structured 2- and 3-day programs.'],
    ],
  },
  'fresh-juice-delivery-st-louis': {
    path: '/fresh-juice-delivery-st-louis',
    title: 'Fresh Juice Delivery in St. Louis, MO',
    h1: 'Fresh Juice Delivery for the St. Louis Area',
    eyebrow: 'Fresh juice near St. Louis',
    summary: 'NuVira helps St. Louis area customers keep fresh juice on hand without relying on shelf-stable bottles or last-minute store runs.',
    metaDescription: 'Fresh juice delivery for St. Louis area customers. Shop NuVira cold-pressed juices, bundles, wellness shots, and 2- or 3-day programs online.',
    keywords: 'fresh juice delivery St. Louis, juice delivery St. Louis MO, fresh juice near me, cold pressed juice St. Louis',
    image: FRESH_URL,
    icon: GlassWater,
    serviceType: 'Fresh juice delivery',
    primaryLink: '/shop',
    primaryLabel: 'Order Fresh Juice',
    secondaryLink: '/contact',
    secondaryLabel: 'Ask About Delivery',
    sections: [
      {
        title: 'Fresh bottles without the extra stop',
        body: 'Order online and choose from available delivery windows. NuVira is ideal for customers who want fresh juice ready at home, at work, or before a busy weekend.',
      },
      {
        title: 'Simple ingredients, cold-pressed process',
        body: 'Our juices focus on recognizable fruits, vegetables, and functional ingredients, pressed cold and bottled for convenient local delivery.',
      },
      {
        title: 'Options for one bottle or a full plan',
        body: 'Start with single bottles, build a trio, or choose a 2- or 3-day program when you want a structured routine.',
      },
    ],
    highlights: ['Fresh juice', 'Local delivery', 'Single bottles', '2- and 3-day programs'],
    faqs: [
      ['What areas near St. Louis can order?', 'Delivery availability depends on your address and active delivery windows. Wentzville, St. Charles County, and nearby St. Louis communities are the core service area.'],
      ['Can I order juice for tomorrow?', 'The checkout schedule shows the next available production and delivery windows for your order.'],
      ['Do you offer event orders?', 'Yes. Use the event booking page for larger groups, wellness events, and private gatherings.'],
    ],
  },
  'cold-pressed-juice-wentzville': {
    path: '/cold-pressed-juice-wentzville',
    title: 'Cold-Pressed Juice in Wentzville, MO',
    h1: 'Cold-Pressed Juice in Wentzville, MO',
    eyebrow: 'Wentzville juice company',
    summary: 'NuVira Juice Co. is rooted in Wentzville, making fresh cold-pressed juices, wellness shots, and juice programs for local customers.',
    metaDescription: 'NuVira Juice Co. offers cold-pressed juice in Wentzville, MO with local delivery, fresh bottles, wellness shots, and 2- or 3-day juice programs.',
    keywords: 'cold pressed juice Wentzville, juice Wentzville MO, fresh juice Wentzville, juice company Wentzville',
    image: LOCAL_URL,
    icon: MapPin,
    serviceType: 'Cold-pressed juice in Wentzville',
    primaryLink: '/shop',
    primaryLabel: 'Shop Wentzville Juices',
    secondaryLink: '/our-story',
    secondaryLabel: 'Our Story',
    sections: [
      {
        title: 'Local, small-batch juice',
        body: 'NuVira serves customers who want a fresh, local option for cold-pressed juice instead of mass-produced bottles from a grocery shelf.',
      },
      {
        title: 'Built around production windows',
        body: 'The ordering flow connects your cart to production and delivery scheduling so you know when your bottles are being prepared and delivered.',
      },
      {
        title: 'A practical wellness routine',
        body: 'Whether you are ordering OASIS, AURA, RE-NU, shots, or a full program, the goal is simple: fresh juice that fits your actual week.',
      },
    ],
    highlights: ['Wentzville based', 'Cold-pressed juice', 'Wellness shots', 'Local delivery'],
    faqs: [
      ['Is NuVira based in Wentzville?', 'NuVira is a Wentzville, Missouri juice company serving local customers and nearby communities through scheduled ordering and delivery.'],
      ['Can I buy single bottles?', 'Yes. You can shop individual bottles, bundles, wellness shots, and programs online.'],
      ['How do I know if delivery is available?', 'Checkout will show the delivery options currently available for your address.'],
    ],
  },
  'juice-cleanse-wentzville': {
    path: '/juice-cleanse-wentzville',
    title: '2- and 3-Day Juice Programs in Wentzville, MO',
    h1: '2- and 3-Day Juice Programs in Wentzville, MO',
    eyebrow: 'Structured juice programs',
    summary: 'NuVira programs give customers a clear, organized bottle plan: Hydration and Radiance are available for 2 or 3 days, while Reset remains a focused 3-day option.',
    metaDescription: 'Shop NuVira juice programs in Wentzville, MO. Choose 2- or 3-day Hydration and Radiance programs, or the 3-day Reset program.',
    keywords: 'juice program Wentzville, 2 day juice program Missouri, 3 day juice program Missouri, cold pressed juice program near me',
    image: DELIVERY_URL,
    icon: Calendar,
    serviceType: '2- and 3-day juice programs',
    primaryLink: '/program/hydration',
    primaryLabel: 'View Hydration Program',
    secondaryLink: '/shop',
    secondaryLabel: 'Shop All Juices',
    sections: [
      {
        title: 'No guesswork in the bottle count',
        body: 'Each program is structured around a planned set of bottles so customers can choose a goal and let the app handle the order details.',
      },
      {
        title: 'Fresh production timing',
        body: 'Programs are scheduled around NuVira production windows so bottles are prepared fresh for the selected delivery date.',
      },
      {
        title: 'Choose the routine that fits',
        body: 'Hydration and Radiance come in 2- or 3-day formats. Reset remains a 3-day program, so customers can choose the routine and bottle count that fit their week.',
      },
    ],
    highlights: ['Hydration: 2 or 3 days', 'Radiance: 2 or 3 days', 'Reset: 3 days', '8- or 12-bottle structure'],
    faqs: [
      ['Is this a medical cleanse?', 'No. NuVira programs are food and beverage routines, not medical treatments. Customers with health concerns should consult a healthcare provider.'],
      ['How many bottles are in a program?', 'The customer app presents the current bottle plan at checkout. Program fulfillment is designed to expand correctly for production.'],
      ['Can I buy single bottles instead?', 'Yes. You can shop single juices, wellness shots, and bundles if you do not want a full program.'],
    ],
  },
  'all-natural-juice-wentzville': {
    path: '/all-natural-juice-wentzville',
    title: 'All-Natural Juice in Wentzville, MO',
    h1: 'All-Natural Juice in Wentzville, MO',
    eyebrow: 'Simple ingredients',
    summary: 'NuVira focuses on real fruits, vegetables, and functional ingredients for customers who want fresh juice with simple, recognizable ingredients.',
    metaDescription: 'Looking for all-natural juice in Wentzville, MO? NuVira makes fresh cold-pressed juices with simple ingredients and local delivery.',
    keywords: 'all natural juice Wentzville, natural juice near me, fresh natural juice Missouri, clean juice Wentzville',
    image: FRESH_URL,
    icon: Leaf,
    serviceType: 'Natural juice',
    primaryLink: '/shop',
    primaryLabel: 'Shop Natural Juices',
    secondaryLink: '/why-nuvira',
    secondaryLabel: 'Why NuVira',
    sections: [
      {
        title: 'Ingredients you can recognize',
        body: 'NuVira is built around real produce and functional ingredients, with a product experience that makes it easy to understand what you are ordering.',
      },
      {
        title: 'Cold-pressed instead of heat-heavy processing',
        body: 'Cold pressing helps preserve the fresh flavor and character of fruits and vegetables while keeping the bottle experience clean and simple.',
      },
      {
        title: 'Freshness over mass production',
        body: 'The production model favors small batches and scheduled delivery windows instead of long-term shelf storage.',
      },
    ],
    highlights: ['Real produce', 'No concentrates', 'Fresh flavor', 'Simple ordering'],
    faqs: [
      ['Does NuVira use artificial preservatives?', 'NuVira is positioned around fresh, cold-pressed juices and simple ingredients. Product details are shown on each product page.'],
      ['Where can I see ingredients?', 'Open any product page in the shop to review the available ingredients and product details.'],
      ['Is fresh juice available for events?', 'Yes. NuVira can support event inquiries through the event booking page.'],
    ],
  },
  'juice-catering-st-louis': {
    path: '/juice-catering-st-louis',
    title: 'Juice Catering for St. Louis Events',
    h1: 'Juice Catering for St. Louis Events',
    eyebrow: 'Events and wellness gatherings',
    summary: 'Bring fresh NuVira juices to wellness events, studios, offices, showers, pop-ups, and private gatherings across the St. Louis area.',
    metaDescription: 'Book NuVira Juice Co. for St. Louis area events. Fresh cold-pressed juice options for wellness events, offices, showers, pop-ups, and gatherings.',
    keywords: 'juice catering St. Louis, cold pressed juice event catering, wellness event juice, fresh juice catering near me',
    image: EVENT_URL,
    icon: GlassWater,
    serviceType: 'Juice catering',
    primaryLink: '/book-event',
    primaryLabel: 'Book an Event',
    secondaryLink: '/partner',
    secondaryLabel: 'Partner With Us',
    sections: [
      {
        title: 'A better drink option for events',
        body: 'NuVira gives guests a fresh, wellness-forward option that works well for fitness events, wellness gatherings, showers, offices, and pop-ups.',
      },
      {
        title: 'Flexible service models',
        body: 'Events can be planned around pre-purchased bottles, sampling, or on-site sales depending on the event format and inventory plan.',
      },
      {
        title: 'Local planning support',
        body: 'Use the event request form to share your date, guest count, venue, and service needs so the team can plan the right bottle count.',
      },
    ],
    highlights: ['Wellness events', 'Office events', 'Private gatherings', 'Pop-ups'],
    faqs: [
      ['How far ahead should I request event juice?', 'Submit the event form as early as possible with your date, guest count, and venue so production can be planned correctly.'],
      ['Can NuVira sell on-site?', 'The event form supports different service models, including on-site sales depending on the event setup.'],
      ['Can I request a custom bottle count?', 'Yes. Include expected attendance and desired products in the event notes.'],
    ],
  },
  'cold-pressed-juice-ofallon-mo': {
    path: '/cold-pressed-juice-ofallon-mo',
    title: "Cold-Pressed Juice in O'Fallon, MO",
    h1: "Cold-Pressed Juice in O'Fallon, MO",
    eyebrow: "O'Fallon juice delivery",
    summary: "NuVira gives O'Fallon customers a nearby source for fresh cold-pressed juices, wellness shots, bundles, and 2- or 3-day programs.",
    metaDescription: "Order cold-pressed juice near O'Fallon, MO from NuVira Juice Co. Fresh juices, wellness shots, bundles, and local delivery options.",
    keywords: "cold pressed juice O'Fallon MO, juice delivery O'Fallon, fresh juice O'Fallon, wellness shots O'Fallon",
    image: DELIVERY_URL,
    icon: MapPin,
    serviceType: "Cold-pressed juice in O'Fallon",
    primaryLink: '/shop',
    primaryLabel: "Shop O'Fallon Options",
    secondaryLink: '/cold-pressed-juice-delivery',
    secondaryLabel: 'Delivery Details',
    sections: [
      {
        title: "Fresh juice close to O'Fallon",
        body: "NuVira serves O'Fallon area customers who want fresh juice without relying on shelf-stable grocery options.",
      },
      {
        title: 'Built around local windows',
        body: 'Checkout shows the delivery options available for your address and the current production schedule.',
      },
      {
        title: 'Single bottles or programs',
        body: 'Order OASIS, AURA, RE-NU, wellness shots, the NuVira Trio, or a structured 2- or 3-day program.',
      },
    ],
    highlights: ["O'Fallon area", 'Cold-pressed juice', 'Wellness shots', 'Local delivery'],
    faqs: [
      ["Does NuVira deliver to O'Fallon?", "Delivery availability depends on the address and active route schedule. Enter your O'Fallon address at checkout to confirm."],
      ['What program lengths are available?', 'Hydration and Radiance are available for 2 or 3 days. Reset is available as a 3-day program.'],
      ['Can I order for an office or studio?', 'Yes. For larger or recurring needs, use the event or partner request pages.'],
    ],
  },
  'juice-delivery-st-charles-mo': {
    path: '/juice-delivery-st-charles-mo',
    title: 'Juice Delivery in St. Charles, MO',
    h1: 'Juice Delivery in St. Charles, MO',
    eyebrow: 'St. Charles juice delivery',
    summary: 'Fresh NuVira bottles are available for St. Charles area customers looking for cold-pressed juice, wellness shots, and convenient local delivery.',
    metaDescription: 'Fresh juice delivery near St. Charles, MO. Shop NuVira cold-pressed juices, wellness shots, bundles, and 2- or 3-day programs online.',
    keywords: 'juice delivery St. Charles MO, cold pressed juice St. Charles, fresh juice St. Charles, juice programs St. Charles',
    image: FRESH_URL,
    icon: Truck,
    serviceType: 'Juice delivery in St. Charles',
    primaryLink: '/shop',
    primaryLabel: 'Shop St. Charles Delivery',
    secondaryLink: '/program/hydration',
    secondaryLabel: 'View Programs',
    sections: [
      {
        title: 'Fresh delivery for St. Charles routines',
        body: 'NuVira helps customers keep fresh juices ready for busy workweeks, wellness resets, and weekend plans.',
      },
      {
        title: 'Clear delivery eligibility',
        body: 'The checkout flow validates your delivery area and shows the fee, date, and available window before payment.',
      },
      {
        title: 'Made for more than one occasion',
        body: 'Use NuVira for home delivery, office fridge stocking, wellness events, or planned programs.',
      },
    ],
    highlights: ['St. Charles area', 'Delivery windows', 'Fresh bottles', '2- and 3-day programs'],
    faqs: [
      ['How do I know if my St. Charles address is eligible?', 'Enter your address during checkout. The app checks delivery eligibility and available windows before you pay.'],
      ['Can I buy individual juices?', 'Yes. Single bottles, wellness shots, bundles, merch, and programs are available in the shop.'],
      ['Do you support events in St. Charles?', 'Yes. Use the event booking page for wellness events, studios, private gatherings, and pop-ups.'],
    ],
  },
  'juice-delivery-lake-saint-louis': {
    path: '/juice-delivery-lake-saint-louis',
    title: 'Juice Delivery in Lake Saint Louis, MO',
    h1: 'Juice Delivery in Lake Saint Louis, MO',
    eyebrow: 'Lake Saint Louis delivery',
    summary: 'NuVira serves Lake Saint Louis area customers with fresh cold-pressed juices, wellness shots, bundles, and structured 2- or 3-day programs.',
    metaDescription: 'Order fresh juice delivery near Lake Saint Louis, MO. NuVira offers cold-pressed juices, wellness shots, bundles, and local delivery.',
    keywords: 'juice delivery Lake Saint Louis, cold pressed juice Lake Saint Louis, fresh juice Lake St Louis, wellness juice delivery',
    image: DELIVERY_URL,
    icon: Truck,
    serviceType: 'Juice delivery in Lake Saint Louis',
    primaryLink: '/shop',
    primaryLabel: 'Shop Local Delivery',
    secondaryLink: '/contact',
    secondaryLabel: 'Ask About Delivery',
    sections: [
      {
        title: 'Fresh juice without a store run',
        body: 'NuVira bottles are ordered online and prepared around active production windows for local delivery.',
      },
      {
        title: 'Useful for homes and events',
        body: 'Order for your weekly routine, a weekend wellness reset, a fitness studio, or a private gathering.',
      },
      {
        title: 'Simple product choices',
        body: 'Start with single bottles, pick a trio, add shots, or choose a 2- or 3-day program when you want structure.',
      },
    ],
    highlights: ['Lake Saint Louis', 'Fresh delivery', 'Bundles', 'Programs'],
    faqs: [
      ['Does NuVira serve Lake Saint Louis?', 'Lake Saint Louis is part of the local service-area content. Checkout confirms address-level eligibility and current windows.'],
      ['Are delivery fees shown before payment?', 'Yes. The checkout flow shows delivery details before payment is completed.'],
      ['Can I order for multiple people?', 'Yes. Bundles and event requests are available for small groups and larger planned events.'],
    ],
  },
  'wellness-shots-wentzville': {
    path: '/wellness-shots-wentzville',
    title: 'Wellness Shots in Wentzville, MO',
    h1: 'Wellness Shots in Wentzville, MO',
    eyebrow: 'Small shots, focused routines',
    summary: 'NuVira wellness shots are built for customers who want a quick, functional add-on alongside fresh cold-pressed juices and programs.',
    metaDescription: 'Shop NuVira wellness shots near Wentzville, MO. Fresh functional shots plus cold-pressed juices, bundles, and local delivery options.',
    keywords: 'wellness shots Wentzville, hydration shot Wentzville, ginger shot Wentzville, cold pressed wellness shots',
    image: FRESH_URL,
    icon: GlassWater,
    serviceType: 'Wellness shots',
    primaryLink: '/shop',
    primaryLabel: 'Shop Wellness Shots',
    secondaryLink: '/why-nuvira',
    secondaryLabel: 'Why NuVira',
    sections: [
      {
        title: 'Easy add-ons for a fresh order',
        body: 'Wellness shots can be added to juice orders when you want a compact, focused part of your routine.',
      },
      {
        title: 'Made with recognizable ingredients',
        body: 'Product pages show current shot details, ingredients, size, and pricing before checkout.',
      },
      {
        title: 'Works with bundles and programs',
        body: 'Customers often pair shots with single bottles, the NuVira Trio, or structured 2- and 3-day programs.',
      },
    ],
    highlights: ['Hydration Shot', 'Reset Shot', 'Radiance Shot', 'Fresh add-ons'],
    faqs: [
      ['Can I buy wellness shots by themselves?', 'Yes. Current wellness shots can be purchased from the shop when available.'],
      ['Are wellness shots medical products?', 'No. NuVira products are food and beverage items, not medical treatments.'],
      ['Can I add shots to a program?', 'Yes. Program pages and the shop let customers add available shots where supported.'],
    ],
  },
  'corporate-juice-catering-st-louis': {
    path: '/corporate-juice-catering-st-louis',
    title: 'Corporate Juice Catering in St. Louis',
    h1: 'Corporate Juice Catering in St. Louis',
    eyebrow: 'Office and team wellness',
    summary: 'NuVira supports offices, teams, studios, and wellness events with fresh cold-pressed juice options for the St. Louis area.',
    metaDescription: 'Corporate juice catering for St. Louis offices, teams, studios, and wellness events. Request fresh NuVira bottles for your next gathering.',
    keywords: 'corporate juice catering St. Louis, office wellness juice, employee wellness drinks St. Louis, fresh juice for offices',
    image: EVENT_URL,
    icon: Calendar,
    serviceType: 'Corporate juice catering',
    primaryLink: '/book-event',
    primaryLabel: 'Request Event Juice',
    secondaryLink: '/partner',
    secondaryLabel: 'Partner With Us',
    sections: [
      {
        title: 'A clean option for team events',
        body: 'Fresh juice works well for wellness days, team meetings, studio events, launch parties, and local pop-ups.',
      },
      {
        title: 'Plan bottle counts ahead',
        body: 'Share date, guest count, venue, and product preferences so production can be planned with enough inventory.',
      },
      {
        title: 'Flexible fulfillment',
        body: 'Events can be planned around pre-orders, sampling, pop-up sales, or stocked bottles depending on the format.',
      },
    ],
    highlights: ['Office wellness', 'Team events', 'Studios', 'Pop-ups'],
    faqs: [
      ['How far ahead should a company request juice?', 'Submit the event request as early as possible with date, headcount, and venue details.'],
      ['Can NuVira help plan quantities?', 'Yes. Use the event request notes to share expected attendance and product needs.'],
      ['Can this work for fitness studios?', 'Yes. NuVira supports wellness, fitness, and studio-style events across the local area.'],
    ],
  },
  'fresh-juice-for-events-st-louis': {
    path: '/fresh-juice-for-events-st-louis',
    title: 'Fresh Juice for Events in St. Louis',
    h1: 'Fresh Juice for Events in St. Louis',
    eyebrow: 'Fresh event beverage options',
    summary: 'NuVira brings fresh cold-pressed juice to St. Louis area events, from wellness gatherings and fitness pop-ups to private celebrations.',
    metaDescription: 'Fresh juice for St. Louis events. Request NuVira cold-pressed juices for wellness gatherings, private events, fitness pop-ups, and celebrations.',
    keywords: 'fresh juice for events St. Louis, cold pressed juice events, wellness event drinks, juice pop-up St. Louis',
    image: EVENT_SAMPLING_URL,
    icon: Calendar,
    serviceType: 'Fresh juice for events',
    primaryLink: '/book-event',
    primaryLabel: 'Book Event Juice',
    secondaryLink: '/juice-catering-st-louis',
    secondaryLabel: 'Catering Details',
    sections: [
      {
        title: 'Fresh bottles for guest experience',
        body: 'NuVira gives guests a wellness-forward beverage option that feels intentional and easy to enjoy.',
      },
      {
        title: 'Useful across event types',
        body: 'Event juice works for fitness classes, wellness days, weddings, showers, pop-ups, markets, and private gatherings.',
      },
      {
        title: 'Inventory planning matters',
        body: 'Tell us your guest count and event format so production can align bottle count, timing, and product mix.',
      },
    ],
    highlights: ['Wellness gatherings', 'Private events', 'Fitness pop-ups', 'Bottle planning'],
    faqs: [
      ['Can NuVira provide juice for a private event?', 'Yes. Use the event booking page to share date, location, expected attendance, and requested products.'],
      ['Can you support on-site sales?', 'Depending on the event setup, NuVira can plan around pre-purchased bottles, sampling, or on-site sales.'],
      ['What products work best for events?', 'OASIS, AURA, RE-NU, the NuVira Trio, wellness shots, and seasonal items can be planned based on inventory.'],
    ],
  },
};

function buildStructuredData(page) {
  const serviceAreas = AREAS.map(name => ({
    '@type': 'City',
    name,
    containedInPlace: { '@type': 'State', name: 'Missouri' },
  }));

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        name: page.title,
        description: page.metaDescription,
        url: absoluteUrl(page.path),
        primaryImageOfPage: brandImageUrl(page.image),
        isPartOf: {
          '@type': 'WebSite',
          name: 'NuVira Juice Co.',
          url: absoluteUrl('/'),
        },
      },
      {
        '@type': 'Service',
        name: page.serviceType,
        serviceType: page.serviceType,
        provider: {
          '@type': 'LocalBusiness',
          name: 'NuVira Juice Co.',
          url: absoluteUrl('/'),
          address: {
            '@type': 'PostalAddress',
            addressLocality: 'Wentzville',
            addressRegion: 'MO',
            postalCode: '63385',
            addressCountry: 'US',
          },
        },
        areaServed: serviceAreas,
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: absoluteUrl('/') },
          { '@type': 'ListItem', position: 2, name: page.h1, item: absoluteUrl(page.path) },
        ],
      },
      {
        '@type': 'FAQPage',
        mainEntity: page.faqs.map(([question, answer]) => ({
          '@type': 'Question',
          name: question,
          acceptedAnswer: {
            '@type': 'Answer',
            text: answer,
          },
        })),
      },
    ],
  };
}

export default function LocalSeoLanding({ pageKey }) {
  const page = SEO_LANDING_PAGES[pageKey] || SEO_LANDING_PAGES['cold-pressed-juice-delivery'];
  const Icon = page.icon;

  return (
    <div className="min-h-screen bg-background pb-24 text-foreground md:pb-12">
      <SEO
        title={page.title}
        description={page.metaDescription}
        image={brandImageUrl(page.image)}
        keywords={page.keywords}
        canonicalPath={page.path}
        structuredData={buildStructuredData(page)}
      />

      <header className="safe-area-top sticky top-0 z-20 border-b border-border/50 bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <Link
            to="/shop"
            aria-label="Back to shop"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] border border-border/60 bg-card text-foreground transition-colors hover:bg-muted"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="truncate font-heading text-base font-semibold leading-tight">NuVira Local</p>
            <p className="truncate text-[11px] font-semibold uppercase text-muted-foreground">Fresh juice, delivery, and events</p>
          </div>
          <Link
            to="/shop"
            className="hidden rounded-[8px] bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 sm:inline-flex"
          >
            Shop
          </Link>
        </div>
      </header>

      <section className="relative isolate overflow-hidden border-b border-border/50">
        <img src={page.image} alt="" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(7,22,15,0.92),rgba(7,22,15,0.72)_48%,rgba(7,22,15,0.38))]" />
        <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-background/90 to-transparent" />
        <div className="relative mx-auto grid min-h-[calc(100svh-12rem)] max-w-6xl gap-7 px-5 pb-24 pt-12 sm:min-h-[33rem] sm:px-6 sm:py-16 md:min-h-[32rem] md:px-8 lg:min-h-[35rem] lg:grid-cols-[1.1fr_0.9fr] lg:items-end lg:py-20">
          <div className="max-w-3xl self-center md:self-end">
            <div className="mb-4 inline-flex max-w-full items-center gap-2 rounded-[8px] border border-white/20 bg-white/10 px-3 py-2 text-[11px] font-bold uppercase text-white/85 backdrop-blur">
              <Icon className="h-4 w-4 shrink-0 text-primary" />
              <span className="truncate">{page.eyebrow}</span>
            </div>
            <h1 className="max-w-3xl font-heading text-3xl font-bold leading-[1.08] text-white sm:text-5xl lg:text-6xl">
              {page.h1}
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-white/86 md:text-lg">
              {page.summary}
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Link
                to={page.primaryLink}
                className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[8px] bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 sm:w-auto"
              >
                {page.primaryLabel}
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                to={page.secondaryLink}
                className="inline-flex min-h-12 w-full items-center justify-center rounded-[8px] border border-white/35 bg-white/10 px-5 py-3 text-sm font-semibold text-white backdrop-blur transition-colors hover:bg-white/15 sm:w-auto"
              >
                {page.secondaryLabel}
              </Link>
            </div>
          </div>

          <div className="grid gap-3 self-end text-white lg:pb-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="border-l border-white/25 pl-4">
                <p className="text-[11px] font-bold uppercase text-white/60">Service</p>
                <p className="mt-1 text-sm font-semibold leading-snug">{page.serviceType}</p>
              </div>
              <div className="border-l border-white/25 pl-4">
                <p className="text-[11px] font-bold uppercase text-white/60">Coverage</p>
                <p className="mt-1 text-sm font-semibold leading-snug">St. Charles County and St. Louis area</p>
              </div>
            </div>
            <div className="hidden flex-wrap gap-2 pt-2 sm:flex">
              {page.highlights.slice(0, 3).map(item => (
                <span key={item} className="rounded-[8px] border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white/88 backdrop-blur">
                  {item}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="px-5 pb-10 pt-6 sm:px-6 sm:pt-10 md:px-8 md:py-14">
        <div className="mx-auto max-w-6xl">
          <div className="mb-6 max-w-2xl">
            <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">How it works</p>
            <h2 className="font-heading text-2xl font-bold leading-tight sm:text-3xl">A cleaner local juice experience from order to delivery.</h2>
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            {page.sections.map((section, index) => (
              <article key={section.title} className="rounded-[8px] border border-border/55 bg-card p-5 shadow-sm">
                <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-[8px] bg-primary/12 text-primary">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
                <p className="mb-3 text-[11px] font-bold uppercase text-muted-foreground">Step {index + 1}</p>
                <h3 className="font-heading text-xl font-bold leading-tight">{section.title}</h3>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">{section.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="px-5 pb-10 sm:px-6 md:px-8 md:pb-14">
        <div className="mx-auto grid max-w-6xl gap-3 lg:grid-cols-[1.35fr_0.65fr]">
          <figure className="group relative min-h-56 overflow-hidden rounded-[8px] border border-border/55 bg-card shadow-sm sm:min-h-72">
            <img
              src={VISUAL_PROOF[0].src}
              alt={VISUAL_PROOF[0].alt}
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
              loading="lazy"
            />
            <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/78 to-transparent px-4 pb-4 pt-12 text-sm font-semibold text-white">
              {VISUAL_PROOF[0].label}
            </figcaption>
          </figure>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            {VISUAL_PROOF.slice(1).map(item => (
              <figure
                key={item.src}
                className="group relative min-h-48 overflow-hidden rounded-[8px] border border-border/55 bg-card shadow-sm sm:min-h-56 lg:min-h-0"
              >
              <img
                src={item.src}
                alt={item.alt}
                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
                loading="lazy"
              />
              <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/78 to-transparent px-4 pb-4 pt-12 text-sm font-semibold text-white">
                {item.label}
              </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-border/45 bg-card/55 px-5 py-10 sm:px-6 md:px-8 md:py-12">
        <div className="mx-auto grid max-w-6xl gap-7 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Service Areas</p>
            <h2 className="font-heading text-2xl font-bold leading-tight sm:text-3xl">Built for fresh local delivery.</h2>
            <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
              Availability depends on your address, selected fulfillment method, and the current production schedule.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {AREAS.map(area => (
              <span key={area} className="inline-flex min-h-9 items-center gap-1.5 rounded-[8px] border border-border/55 bg-background px-3 py-2 text-xs font-semibold text-foreground/80">
                <MapPin className="h-3.5 w-3.5 shrink-0 text-primary" />
                {area}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="px-5 py-10 sm:px-6 md:px-8 md:py-14">
        <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Popular Options</p>
            <h2 className="font-heading text-2xl font-bold leading-tight sm:text-3xl">Fresh juice paths for different needs.</h2>
            <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1">
              {page.highlights.map(item => (
                <div key={item} className="flex min-h-11 items-center gap-2 rounded-[8px] border border-border/50 bg-card px-3.5 py-2.5 text-sm font-semibold">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
                  {item}
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Common Questions</p>
            <div className="divide-y divide-border/45 border-y border-border/45">
              {page.faqs.map(([question, answer]) => (
                <article key={question} className="py-4">
                  <h3 className="text-base font-semibold leading-snug">{question}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{answer}</p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-primary/20 bg-primary px-5 py-8 text-primary-foreground sm:px-6 md:px-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="font-heading text-2xl font-bold leading-tight">Ready for fresh NuVira juice?</p>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-primary-foreground/78">
              Shop current products or ask about delivery, partnerships, and events.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row lg:shrink-0">
            <Link to="/shop" className="inline-flex min-h-11 items-center justify-center rounded-[8px] bg-background px-5 py-2.5 text-sm font-semibold text-foreground transition-opacity hover:opacity-90">
              Shop
            </Link>
            <Link to="/contact" className="inline-flex min-h-11 items-center justify-center rounded-[8px] border border-primary-foreground/35 px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-foreground/10">
              Contact
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
