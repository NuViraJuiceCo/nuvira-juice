import React from 'react';
import { Helmet } from 'react-helmet-async';

const SITE_NAME = 'NuVira Juice Co.';
const SITE_URL = 'https://www.nuvirajuice.com';
const DEFAULT_IMAGE = 'https://media.base44.com/images/public/69d48d0c39891f7945481152/421b89061_generated_image.png';
const DEFAULT_DESCRIPTION = 'Fresh cold-pressed juices delivered to your door in Wentzville, O\'Fallon, St. Charles, and the greater St. Louis area. Real. Living. Nutrition. — NuVira Juice Co.';
const DEFAULT_KEYWORDS = "cold pressed juice Wentzville MO, juice delivery St. Louis, fresh juice O'Fallon, NuVira Juice, juice cleanse St. Charles, wellness juice Missouri";

export default function SEO({ title, description, image, type = 'website', keywords, structuredData }) {
  const fullTitle = title ? `${title} | ${SITE_NAME}` : `${SITE_NAME} | Cold-Pressed Juice Delivery — Wentzville & St. Louis, MO`;
  const metaDesc = description || DEFAULT_DESCRIPTION;
  const metaImage = image || DEFAULT_IMAGE;
  const metaKeywords = keywords || DEFAULT_KEYWORDS;
  const canonicalUrl = typeof window !== 'undefined' ? `${SITE_URL}${window.location.pathname}` : SITE_URL;

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={metaDesc} />
      <meta name="keywords" content={metaKeywords} />
      <meta name="robots" content="index, follow" />
      <link rel="canonical" href={canonicalUrl} />

      {/* Open Graph */}
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:type" content={type} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={metaDesc} />
      <meta property="og:image" content={metaImage} />
      <meta property="og:url" content={canonicalUrl} />
      <meta property="og:locale" content="en_US" />

      {/* Twitter */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={metaDesc} />
      <meta name="twitter:image" content={metaImage} />

      {/* Structured Data */}
      {structuredData && (
        <script type="application/ld+json">
          {JSON.stringify(structuredData)}
        </script>
      )}
    </Helmet>
  );
}