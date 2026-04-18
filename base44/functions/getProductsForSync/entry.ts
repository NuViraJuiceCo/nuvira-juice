import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token || token !== CUSTOMER_APP_SYNC_SECRET) {
      console.error('getProductsForSync: unauthorized request');
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const base44 = createClientFromRequest(req);
    const products = await base44.asServiceRole.entities.Product.list();

    const formatted = products.map(p => ({
      id: p.id,
      name: p.title,
      price: p.price,
      sku: p.sku || null,
      description: p.description,
      category: p.category,
      image_url: p.image_url,
      availability: p.is_available,
      compare_at_price: p.compare_at_price,
      size: p.size,
      tags: p.tags,
    }));

    console.log(`getProductsForSync: returning ${formatted.length} products`);
    return Response.json({ products: formatted });
  } catch (error) {
    console.error('getProductsForSync error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});