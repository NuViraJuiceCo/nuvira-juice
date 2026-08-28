import { PUBLIC_PRODUCT_FALLBACKS } from './public-product-catalog.js';
import { MERCHANT_RETURN_POLICY_ID } from './merchant-policy.js';
import { SITE_URL, productLookupKeys, productPath, slugifyProductTitle } from './seo-slugs.js';

const SITE_NAME = 'NuVira Juice Co.';

function productCategoryLabel(product = {}) {
  const category = String(product.category || '').trim().toLowerCase();
  if (category === 'shot') return 'Wellness shot';
  if (category === 'bundle') return 'Juice bundle';
  if (category === 'merch') return 'NuVira merchandise';
  return 'Cold-pressed juice';
}

export function productImageUrl(product = {}) {
  const image = String(product.image_url || '').trim();
  if (!image) return `${SITE_URL}/icons/icon-512.png`;
  return image.startsWith('http://') || image.startsWith('https://')
    ? image
    : `${SITE_URL}${image.startsWith('/') ? image : `/${image}`}`;
}

export function resolveProductSeoRecord(product = {}) {
  const sourceKeys = new Set(productLookupKeys(product));
  const fallback = PUBLIC_PRODUCT_FALLBACKS.find(candidate => (
    productLookupKeys(candidate).some(key => sourceKeys.has(key))
  ));
  if (!fallback) return product;

  return {
    ...fallback,
    ...product,
    slug: fallback.slug,
    catalog_id: product.catalog_id || product.shopify_variant_id || fallback.catalog_id,
    seo_title: product.seo_title || fallback.seo_title,
    seo_description: product.seo_description || fallback.seo_description,
    ingredients: product.ingredients || fallback.ingredients,
    image_url: product.image_url || fallback.image_url,
  };
}

export function buildProductSeoMetadata(product = {}) {
  const resolvedProduct = resolveProductSeoRecord(product);
  const slug = String(resolvedProduct.slug || slugifyProductTitle(resolvedProduct.title || resolvedProduct.id || '')).trim();
  const title = String(resolvedProduct.seo_title || `${resolvedProduct.title || 'NuVira Product'} ${productCategoryLabel(resolvedProduct)}`).trim();
  const description = String(resolvedProduct.seo_description || resolvedProduct.description || resolvedProduct.short_description || '').trim();
  const canonicalUrl = `${SITE_URL}${productPath({ ...resolvedProduct, slug })}`;
  const image = productImageUrl(resolvedProduct);
  const category = productCategoryLabel(resolvedProduct);

  return {
    slug,
    title,
    fullTitle: `${title} | ${SITE_NAME}`,
    description,
    image,
    canonicalUrl,
    category,
    keywords: [
      resolvedProduct.title,
      category,
      resolvedProduct.size,
      'NuVira Juice Co.',
      'Wentzville MO',
      category === 'NuVira merchandise' ? 'NuVira merch' : 'local juice delivery',
    ].filter(Boolean).join(', '),
    price: Number(resolvedProduct.price).toFixed(2),
    currency: 'USD',
    availability: resolvedProduct.is_available === false
      ? 'https://schema.org/OutOfStock'
      : 'https://schema.org/InStock',
    availabilityLabel: resolvedProduct.is_available === false ? 'Out of stock' : 'In stock',
  };
}

export function buildProductStructuredData(product = {}) {
  const resolvedProduct = resolveProductSeoRecord(product);
  const metadata = buildProductSeoMetadata(resolvedProduct);
  const additionalProperty = [
    resolvedProduct.size ? {
      '@type': 'PropertyValue',
      name: 'Size',
      value: resolvedProduct.size,
    } : null,
    resolvedProduct.ingredients ? {
      '@type': 'PropertyValue',
      name: 'Ingredients',
      value: resolvedProduct.ingredients,
    } : null,
  ].filter(Boolean);

  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    '@id': `${metadata.canonicalUrl}#product`,
    name: resolvedProduct.title,
    description: metadata.description,
    image: [metadata.image],
    sku: String(resolvedProduct.catalog_id || resolvedProduct.shopify_variant_id || resolvedProduct.id || ''),
    productID: String(resolvedProduct.id || resolvedProduct.catalog_id || ''),
    category: metadata.category,
    brand: {
      '@type': 'Brand',
      name: SITE_NAME,
    },
    offers: {
      '@type': 'Offer',
      '@id': `${metadata.canonicalUrl}#offer`,
      url: metadata.canonicalUrl,
      priceCurrency: metadata.currency,
      price: metadata.price,
      availability: metadata.availability,
      itemCondition: 'https://schema.org/NewCondition',
      seller: {
        '@type': 'Organization',
        name: SITE_NAME,
        url: SITE_URL,
      },
      hasMerchantReturnPolicy: {
        '@id': MERCHANT_RETURN_POLICY_ID,
      },
    },
    additionalProperty: additionalProperty.length ? additionalProperty : undefined,
  };
}
