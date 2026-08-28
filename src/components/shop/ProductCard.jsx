import React from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useCart } from '@/lib/cartContext';
import { productPath } from '@/lib/seo-slugs';
import { motion } from 'framer-motion';
import { trackGoogleSelectItem } from '@/lib/googleAnalytics';
import { productCardImage } from '@/lib/product-card-images';

// Tap-vs-scroll guard: only fire click if touch didn't move more than 8px
function useTapGuard() {
  const startPos = React.useRef(null);
  const didScroll = React.useRef(false);
  return {
    onTouchStart: (e) => { startPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; didScroll.current = false; },
    onTouchMove: (e) => {
      if (!startPos.current) return;
      const dy = Math.abs(e.touches[0].clientY - startPos.current.y);
      if (dy > 8) didScroll.current = true;
    },
    guardClick: (handler) => (e) => { if (didScroll.current) { e.preventDefault(); e.stopPropagation(); return; } handler(e); },
  };
}

export default function ProductCard({ product, compact = false }) {
  const { addItem } = useCart();
  const tapGuard = useTapGuard();
  const detailPath = productPath(product);
  const cardImage = productCardImage(product);
  const fallbackIcon = product.category === 'merch' || product.category === 'apparel' ? '🛍️' : '🍊';

  const handleQuickAdd = (e) => {
    e.preventDefault();
    e.stopPropagation();
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
    addItem(product, 1, extra);
  };

  const handleSelect = () => {
    void trackGoogleSelectItem(product);
  };

  if (compact) {
    return (
      <motion.div
        whileTap={{ scale: 0.94 }}
        transition={{ type: 'spring', stiffness: 400, damping: 28 }}
        className="relative overflow-hidden rounded-2xl border border-border/50 bg-card shadow-md"
        style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.01) 100%)' }}
      >
        <div className="relative overflow-hidden" style={{ aspectRatio: '1/1' }}>
          {cardImage ? (
            <motion.img
              src={cardImage}
              alt=""
              className="h-full w-full object-cover"
              whileHover={{ scale: 1.05 }}
              transition={{ duration: 0.4 }}
              width="300"
              height="400"
              loading="lazy"
              decoding="async"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-secondary/50 text-4xl" aria-hidden="true">{fallbackIcon}</div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
          <div className="absolute bottom-2 left-2 rounded-full bg-white/95 px-2.5 py-1 backdrop-blur">
            <span className="text-xs font-bold text-slate-900">${product.price?.toFixed(2)}</span>
          </div>
          <motion.button
            type="button"
            onClick={handleQuickAdd}
            whileTap={{ scale: 0.88 }}
            aria-label={`Add ${product.title} to cart`}
            className="absolute bottom-2 right-2 z-20 flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md transition-opacity active:opacity-90"
          >
            <Plus className="h-4 w-4" />
          </motion.button>
          {product.is_best_seller && (
            <div className="absolute left-2 top-2 rounded-full bg-accent px-2 py-0.5 text-[9px] font-bold text-white shadow">
              Best Seller
            </div>
          )}
        </div>
        <div className="px-2.5 py-2">
          <p className="truncate text-xs font-semibold text-foreground">{product.title}</p>
          {product.size && <p className="text-[10px] text-foreground/55">{product.size}</p>}
        </div>
        <Link
          to={detailPath}
          aria-label={`View ${product.title}`}
          onClick={tapGuard.guardClick(handleSelect)}
          onTouchStart={tapGuard.onTouchStart}
          onTouchMove={tapGuard.onTouchMove}
          className="absolute inset-0 z-10 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        />
      </motion.div>
    );
  }

  return (
    <motion.div
      whileTap={{ scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 400, damping: 28 }}
      className="relative overflow-hidden rounded-xl border border-border/50 bg-card shadow-md"
      style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.01) 100%)' }}
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-secondary/50">
        {cardImage ? (
          <img src={cardImage} alt="" className="h-full w-full object-cover" width="400" height="300" loading="lazy" decoding="async" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-5xl" aria-hidden="true">{fallbackIcon}</div>
        )}
        {product.is_seasonal && (
          <span className="absolute left-2 top-2 rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-accent-foreground">
            Seasonal
          </span>
        )}
        <button
          type="button"
          onClick={handleQuickAdd}
          aria-label={`Add ${product.title} to cart`}
          className="absolute bottom-2 right-2 z-20 flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md transition-transform active:scale-90"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      <div className="p-3">
        <p className="text-sm font-semibold text-foreground">{product.title}</p>
        {product.short_description && (
          <p className="mt-0.5 line-clamp-1 text-xs text-foreground/55">{product.short_description}</p>
        )}
        <div className="mt-1.5 flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">${product.price?.toFixed(2)}</span>
          {product.compare_at_price && (
            <span className="text-xs text-foreground/45 line-through">${product.compare_at_price.toFixed(2)}</span>
          )}
          {product.size && (
            <span className="ml-auto text-[10px] text-foreground/50">{product.size}</span>
          )}
        </div>
      </div>
      <Link
        to={detailPath}
        aria-label={`View ${product.title}`}
        onClick={tapGuard.guardClick(handleSelect)}
        onTouchStart={tapGuard.onTouchStart}
        onTouchMove={tapGuard.onTouchMove}
        className="absolute inset-0 z-10 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      />
    </motion.div>
  );
}
