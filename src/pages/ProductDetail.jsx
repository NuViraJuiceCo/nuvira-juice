import React, { useEffect, useState } from 'react';
import SEO from '@/components/SEO';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Minus, Plus, ShoppingBag, Leaf } from 'lucide-react';
import HealthAdvisory from '@/components/HealthAdvisory';
import { Button } from '@/components/ui/button';
import { useCart } from '@/lib/cartContext';
import { absoluteUrl, normalizeProductIdentifier, productLookupKeys, productPath } from '@/lib/seo-slugs';
import { findPublicProductFallback } from '@/lib/public-products';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import ProductCard from '@/components/shop/ProductCard';
import { BRAND_OG_IMAGE, brandImageUrl } from '@/lib/brandImages';

function normalizeCategory(value) {
  return String(value || '').trim().toLowerCase();
}

function isMerchLikeProduct(product) {
  const category = normalizeCategory(product?.category);
  const title = String(product?.title || '').trim().toLowerCase();

  return (
    ['merch', 'merchandise', 'apparel', 'tote', 'bag', 'accessory', 'accessories'].includes(category) ||
    /\b(tote|bag|merch|shirt|hoodie|hat)\b/.test(title)
  );
}

export default function ProductDetail() {
  const { id, slug, handle } = useParams();
  const identifier = normalizeProductIdentifier(slug || handle || id || '');
  const navigate = useNavigate();
  const { addItem } = useCart();
  const [quantity, setQuantity] = useState(1);

  const { data: product, isLoading } = useQuery({
    queryKey: ['product-detail', identifier],
    queryFn: async () => {
      const fallbackProduct = findPublicProductFallback(identifier);

      try {
        const availableProducts = await base44.entities.Product.filter({ is_available: true }, 'sort_order', 200);
        const productByLookupKey = availableProducts.find(p => productLookupKeys(p).includes(identifier));
        if (productByLookupKey) return productByLookupKey;

        if (/^[a-f0-9]{24}$/.test(identifier)) {
          const productsById = await base44.entities.Product.filter({ id: identifier });
          if (productsById?.[0]) return productsById[0];
        }

        return fallbackProduct;
      } catch (error) {
        console.warn('[ProductDetail] Falling back to public product metadata for SEO route', identifier, error);
        return fallbackProduct;
      }
    },
    enabled: !!identifier,
  });

  const { data: relatedProducts = [] } = useQuery({
    queryKey: ['related-products', product?.category],
    queryFn: () => base44.entities.Product.filter({ category: product.category, is_available: true }, 'sort_order', 6),
    enabled: !!product?.category,
  });

  const related = relatedProducts.filter(p => p.id !== product?.id).slice(0, 4);

  useEffect(() => {
    if ((id || handle) && product) {
      navigate(productPath(product), { replace: true });
    }
  }, [handle, id, product, navigate]);

  const handleAddToCart = () => {
    if (!product) return;
    const extra = {};
    if (product.category === 'bundle') {
      extra.bottles_per_unit = product.bottle_count || 3;
      if (product.title?.includes('Trio')) {
        extra.bundle_composition = [
          { product_id: 're-nu', product_name: 'RE-NU', quantity: 1 },
          { product_id: 'oasis', product_name: 'OASIS', quantity: 1 },
          { product_id: 'aura', product_name: 'AURA', quantity: 1 },
        ];
      } else {
        extra.bundle_composition = [];
      }
    }
    addItem(product, quantity, extra);
    toast.success(`${product.title} added to cart`);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!product) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <SEO title="Product Not Found" description="This product could not be found." noindex />
        <p className="text-muted-foreground">Product not found</p>
      </div>
    );
  }

  const isMerch = isMerchLikeProduct(product);
  const isMerchProduct = isMerch;
  const productDescriptor = isMerchProduct ? 'NuVira merch' : 'Cold-pressed juice';
  const productBadges = isMerch
    ? ['Reusable', 'Insulated', 'Large Capacity']
    : ['Vegan', 'Cold-Pressed', 'Non-GMO', 'Gluten-Free'];
  const detailUrl = absoluteUrl(productPath(product));
  const productImage = product.image_url ? brandImageUrl(product.image_url) : BRAND_OG_IMAGE;
  const seoTitle = `${product.title} | ${productDescriptor} | Wentzville, MO`;
  const seoDescription = product.short_description || product.description || (
    isMerchProduct
      ? `${product.title} from NuVira Juice Co.`
      : `${product.title} - fresh cold-pressed juice from NuVira Juice Co. Delivered in Wentzville, O'Fallon, and St. Louis, MO.`
  );
  const seoKeywords = isMerchProduct
    ? `${product.title}, NuVira merch, NuVira Juice Co., ${product.category} Wentzville MO`
    : `${product.title}, cold pressed juice, NuVira Juice, ${product.category} Wentzville MO, fresh juice delivery St. Louis`;

  const productStructuredData = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.title,
    description: product.description || product.short_description || seoDescription,
    image: productImage,
    brand: { '@type': 'Brand', name: 'NuVira Juice Co.' },
    offers: {
      '@type': 'Offer',
      url: detailUrl,
      priceCurrency: 'USD',
      price: product.price?.toFixed(2),
      availability: product.is_available !== false ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      seller: { '@type': 'Organization', name: 'NuVira Juice Co.' },
      shippingDetails: {
        '@type': 'OfferShippingDetails',
        shippingRate: {
          '@type': 'MonetaryAmount',
          value: '0',
          currency: 'USD',
        },
        shippingDestination: {
          '@type': 'DefinedRegion',
          addressCountry: 'US',
          addressRegion: ['MO'],
        },
        deliveryTime: {
          '@type': 'ShippingDeliveryTime',
          handlingTime: { '@type': 'QuantitativeValue', minValue: 0, maxValue: 1, unitCode: 'DAY' },
          transitTime: { '@type': 'QuantitativeValue', minValue: 1, maxValue: 3, unitCode: 'DAY' },
        },
      },
      hasMerchantReturnPolicy: {
        '@type': 'MerchantReturnPolicy',
        applicableCountry: 'US',
        returnPolicyCategory: 'https://schema.org/MerchantReturnNotPermitted',
        merchantReturnDays: 0,
        returnMethod: 'https://schema.org/ReturnByMail',
        returnFees: 'https://schema.org/FreeReturn',
      },
    },
    additionalProperty: product.ingredients ? [{
      '@type': 'PropertyValue',
      name: 'Ingredients',
      value: product.ingredients,
    }] : undefined,
  };

  return (
    <div style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 11rem)' }}>
      <SEO
        title={seoTitle}
        description={seoDescription}
        image={productImage}
        type="product"
        keywords={seoKeywords}
        canonicalUrl={detailUrl}
        structuredData={productStructuredData}
      />

      <div className="hidden md:flex items-center gap-2 px-6 pt-5 pb-2">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
      </div>

      <div className="md:flex md:gap-8 md:px-6 md:pb-24 md:items-start">
        <div className="md:w-1/2 md:shrink-0">
          <div
            className={`relative w-full md:aspect-square md:max-h-[60vh] md:rounded-2xl bg-secondary/50 overflow-hidden ${
              isMerchProduct ? 'h-[44vh] min-h-[260px] max-h-[360px]' : 'aspect-square'
            }`}
          >
            {product.image_url ? (
              <img
                src={product.image_url}
                alt={product.title}
                className={`w-full h-full ${isMerchProduct ? 'object-contain p-2 md:p-0' : 'object-cover'}`}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-7xl">{isMerchProduct ? '🛍️' : '🍊'}</div>
            )}
            <button
              onClick={() => navigate(-1)}
              className="md:hidden absolute left-4 w-9 h-9 bg-card/80 backdrop-blur-md rounded-full flex items-center justify-center"
              style={{ top: 'max(1rem, env(safe-area-inset-top))' }}
              aria-label="Go back"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="md:w-1/2">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="px-4 pt-5 md:pt-2 md:px-0"
          >
            {product.is_seasonal && (
              <span className="inline-block bg-accent/20 text-accent text-[10px] font-semibold px-2.5 py-0.5 rounded-full mb-2">
                Seasonal Drop
              </span>
            )}
            <h1 className="font-heading text-2xl font-bold">{product.title}</h1>
            {product.short_description && (
              <p className="text-sm text-muted-foreground mt-1">{product.short_description}</p>
            )}

            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-xl font-bold">${product.price?.toFixed(2)}</span>
              {product.compare_at_price && (
                <span className="text-sm text-muted-foreground line-through">${product.compare_at_price.toFixed(2)}</span>
              )}
              {product.size && (
                <span className="text-xs text-muted-foreground ml-auto">{product.size}</span>
              )}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {productBadges.map(cert => (
                <span key={cert} className="text-[10px] font-semibold px-2.5 py-1 bg-nuvira-gradient-soft text-primary border border-nuvira rounded-full">
                  ✓ {cert}
                </span>
              ))}
            </div>

            {related.length > 0 && (
              <div className="mt-6">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">You might also like</h3>
                <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2 items-stretch">
                  {related.map(p => (
                    <div key={p.id} className="shrink-0 w-36">
                      <ProductCard product={p} compact />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        </div>
      </div>

      <div className="px-4 md:px-6 mt-6 pb-4">
        {product.description && (
          <div className="mb-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">About</h3>
            <p className="text-sm text-foreground/80 leading-relaxed">{product.description}</p>
          </div>
        )}
        {product.ingredients && (
          <div className="bg-secondary/40 rounded-xl p-3.5">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Leaf className="w-3.5 h-3.5 text-primary" />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Ingredients</h3>
            </div>
            <p className="text-xs text-foreground/70 leading-relaxed">{product.ingredients}</p>
          </div>
        )}

        {!isMerch && (
          !isMerchProduct && (
            <div className="mt-4">
              <HealthAdvisory variant="expanded" />
            </div>
          )
        )}
      </div>

      <div
        className="fixed left-0 right-0 z-30 bg-card/95 backdrop-blur-xl border-t border-border/50 md:left-60"
        style={{
          bottom: 'calc(4rem + env(safe-area-inset-bottom))',
          padding: '10px 16px',
          paddingBottom: '10px',
        }}
      >
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2.5 bg-secondary rounded-xl px-3 py-2.5 shrink-0">
            <button
              onClick={() => setQuantity(Math.max(1, quantity - 1))}
              className="active:scale-90 transition-transform hover:opacity-60"
              aria-label="Decrease quantity"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <span className="text-xs font-semibold w-6 text-center">{quantity}</span>
            <button
              onClick={() => setQuantity(quantity + 1)}
              className="active:scale-90 transition-transform hover:opacity-60"
              aria-label="Increase quantity"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
          <Button
            type="button"
            onClick={handleAddToCart}
            className="nuvira-gradient-button flex-1 h-10 rounded-xl font-semibold text-sm inline-flex items-center justify-center"
          >
            <ShoppingBag className="w-3.5 h-3.5 mr-1.5" />
            {`$${((product.price || 0) * quantity).toFixed(2)}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
