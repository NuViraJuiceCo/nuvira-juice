import React, { useState } from 'react';
import SEO from '@/components/SEO';

import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Minus, Plus, ShoppingBag, Leaf } from 'lucide-react';
import HealthAdvisory from '@/components/HealthAdvisory';
import { Button } from '@/components/ui/button';
import { useCart } from '@/lib/cartContext';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import ProductCard from '@/components/shop/ProductCard';

function normalizeProductLookup(value) {
  return String(value || '')
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase();
}

function slugifyProductTitle(value) {
  return normalizeProductLookup(value)
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function productLookupKeys(product) {
  return [
    product?.id,
    product?.shopify_handle,
    product?.handle,
    product?.shopify_product_id,
    product?.shopify_variant_id,
    slugifyProductTitle(product?.title),
  ]
    .filter(Boolean)
    .map(normalizeProductLookup);
}

export default function ProductDetail() {
  const { id, handle } = useParams();
  const routeIdentifier = decodeURIComponent(handle || id || window.location.pathname.split('/').pop() || '');
  const normalizedRouteIdentifier = normalizeProductLookup(routeIdentifier);
  const navigate = useNavigate();
  const { addItem } = useCart();
  const [quantity, setQuantity] = useState(1);

  const { data: product, isLoading } = useQuery({
    queryKey: ['product', normalizedRouteIdentifier],
    queryFn: async () => {
      const directMatches = await base44.entities.Product.filter({ id: routeIdentifier });
      if (directMatches[0]) return directMatches[0];

      const products = await base44.entities.Product.filter({ is_available: true }, 'sort_order', 200);
      return products.find((candidate) => productLookupKeys(candidate).includes(normalizedRouteIdentifier));
    },
    enabled: !!normalizedRouteIdentifier,
  });

  const { data: relatedProducts = [] } = useQuery({
    queryKey: ['related-products', product?.category],
    queryFn: () => base44.entities.Product.filter({ category: product.category, is_available: true }, 'sort_order', 6),
    enabled: !!product?.category,
  });

  const related = relatedProducts.filter(p => p.id !== product?.id).slice(0, 4);
  const isMerchProduct = ['merch', 'apparel'].includes(product?.category);

  const handleAddToCart = () => {
    if (!product) return;
    const extra = {};
    if (product.category === 'bundle') {
      extra.bottles_per_unit = product.bottle_count || 3;
      // NuVira Trio has fixed composition: 1 RE-NU, 1 OASIS, 1 AURA
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
        <SEO title="Product Not Found" description="This product could not be found." />
        <p className="text-muted-foreground">Product not found</p>
      </div>
    );
  }

  const productStructuredData = {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": product.title,
    "description": product.description || product.short_description || `${product.title} — fresh cold-pressed juice from NuVira Juice Co.`,
    "image": product.image_url || "https://media.base44.com/images/public/69d48d0c39891f7945481152/421b89061_generated_image.png",
    "brand": { "@type": "Brand", "name": "NuVira Juice Co." },
    "offers": {
      "@type": "Offer",
      "url": `https://www.nuvirajuice.com/shop/${product.id}`,
      "priceCurrency": "USD",
      "price": product.price?.toFixed(2),
      "availability": product.is_available !== false ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      "seller": { "@type": "Organization", "name": "NuVira Juice Co." },
      "shippingDetails": {
        "@type": "OfferShippingDetails",
        "shippingRate": {
          "@type": "MonetaryAmount",
          "value": "0",
          "currency": "USD"
        },
        "shippingDestination": {
          "@type": "DefinedRegion",
          "addressCountry": "US",
          "addressRegion": ["MO"]
        },
        "deliveryTime": {
          "@type": "ShippingDeliveryTime",
          "handlingTime": { "@type": "QuantitativeValue", "minValue": 0, "maxValue": 1, "unitCode": "DAY" },
          "transitTime": { "@type": "QuantitativeValue", "minValue": 1, "maxValue": 3, "unitCode": "DAY" }
        }
      },
      "hasMerchantReturnPolicy": {
        "@type": "MerchantReturnPolicy",
        "applicableCountry": "US",
        "returnPolicyCategory": "https://schema.org/MerchantReturnNotPermitted",
        "merchantReturnDays": 0,
        "returnMethod": "https://schema.org/ReturnByMail",
        "returnFees": "https://schema.org/FreeReturn"
      }
    },
    "additionalProperty": product.ingredients ? [{
      "@type": "PropertyValue",
      "name": "Ingredients",
      "value": product.ingredients
    }] : undefined
  };

  return (
    <div style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 6.5rem)' }}>
      <SEO
        title={`${product.title} — Cold-Pressed Juice | Wentzville, MO`}
        description={product.short_description || product.description || `${product.title} — fresh cold-pressed juice from NuVira Juice Co. Delivered in Wentzville, O'Fallon, and St. Louis, MO.`}
        image={product.image_url}
        type="product"
        keywords={`${product.title}, cold pressed juice, NuVira Juice, ${product.category} Wentzville MO, fresh juice delivery St. Louis`}
        structuredData={productStructuredData}
      />
      {/* Desktop back button */}
      <div className="hidden md:flex items-center gap-2 px-6 pt-5 pb-2">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
      </div>

      {/* Two-column layout on desktop, single column on mobile */}
      <div className="md:flex md:gap-8 md:px-6 md:pb-24 md:items-start">
        {/* Image */}
        <div className="md:w-1/2 md:shrink-0">
          <div className="relative aspect-square md:aspect-square md:max-h-[60vh] md:rounded-2xl bg-secondary/50 overflow-hidden">
            {product.image_url ? (
              <img src={product.image_url} alt={product.title} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-7xl">🍊</div>
            )}
            {/* Mobile back button overlay */}
            <button
              onClick={() => navigate(-1)}
              className="md:hidden absolute left-4 w-9 h-9 bg-card/80 backdrop-blur-md rounded-full flex items-center justify-center"
              style={{ top: 'max(1rem, env(safe-area-inset-top))' }}
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="md:w-1/2">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="px-4 pt-6 md:pt-2 md:px-0"
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

            {/* Certifications */}
            {!isMerchProduct && (
              <div className="mt-4 flex flex-wrap gap-2">
                {['Vegan', 'Cold-Pressed', 'Non-GMO', 'Gluten-Free'].map(cert => (
                  <span key={cert} className="text-[10px] font-semibold px-2.5 py-1 bg-nuvira-gradient-soft text-primary border border-nuvira rounded-full">                  ✓ {cert}
                  </span>
                ))}
              </div>
            )}

            {/* You might also like */}
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

      {/* About & Ingredients — full width below */}
      <div className="px-4 md:px-6 mt-6">
        {product.description && (
          <div className="mb-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">About</h3>
            <p className="text-sm text-foreground/80 leading-relaxed">{product.description}</p>
          </div>
        )}
        {product.ingredients && (
          <div className="bg-nuvira-gradient-soft border border-nuvira rounded-xl p-3.5">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Leaf className="w-3.5 h-3.5 text-primary" />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Ingredients</h3>
            </div>
            <p className="text-xs text-foreground/70 leading-relaxed">{product.ingredients}</p>
          </div>
        )}

        {!isMerchProduct && (
          <div className="mt-4">
            <HealthAdvisory variant="expanded" />
          </div>
        )}
      </div>

      {/* Sticky Purchase Bar — fixed above bottom nav */}
      <div 
        className="fixed left-0 right-0 z-30 bg-card/95 backdrop-blur-xl border-t border-border/50"
        style={{
          bottom: 'calc(4rem + env(safe-area-inset-bottom))',
          padding: '10px 16px',
          paddingBottom: '10px',
        }}
      >
        <div className="flex items-center gap-2">
          {/* Quantity Stepper */}
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
          {/* Add to Cart Button */}
          <Button
            onClick={handleAddToCart}
            className="flex-1 h-10 rounded-xl font-semibold text-sm nuvira-gradient-button"          >
            <ShoppingBag className="w-3.5 h-3.5 mr-1.5" />
            {`$${(product.price * quantity).toFixed(2)}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
