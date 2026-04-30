import React from 'react';
import { Helmet } from 'react-helmet-async';

const SITE_NAME = 'NuVira Juice Co.';
const SITE_URL = 'https://www.nuvirajuice.com';
const DEFAULT_IMAGE = 'https://media.base44.com/images/public/69d48d0c39891f7945481152/421b89061_generated_image.png';
const DEFAULT_DESCRIPTION = "NuVira Juice Co. delivers fresh cold-pressed juices, wellness shots, and 3-day juice programs to your door in Wentzville, O'Fallon, St. Charles, and the greater St. Louis, MO area. Small-batch, made to order — Real. Living. Nutrition.";
const DEFAULT_KEYWORDS = "cold pressed juice Wentzville MO, juice delivery St. Louis, fresh juice O'Fallon, NuVira Juice, juice cleanse St. Charles, wellness juice Missouri";

export const LOCAL_BUSINESS_SCHEMA = {
  "@context": "https://schema.org",
  "@type": ["LocalBusiness", "FoodEstablishment"],
  "name": "NuVira Juice Co.",
  "alternateName": "NuVira Juice Company",
  "url": SITE_URL,
  "logo": "https://media.base44.com/images/public/69d48d0c39891f7945481152/b04d63077_Asset18322x.png",
  "image": DEFAULT_IMAGE,
  "description": DEFAULT_DESCRIPTION,
  "telephone": "",
  "email": "info@nuvirajuice.com",
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "",
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

export default function SEO({ title, description, image, type = 'website', keywords, structuredData, noindex = false }) {
  const fullTitle = title
    ? `${title} | ${SITE_NAME}`
    : `${SITE_NAME} | Cold-Pressed Juice Delivery — Wentzville & St. Louis, MO`;
  const metaDesc = description || DEFAULT_DESCRIPTION;
  const metaImage = image || DEFAULT_IMAGE;
  const metaKeywords = keywords || DEFAULT_KEYWORDS;
  const canonicalUrl = typeof window !== 'undefined'
    ? `${SITE_URL}${window.location.pathname.toLowerCase()}`
    : SITE_URL;

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={metaDesc} />
      <meta name="keywords" content={metaKeywords} />
      <meta name="robots" content={noindex ? 'noindex, nofollow' : 'index, follow'} />
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