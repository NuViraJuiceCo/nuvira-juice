import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SITE_URL = 'https://www.nuvirajuice.com';
const BRAND = 'NuVira Juice Co.';

const GOOGLE_PRODUCT_CATEGORIES = {
  juice: '2887',
  tote: '5608',
};

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

const MERCHANT_COPY = {
  aura: {
    title: 'NuVira AURA Cold-Pressed Juice – 12 oz',
    description: 'A 12 oz cold-pressed juice blend made with carrot, orange, pineapple, cucumber, ginger, sea salt, and coconut water. Keep refrigerated.',
  },
  oasis: {
    title: 'NuVira OASIS Cold-Pressed Juice – 12 oz',
    description: 'A 12 oz cold-pressed juice blend made with watermelon, pineapple, orange, lemon, ginger, sea salt, black pepper, and coconut water. Keep refrigerated.',
  },
  're-nu': {
    title: 'NuVira RE-NU Cold-Pressed Green Juice – 12 oz',
    description: 'A 12 oz cold-pressed green juice made with cucumber, apple, celery, and kale. Keep refrigerated.',
  },
  'the nuvira trio': {
    title: 'NuVira Cold-Pressed Juice Trio – 3 × 12 oz',
    description: 'One 12 oz bottle each of NuVira AURA, RE-NU, and OASIS cold-pressed juice. Keep refrigerated.',
  },
  'orange juice': {
    title: 'NuVira Cold-Pressed Orange Juice – 32 oz',
    description: 'A 32 oz bottle of cold-pressed orange juice made from oranges with no added sugar or preservatives. Keep refrigerated.',
  },
  'pineapple juice': {
    title: 'NuVira Cold-Pressed Pineapple Juice – 32 oz',
    description: 'A 32 oz bottle of cold-pressed pineapple juice made from whole pineapple with no added sugar or preservatives. Keep refrigerated.',
  },
  'watermelon juice': {
    title: 'NuVira Cold-Pressed Watermelon Juice – 32 oz',
    description: 'A 32 oz bottle of cold-pressed watermelon juice made from fresh watermelon with no added sugar or preservatives. Keep refrigerated.',
  },
  'radiance shot': {
    title: 'NuVira Radiance Wellness Shot – 2 oz',
    description: 'A 2 oz wellness shot made with beet, apple, and lemon. Keep refrigerated.',
  },
  'hydration shot': {
    title: 'NuVira Hydration Wellness Shot – 2 oz',
    description: 'A 2 oz wellness shot made with coconut water, pink Himalayan salt, lime, honey, and mint. Keep refrigerated.',
  },
  'reset shot': {
    title: 'NuVira Reset Wellness Shot – 2 oz',
    description: 'A 2 oz wellness shot made with pineapple, lemon, ginger, and black salt. Keep refrigerated.',
  },
  'large nuvira tote bag': {
    title: 'NuVira Reusable Tote Bag – Large',
    description: 'A large reusable NuVira tote bag for event days, juice runs, and everyday carry.',
  },
};

const MERCHANT_IMAGE_SETS = {
  aura: {
    primary: `${SITE_URL}/images/products/aura-main.jpg`,
    additional: [
      `${SITE_URL}/images/products/aura-lifestyle.jpg`,
      `${SITE_URL}/images/brand/nuvira-bottles-cooler-wide.jpg`,
    ],
  },
  oasis: {
    primary: `${SITE_URL}/images/products/oasis-main.jpg`,
    additional: [
      `${SITE_URL}/images/products/oasis-lifestyle.jpg`,
      `${SITE_URL}/images/brand/nuvira-bottles-cooler-wide.jpg`,
    ],
  },
  're-nu': {
    primary: `${SITE_URL}/images/products/re-nu-main.jpg`,
    additional: [
      `${SITE_URL}/images/products/re-nu-lifestyle.jpg`,
      `${SITE_URL}/images/brand/nuvira-bottles-cooler-wide.jpg`,
    ],
  },
  'the nuvira trio': {
    primary: `${SITE_URL}/images/products/nuvira-trio-main.jpg`,
    additional: [
      `${SITE_URL}/images/products/nuvira-trio-lifestyle.jpg`,
      `${SITE_URL}/images/brand/nuvira-bottles-cooler-wide.jpg`,
      `${SITE_URL}/images/brand/nuvira-trio-outdoor-event.jpg`,
    ],
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
  // Keep Google's additional images to the first-party set that is verified
  // for supported file types and stable public delivery.
  const candidates = curated?.additional || [];
  const additional = [...new Set(candidates.filter(url => url && url !== primary))].slice(0, 9);
  return { primary, additional };
}

function getGoogleProductCategory(product) {
  const titleKey = String(product.title || '').trim().toLowerCase();
  if (titleKey.includes('tote') || titleKey.includes('shopping bag')) {
    return GOOGLE_PRODUCT_CATEGORIES.tote;
  }
  return GOOGLE_PRODUCT_CATEGORIES.juice;
}

function getMerchantCopy(product) {
  const titleKey = String(product.title || '').trim().toLowerCase();
  const curated = MERCHANT_COPY[titleKey];
  if (curated) return curated;
  const size = String(product.size || '').trim();
  return {
    title: `${String(product.title || '').trim()}${size ? ` – ${size}` : ''}`,
    description: `${String(product.title || '').trim()} from NuVira Juice Co. See the product page for current ingredients, size, availability, and scheduled local-delivery details.`,
  };
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
  const copy = getMerchantCopy(product);
  const title = escapeXml(copy.title);
  const description = escapeXml(copy.description);
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
      <g:google_product_category>${escapeXml(getGoogleProductCategory(product))}</g:google_product_category>
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
