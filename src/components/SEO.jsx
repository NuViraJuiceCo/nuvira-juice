import React from 'react';
import { Helmet } from 'react-helmet-async';

const SITE_NAME = 'NuVira Juice Co.';
const DEFAULT_IMAGE = 'https://media.base44.com/images/public/69d48d0c39891f7945481152/421b89061_generated_image.png';
const DEFAULT_DESCRIPTION = 'Fresh cold-pressed juices delivered to your door. Real. Living. Nutrition. — NuVira Juice Co., Wentzville, MO.';

export default function SEO({ title, description, image, type = 'website' }) {
  const fullTitle = title ? `${title} | ${SITE_NAME}` : SITE_NAME;
  const metaDesc = description || DEFAULT_DESCRIPTION;
  const metaImage = image || DEFAULT_IMAGE;
  const url = typeof window !== 'undefined' ? window.location.href : '';

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={metaDesc} />
      <link rel="canonical" href={url} />

      {/* Open Graph */}
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:type" content={type} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={metaDesc} />
      <meta property="og:image" content={metaImage} />
      <meta property="og:url" content={url} />

      {/* Twitter */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={metaDesc} />
      <meta name="twitter:image" content={metaImage} />
    </Helmet>
  );
}