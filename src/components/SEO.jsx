import React from 'react';
import { Helmet } from 'react-helmet-async';
import { SITE_URL } from '@/lib/seo-slugs';
import { BRAND_OG_IMAGE } from '@/lib/brandImages';

const SITE_NAME = 'NuVira Juice Co.';
const BRAND_ICON = `${SITE_URL}/icons/icon-512.png`;
const DEFAULT_IMAGE = BRAND_OG_IMAGE;
const DEFAULT_DESCRIPTION = "NuVira Juice Co. delivers fresh cold-pressed juices, wellness shots, and 2- or 3-day juice programs to your door in Wentzville, O'Fallon, St. Charles, and the greater St. Louis, MO area. Small-batch, made to order — Real. Living. Nutrition.";
const DEFAULT_KEYWORDS = "cold pressed juice Wentzville MO, juice delivery St. Louis, fresh juice O'Fallon, NuVira Juice, juice programs St. Charles, wellness juice Missouri";

export const LOCAL_BUSINESS_SCHEMA = {
  "@context": "https://schema.org",
  "@type": ["LocalBusiness", "FoodEstablishment"],
  "name": "NuVira Juice Co.",
  "alternateName": "NuVira Juice Company",
  "url": SITE_URL,
  "logo": BRAND_ICON,
  "image": DEFAULT_IMAGE,
  "description": DEFAULT_DESCRIPTION,
  "email": "support@nuvirajuice.com",
  "address": {
    "@type": "PostalAddress",
    "addressLocality": "Wentzville",
    "addressRegion": "MO",
    "postalCode": "63385",
    "addressCountry": "US"
  },
  "geo": {
    "@type": "GeoCoordinates",
    "latitude": 38.8114,
    "longitude": -90.8529
  },
  "areaServed": [
    { "@type": "City", "name": "Wentzville", "containedInPlace": { "@type": "State", "name": "Missouri" } },
    { "@type": "City", "name": "O'Fallon", "containedInPlace": { "@type": "State", "name": "Missouri" } },
    { "@type": "City", "name": "St. Charles", "containedInPlace": { "@type": "State", "name": "Missouri" } },
    { "@type": "City", "name": "St. Louis", "containedInPlace": { "@type": "State", "name": "Missouri" } }
  ],
  "servesCuisine": "Juice Bar",
  "priceRange": "$$",
  "contactPoint": {
    "@type": "ContactPoint",
    "contactType": "customer support",
    "email": "support@nuvirajuice.com",
    "areaServed": "US-MO",
    "availableLanguage": "English"
  },
  "hasOfferCatalog": {
    "@type": "OfferCatalog",
    "name": "NuVira juice, wellness, and event services",
    "itemListElement": [
      {
        "@type": "Offer",
        "itemOffered": {
          "@type": "Service",
          "name": "Cold-pressed juice delivery",
          "serviceType": "Local cold-pressed juice delivery"
        }
      },
      {
        "@type": "Offer",
        "itemOffered": {
          "@type": "Service",
          "name": "2- and 3-day juice programs",
          "serviceType": "Structured cold-pressed juice programs"
        }
      },
      {
        "@type": "Offer",
        "itemOffered": {
          "@type": "Service",
          "name": "Juice catering",
          "serviceType": "Fresh juice for wellness events and private gatherings"
        }
      }
    ]
  },
  "openingHoursSpecification": {
    "@type": "OpeningHoursSpecification",
    "dayOfWeek": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
    "opens": "08:00",
    "closes": "18:00"
  },
  "sameAs": [
    "https://www.instagram.com/nuvirajuice",
    "https://www.facebook.com/nuvirajuice"
  ],
};

export default function SEO({ title, description, image, type = 'website', keywords, structuredData, noindex = false, canonicalUrl: canonicalUrlOverride, canonicalPath }) {
  const fullTitle = title
    ? `${title} | ${SITE_NAME}`
    : `${SITE_NAME} | Cold-Pressed Juice Delivery — Wentzville & St. Louis, MO`;
  const metaDesc = description || DEFAULT_DESCRIPTION;
  const metaImage = image || DEFAULT_IMAGE;
  const metaKeywords = keywords || DEFAULT_KEYWORDS;
  const canonicalUrl = canonicalUrlOverride
    || (canonicalPath ? `${SITE_URL}${canonicalPath.startsWith('/') ? canonicalPath : `/${canonicalPath}`}` : null)
    || (typeof window !== 'undefined'
      ? `${SITE_URL}${window.location.pathname.toLowerCase()}`
      : SITE_URL);

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={metaDesc} />
      <meta name="keywords" content={metaKeywords} />
      <meta name="robots" content={noindex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large'} />
      <link rel="canonical" href={canonicalUrl} />

      {/* Open Graph */}
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:type" content={type} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={metaDesc} />
      <meta property="og:image" content={metaImage} />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta property="og:image:alt" content={`${SITE_NAME} — ${title || 'Cold-Pressed Juice Delivery'}`} />
      <meta property="og:url" content={canonicalUrl} />
      <meta property="og:locale" content="en_US" />

      {/* Twitter */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={metaDesc} />
      <meta name="twitter:image" content={metaImage} />
      <meta name="twitter:image:alt" content={`${SITE_NAME} — ${title || 'Cold-Pressed Juice Delivery'}`} />

      {/* Structured Data */}
      {structuredData && (
        <script type="application/ld+json">
          {JSON.stringify(structuredData)}
        </script>
      )}
    </Helmet>
  );
}
