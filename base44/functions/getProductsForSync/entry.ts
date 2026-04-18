import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_SYNC_SECRET = Deno.env.get('HUB_SYNC_SECRET');

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token || token !== HUB_SYNC_SECRET) {
      console.error('getProductsForSync: unauthorized request');
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const base44 = createClientFromRequest(req);
    const products = await base44.asServiceRole.entities.Product.list();

    const formatted = products.map(p => ({
      id: p.id,
      title: p.title,
      price: p.price,
      sku: p.sku || null,
      category: p.category,
      image_url: p.image_url,
      is_available: p.is_available,
      tags: p.tags,
    }));

    console.log(`getProductsForSync: returning ${products.length} products`);
    return Response.json({ products: formatted });
  } catch (error) {
    console.error('getProductsForSync error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});