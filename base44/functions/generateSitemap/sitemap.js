export const SITE_URL = 'https://nuvirajuice.com';

export const STATIC_PAGES = Object.freeze([
  { path: '/', priority: '1.0', changefreq: 'daily' },
  { path: '/shop', priority: '0.9', changefreq: 'daily' },
  { path: '/cold-pressed-juice-delivery', priority: '0.85', changefreq: 'weekly' },
  { path: '/fresh-juice-delivery-st-louis', priority: '0.85', changefreq: 'weekly' },
  { path: '/cold-pressed-juice-wentzville', priority: '0.85', changefreq: 'weekly' },
  { path: '/juice-cleanse-wentzville', priority: '0.8', changefreq: 'weekly' },
  { path: '/all-natural-juice-wentzville', priority: '0.8', changefreq: 'weekly' },
  { path: '/juice-catering-st-louis', priority: '0.8', changefreq: 'weekly' },
  { path: '/cold-pressed-juice-ofallon-mo', priority: '0.8', changefreq: 'weekly' },
  { path: '/juice-delivery-st-charles-mo', priority: '0.8', changefreq: 'weekly' },
  { path: '/juice-delivery-lake-saint-louis', priority: '0.8', changefreq: 'weekly' },
  { path: '/wellness-shots-wentzville', priority: '0.75', changefreq: 'weekly' },
  { path: '/corporate-juice-catering-st-louis', priority: '0.75', changefreq: 'weekly' },
  { path: '/fresh-juice-for-events-st-louis', priority: '0.75', changefreq: 'weekly' },
  { path: '/program/radiance', priority: '0.8', changefreq: 'weekly' },
  { path: '/program/hydration', priority: '0.8', changefreq: 'weekly' },
  { path: '/program/reset', priority: '0.8', changefreq: 'weekly' },
  { path: '/why-nuvira', priority: '0.7', changefreq: 'monthly' },
  { path: '/about', priority: '0.7', changefreq: 'monthly' },
  { path: '/contact', priority: '0.7', changefreq: 'monthly' },
  { path: '/support', priority: '0.6', changefreq: 'monthly' },
  { path: '/returns.html', priority: '0.6', changefreq: 'monthly' },
  { path: '/delivery.html', priority: '0.7', changefreq: 'monthly' },
  { path: '/partner', priority: '0.6', changefreq: 'monthly' },
  { path: '/events', priority: '0.6', changefreq: 'weekly' },
  { path: '/merch', priority: '0.5', changefreq: 'weekly' },
  { path: '/book-event', priority: '0.6', changefreq: 'monthly' },
  { path: '/connect', priority: '0.5', changefreq: 'monthly' },
  { path: '/legal', priority: '0.3', changefreq: 'yearly' },
]);

export function slugifyProductTitle(value = '') {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function escapeXml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function dateOnly(value, fallback) {
  const match = String(value || '').match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : fallback;
}

function urlEntry({ loc, changefreq, priority, lastmod }) {
  return [
    '  <url>',
    `    <loc>${escapeXml(loc)}</loc>`,
    lastmod ? `    <lastmod>${escapeXml(lastmod)}</lastmod>` : null,
    `    <changefreq>${changefreq}</changefreq>`,
    `    <priority>${priority}</priority>`,
    '  </url>',
  ].filter(Boolean).join('\n');
}

export function buildSitemap(products = [], today = new Date().toISOString().slice(0, 10)) {
  const staticEntries = STATIC_PAGES.map(page => urlEntry({
    loc: `${SITE_URL}${page.path}`,
    changefreq: page.changefreq,
    priority: page.priority,
  }));

  const productSlugs = new Set();
  const productEntries = [];

  for (const product of products) {
    if (product?.is_available === false) continue;
    const slug = slugifyProductTitle(product?.title);
    if (!slug || productSlugs.has(slug)) continue;

    productSlugs.add(slug);
    productEntries.push(urlEntry({
      loc: `${SITE_URL}/product/${slug}.html`,
      lastmod: dateOnly(product?.updated_date, today),
      changefreq: 'weekly',
      priority: '0.8',
    }));
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...staticEntries, ...productEntries].join('\n')}
</urlset>`;
}
