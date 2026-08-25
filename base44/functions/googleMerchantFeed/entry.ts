import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SITE_URL = 'https://www.nuvirajuice.com';
const BRAND = 'NuVira Juice Co.';

// Google product category for cold-pressed juice
const GOOGLE_PRODUCT_CATEGORY = 'Food, Beverages & Tobacco > Beverages > Juices';

// Map Base44 category to product_type
const PRODUCT_TYPE_MAP = {
  juice: 'Cold-Pressed Juice',
  shot: 'Wellness Shot',
  bundle: 'Juice Bundle',
  wellness_pack: 'Wellness Pack',
  seasonal: 'Seasonal Juice',
  apparel: 'Apparel',
  merch: 'Merchandise',
};

const MERCHANT_IMAGE_SETS = {
  aura: {
    primary: `${SITE_URL}/images/products/aura-main.jpg`,
    additional: [`${SITE_URL}/images/products/aura-lifestyle.jpg`],
  },
  oasis: {
    primary: `${SITE_URL}/images/products/oasis-main.jpg`,
    additional: [`${SITE_URL}/images/products/oasis-lifestyle.jpg`],
  },
  're-nu': {
    primary: `${SITE_URL}/images/products/re-nu-main.jpg`,
    additional: [`${SITE_URL}/images/products/re-nu-lifestyle.jpg`],
  },
  'the nuvira trio': {
    primary: `${SITE_URL}/images/products/nuvira-trio-main.jpg`,
    additional: [`${SITE_URL}/images/products/nuvira-trio-lifestyle.jpg`],
  },
  'pineapple juice': { primary: `${SITE_URL}/images/products/pineapple-juice-main.jpg` },
  'orange juice': { primary: `${SITE_URL}/images/products/orange-juice-main.jpg` },
  'watermelon juice': { primary: `${SITE_URL}/images/products/watermelon-juice-main.jpg` },
  'reset shot': { primary: `${SITE_URL}/images/products/reset-shot-main.jpg` },
  'hydration shot': { primary: `${SITE_URL}/images/products/hydration-shot-main.jpg` },
  'radiance shot': { primary: `${SITE_URL}/images/products/radiance-shot-main.jpg` },
  'large nuvira tote bag': {
    primary: `${SITE_URL}/assets/large-nuvira-tote-bag.jpg`,
    additional: [`${SITE_URL}/images/brand/nuvira-tote-bag.jpg`],
  },
};

function absoluteImageUrl(value) {
  const url = String(value || '').trim();
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('/')) return `${SITE_URL}${url}`;
  return '';
}

function getMerchantImages(product) {
  const titleKey = String(product.title || '').trim().toLowerCase();
  const curated = MERCHANT_IMAGE_SETS[titleKey];
  const primary = curated?.primary || absoluteImageUrl(product.image_url);
  const candidates = [
    ...(curated?.additional || []),
    ...(Array.isArray(product.secondary_images) ? product.secondary_images.map(absoluteImageUrl) : []),
  ];
  const additional = [...new Set(candidates.filter(url => url && url !== primary))].slice(0, 9);
  return { primary, additional };
}

function escapeXml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function getAvailability(product) {
  if (!product.is_available) return 'out_of_stock';
  if (product.is_preorder) return 'preorder';
  return 'in_stock';
}

function buildProductEntry(product) {
  const id = product.id;
  const title = escapeXml(product.title);
  const description = escapeXml(
    product.description ||
    product.short_description ||
    `${product.title} — fresh cold-pressed juice from NuVira Juice Co., delivered in the St. Louis, MO area.`
  );
  const link = `${SITE_URL}/shop/${id}`;
  const images = getMerchantImages(product);
  const imageLink = images.primary;
  const availability = getAvailability(product);
  const price = product.price ? `${product.price.toFixed(2)} USD` : null;
  const productType = PRODUCT_TYPE_MAP[product.category] || 'Cold-Pressed Juice';

  // Skip products missing critical fields
  if (!title || !imageLink || !price) return null;

  let entry = `    <item>
      <g:id>${escapeXml(id)}</g:id>
      <g:title>${title}</g:title>
      <g:description>${description}</g:description>
      <g:link>${link}</g:link>
      <g:image_link>${escapeXml(imageLink)}</g:image_link>
      <g:availability>${availability}</g:availability>
      <g:price>${price}</g:price>
      <g:brand>${escapeXml(BRAND)}</g:brand>
      <g:condition>new</g:condition>
      <g:google_product_category>${escapeXml(GOOGLE_PRODUCT_CATEGORY)}</g:google_product_category>
      <g:product_type>${escapeXml(productType)}</g:product_type>`;

  // Compare-at / sale price (original price shown as price, discounted as sale_price)
  if (product.compare_at_price && product.compare_at_price > product.price) {
    // Replace the already-written price line isn't possible, so we handle this differently:
    // The entry already has g:price = current (sale) price. We just add sale_price as well.
    // Google uses sale_price to show the discounted price and price as original.
    // We need to rebuild: set g:price = compare_at, g:sale_price = current price.
    // Since we already wrote g:price above, we patch by using string replace on entry:
    entry = entry.replace(
      `<g:price>${product.price.toFixed(2)} USD</g:price>`,
      `<g:price>${product.compare_at_price.toFixed(2)} USD</g:price>`
    );
    entry += `\n      <g:sale_price>${product.price.toFixed(2)} USD</g:sale_price>`;
  }

  // Additional images
  images.additional.forEach(imgUrl => {
    entry += `\n      <g:additional_image_link>${escapeXml(imgUrl)}</g:additional_image_link>`;
  });

  // Size if present
  if (product.size) {
    entry += `\n      <g:size>${escapeXml(product.size)}</g:size>`;
  }

  // Custom labels for filtering in Google Ads
  if (product.is_best_seller) entry += `\n      <g:custom_label_0>best_seller</g:custom_label_0>`;
  else if (product.is_seasonal) entry += `\n      <g:custom_label_0>seasonal</g:custom_label_0>`;
  else if (product.is_featured) entry += `\n      <g:custom_label_0>featured</g:custom_label_0>`;

  // Preorder availability date
  if (product.is_preorder && product.preorder_ship_date) {
    entry += `\n      <g:availability_date>${escapeXml(product.preorder_ship_date)}T00:00:00-06:00</g:availability_date>`;
  }

  // Delivery cost and timing are account-level Merchant Center settings.
  // Do not submit offer-level shipping here: it overrides the account policy,
  // and NuVira's distance-based local delivery is not free parcel shipping.

  entry += `\n    </item>`;
  return entry;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Fetch all available products from Base44 (source of truth)
    const products = await base44.asServiceRole.entities.Product.filter({ is_available: true }, 'sort_order', 200);

    console.log(`[GMC Feed] Fetched ${products.length} products`);

    const entries = products
      .map(buildProductEntry)
      .filter(Boolean);

    console.log(`[GMC Feed] Generated ${entries.length} valid feed entries`);

    const now = new Date().toISOString();

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>${escapeXml(BRAND)} Product Feed</title>
    <link>${SITE_URL}</link>
    <description>Fresh cold-pressed juices and wellness products from ${escapeXml(BRAND)}, Wentzville, MO.</description>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${entries.join('\n')}
  </channel>
</rss>`;

    return new Response(xml, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=1800',
        'X-Feed-Generated': now,
        'X-Product-Count': String(entries.length),
      },
    });
  } catch (error) {
    console.error('[GMC Feed] Error generating feed:', error);
    return new Response(`Error generating feed: ${error.message}`, { status: 500 });
  }
});
