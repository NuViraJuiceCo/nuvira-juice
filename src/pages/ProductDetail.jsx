import React, { useState } from 'react';
import SEO from '@/components/SEO';
import PreorderBanner from '@/components/PreorderBanner';
import { isPreorderMode } from '@/lib/preorderConfig';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Minus, Plus, ShoppingBag, Heart, Leaf, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCart } from '@/lib/cartContext';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import ProductCard from '@/components/shop/ProductCard';

export default function ProductDetail() {
  const urlParams = new URLSearchParams(window.location.search);
  const id = window.location.pathname.split('/').pop();
  const navigate = useNavigate();
  const { addItem } = useCart();
  const [quantity, setQuantity] = useState(1);

  const { data: product, isLoading } = useQuery({
    queryKey: ['product', id],
    queryFn: async () => {
      const products = await base44.entities.Product.filter({ id });
      return products[0];
    },
    enabled: !!id,
  });

  const { data: relatedProducts = [] } = useQuery({
    queryKey: ['related-products', product?.category],
    queryFn: () => base44.entities.Product.filter({ category: product.category, is_available: true }, 'sort_order', 6),
    enabled: !!product?.category,
  });

  const related = relatedProducts.filter(p => p.id !== id).slice(0, 4);

  const handleAddToCart = () => {
    if (!product) return;
    const extra = {};
    if (product.category === 'bundle') {
      extra.bottles_per_unit = product.bottle_count || 3;
      extra.bundle_composition = [];
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
    "description": product.short_description || product.description || '',
    "image": product.image_url || '',
    "brand": { "@type": "Brand", "name": "NuVira Juice Co." },
    "offers": {
      "@type": "Offer",
      "url": `https://www.nuvirajuice.com/shop/${product.id}`,
      "priceCurrency": "USD",
      "price": product.price?.toFixed(2),
      "availability": product.is_available !== false ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      "seller": { "@type": "Organization", "name": "NuVira Juice Co." }
    },
    "additionalProperty": product.ingredients ? [{
      "@type": "PropertyValue",
      "name": "Ingredients",
      "value": product.ingredients
    }] : undefined
  };

  return (
    <div className="pb-40 md:pb-0" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 8rem)' }}>
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
            {/* Pre-order badge */}
            {(isPreorderMode() || product.is_preorder) && (
              <span className="inline-block bg-primary/10 text-primary text-[10px] font-bold px-2.5 py-0.5 rounded-full mb-2 border border-primary/20">
                ✦ Pre-Order — Delivered May 2nd
              </span>
            )}
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
            <div className="mt-4 flex flex-wrap gap-2">
              {['Vegan', 'Cold-Pressed', 'Non-GMO', 'Gluten-Free'].map(cert => (
                <span key={cert} className="text-[10px] font-semibold px-2.5 py-1 bg-primary/8 text-primary border border-primary/20 rounded-full">
                  ✓ {cert}
                </span>
              ))}
            </div>

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
          <div className="bg-secondary/40 rounded-xl p-3.5">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Leaf className="w-3.5 h-3.5 text-primary" />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Ingredients</h3>
            </div>
            <p className="text-xs text-foreground/70 leading-relaxed">{product.ingredients}</p>
          </div>
        )}
      </div>

      {/* Bottom Bar */}
      <div className="fixed bottom-16 md:bottom-0 left-0 md:left-60 right-0 z-30 bg-card/95 backdrop-blur-xl border-t border-border shadow-lg" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="flex items-center gap-3 px-4 py-3 md:px-6 md:max-w-4xl">
          <div className="flex items-center gap-3 bg-secondary rounded-xl px-3 py-2">
            <button onClick={() => setQuantity(Math.max(1, quantity - 1))} className="active:scale-90 transition-transform">
              <Minus className="w-4 h-4" />
            </button>
            <span className="text-sm font-semibold w-5 text-center">{quantity}</span>
            <button onClick={() => setQuantity(quantity + 1)} className="active:scale-90 transition-transform">
              <Plus className="w-4 h-4" />
            </button>
          </div>
          <Button
            onClick={handleAddToCart}
            className="flex-1 h-11 rounded-xl font-semibold"
          >
            <ShoppingBag className="w-4 h-4 mr-2" />
            {(isPreorderMode() || product.is_preorder) ? `Pre-Order · $${(product.price * quantity).toFixed(2)}` : `Add to Cart · $${(product.price * quantity).toFixed(2)}`}
          </Button>
        </div>
      </div>
    </div>
  );
}