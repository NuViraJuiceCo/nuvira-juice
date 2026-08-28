import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { buildSitemap } from './sitemap.js';

Deno.serve(async (req) => {
  try {
    if (!['GET', 'HEAD'].includes(req.method)) {
      return new Response('Method not allowed', {
        status: 405,
        headers: { Allow: 'GET, HEAD' },
      });
    }

    const base44 = createClientFromRequest(req);
    const today = new Date().toISOString().split('T')[0];
    const products = await base44.asServiceRole.entities.Product.filter({ is_available: true });
    const xml = buildSitemap(products, today);

    return new Response(req.method === 'HEAD' ? null : xml, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    console.error('Sitemap generation failed');
    return new Response('Error generating sitemap', { status: 500 });
  }
});
