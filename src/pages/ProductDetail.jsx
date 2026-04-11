import React, { useState } from 'react';
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
    addItem(product, quantity);
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
        <p className="text-muted-foreground">Product not found</p>
      </div>
    );
  }

  return (
    <div className="pb-32">
      {/* Image */}
      <div className="relative">
        <div className="aspect-square bg-secondary/50 overflow-hidden">
          {product.image_url ? (
            <img src={product.image_url} alt={product.title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-7xl">🍊</div>
          )}
        </div>
        <button
          onClick={() => navigate(-1)}
          className="absolute top-4 left-4 w-9 h-9 bg-card/80 backdrop-blur-md rounded-full flex items-center justify-center"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="px-4 -mt-4 relative"
      >
        <div className="bg-card rounded-t-2xl pt-5 px-1">
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

          {/* Description */}
          {product.description && (
            <div className="mt-5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">About</h3>
              <p className="text-sm text-foreground/80 leading-relaxed">{product.description}</p>
            </div>
          )}

          {/* Ingredients */}
          {product.ingredients && (
            <div className="mt-4 bg-secondary/40 rounded-xl p-3.5">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Leaf className="w-3.5 h-3.5 text-primary" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Ingredients</h3>
              </div>
              <p className="text-xs text-foreground/70 leading-relaxed">{product.ingredients}</p>
            </div>
          )}

          {/* Wellness Note */}
          {product.wellness_note && (
            <div className="mt-3 bg-primary/5 rounded-xl p-3.5">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Info className="w-3.5 h-3.5 text-primary" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-primary">Wellness</h3>
              </div>
              <p className="text-xs text-foreground/70 leading-relaxed">{product.wellness_note}</p>
            </div>
          )}

          {/* Related */}
          {related.length > 0 && (
            <div className="mt-6">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">You might also like</h3>
              <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2">
                {related.map(p => (
                  <div key={p.id} className="shrink-0 w-36">
                    <ProductCard product={p} compact />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </motion.div>

      {/* Bottom Bar */}
      <div className="fixed bottom-16 md:bottom-0 left-0 md:left-60 right-0 z-40 bg-card/95 backdrop-blur-xl border-t border-border">
        <div className="max-w-lg mx-auto flex items-center gap-3 px-4 py-3">
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
            Add to Cart · ${(product.price * quantity).toFixed(2)}
          </Button>
        </div>
      </div>
    </div>
  );
}