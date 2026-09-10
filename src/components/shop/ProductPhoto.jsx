import React, { useState } from 'react';
import { isApprovedProductImage, productPrimaryImage, productThumbnailImage } from '@/lib/approved-product-media';

// Render-time media only: existing carts/rewards retain their original payloads.
export default function ProductPhoto({ product, thumbnail = false, src, alt, className = '', fallback = null, style, ...props }) {
  const [failed, setFailed] = useState([]);
  const preferred = src || (thumbnail ? productThumbnailImage(product) : productPrimaryImage(product));
  const candidates = [...new Set([preferred, product?.image_url].filter(Boolean))];
  const image = candidates.find(candidate => !failed.includes(candidate));
  if (!image) return fallback;
  const approved = isApprovedProductImage(image);
  return <img
    {...props}
    src={image}
    alt={alt ?? product?.title ?? product?.name ?? 'NuVira product'}
    className={className}
    style={{ ...style, ...(approved ? { objectFit: 'contain' } : {}) }}
    data-approved-product-photo={approved || undefined}
    onError={() => setFailed(previous => previous.includes(image) ? previous : [...previous, image])}
  />;
}
