import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL') || 'https://nuvira-flow-core.base44.app/api/apps/69da9e8036b037ad40a9a73f/functions';
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    console.log('[PRODUCT SYNC] Starting product sync to hub');

    // Fetch all available products
    const products = await base44.asServiceRole.entities.Product.filter({ is_available: true }, 'sort_order', 100);
    
    if (products.length === 0) {
      console.log('[PRODUCT SYNC] No products to sync');
      return Response.json({ success: true, synced: 0 });
    }

    const payload = {
      products: products.map(p => ({
        id: p.id,
        title: p.title,
        short_description: p.short_description,
        description: p.description,
        category: p.category,
        price: p.price,
        compare_at_price: p.compare_at_price,
        image_url: p.image_url,
        secondary_images: p.secondary_images || [],
        size: p.size,
        bottle_count: p.bottle_count,
        tags: p.tags || [],
        is_featured: p.is_featured,
        is_best_seller: p.is_best_seller,
        is_seasonal: p.is_seasonal,
        is_available: p.is_available,
        shopify_product_id: p.shopify_product_id,
      })),
    };

    const hubResponse = await fetch(`${HUB_API_URL}/syncProducts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CUSTOMER_APP_SYNC_SECRET}`,
      },
      body: JSON.stringify(payload),
    });

    if (!hubResponse.ok) {
      const errorText = await hubResponse.text();
      console.error(`[PRODUCT SYNC] Hub returned ${hubResponse.status}: ${errorText}`);

      await base44.asServiceRole.entities.ShopifySyncLog.create({
        sync_type: 'manual',
        status: 'error',
        records_synced: 0,
        records_failed: products.length,
        error_details: `Product sync failed: ${errorText}`,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        triggered_by: 'admin',
      });

      return Response.json({ error: `Hub sync failed (${hubResponse.status})` }, { status: hubResponse.status });
    }

    const result = await hubResponse.json();
    console.log(`[PRODUCT SYNC] Successfully synced ${products.length} products`);

    await base44.asServiceRole.entities.ShopifySyncLog.create({
      sync_type: 'manual',
      status: 'success',
      records_synced: products.length,
      records_failed: 0,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      triggered_by: 'admin',
    });

    return Response.json({ success: true, synced: products.length, hub_response: result });
  } catch (error) {
    console.error('[PRODUCT SYNC] Error:', error.message);
    
    try {
      const base44 = createClientFromRequest(req);
      await base44.asServiceRole.entities.ShopifySyncLog.create({
        sync_type: 'manual',
        status: 'error',
        records_synced: 0,
        records_failed: 1,
        error_details: error.message,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        triggered_by: 'admin',
      });
    } catch {}

    return Response.json({ error: error.message }, { status: 500 });
  }
});