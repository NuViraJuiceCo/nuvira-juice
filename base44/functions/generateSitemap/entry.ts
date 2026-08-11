import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SITE_URL = 'https://www.nuvirajuice.com';

const STATIC_PAGES = [
  { path: '/', priority: '1.0', changefreq: 'daily' },
  { path: '/shop', priority: '0.9', changefreq: 'daily' },
  { path: '/our-story', priority: '0.7', changefreq: 'monthly' },
  { path: '/contact', priority: '0.7', changefreq: 'monthly' },
  { path: '/support', priority: '0.6', changefreq: 'monthly' },
  { path: '/why-nuvira', priority: '0.6', changefreq: 'monthly' },
  { path: '/events', priority: '0.6', changefreq: 'weekly' },
  { path: '/merch', priority: '0.5', changefreq: 'weekly' },
  { path: '/rewards', priority: '0.5', changefreq: 'monthly' },
  { path: '/referral', priority: '0.5', changefreq: 'monthly' },
  { path: '/partner', priority: '0.5', changefreq: 'monthly' },
  { path: '/legal', priority: '0.3', changefreq: 'yearly' },
  { path: '/program/radiance', priority: '0.8', changefreq: 'weekly' },
  { path: '/program/hydration', priority: '0.8', changefreq: 'weekly' },
  { path: '/program/reset', priority: '0.8', changefreq: 'weekly' },
];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const today = new Date().toISOString().split('T')[0];

    // Fetch all available products
    const products = await base44.asServiceRole.entities.Product.filter({ is_available: true });

    // Build XML entries
    const staticEntries = STATIC_PAGES.map(p => `
  <url>
    <loc>${SITE_URL}${p.path}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`).join('');

    const productEntries = products.map(p => `
  <url>
    <loc>${SITE_URL}/shop/${p.id}</loc>
    <lastmod>${(p.updated_date || today).split('T')[0]}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`).join('');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${staticEntries}
${productEntries}
</urlset>`;

    return new Response(xml, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    console.error('Sitemap generation error:', error);
    return new Response('Error generating sitemap', { status: 500 });
  }
});
