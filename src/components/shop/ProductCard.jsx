import React from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useCart } from '@/lib/cartContext';
import { motion } from 'framer-motion';

export default function ProductCard({ product, compact = false }) {
  const { addItem } = useCart();

  const handleQuickAdd = (e) => {
    e.preventDefault();
    e.stopPropagation();
    addItem(product);
  };

  if (compact) {
    return (
      <Link to={`/shop/${product.id}`}>
        <motion.div
          whileTap={{ scale: 0.97 }}
          className="bg-card rounded-xl border border-border/50 overflow-hidden"
        >
          <div className="aspect-square bg-secondary/50 relative overflow-hidden">
            {product.image_url ? (
              <img src={product.image_url} alt={product.title} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-3xl">🍊</div>
            )}
            <button
              onClick={handleQuickAdd}
              className="absolute bottom-2 right-2 w-7 h-7 bg-primary text-primary-foreground rounded-full flex items-center justify-center shadow-md active:scale-90 transition-transform"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="p-2.5">
            <p className="text-xs font-medium truncate">{product.title}</p>
            <p className="text-xs text-muted-foreground">${product.price?.toFixed(2)}</p>
          </div>
        </motion.div>
      </Link>
    );
  }

  return (
    <Link to={`/shop/${product.id}`}>
      <motion.div
        whileTap={{ scale: 0.98 }}
        className="bg-card rounded-xl border border-border/50 overflow-hidden"
      >
        <div className="aspect-[4/3] bg-secondary/50 relative overflow-hidden">
          {product.image_url ? (
            <img src={product.image_url} alt={product.title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-5xl">🍊</div>
          )}
          {product.is_seasonal && (
            <span className="absolute top-2 left-2 bg-accent text-accent-foreground text-[10px] font-bold px-2 py-0.5 rounded-full">
              Seasonal
            </span>
          )}
          <button
            onClick={handleQuickAdd}
            className="absolute bottom-2 right-2 w-8 h-8 bg-primary text-primary-foreground rounded-full flex items-center justify-center shadow-md active:scale-90 transition-transform"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
        <div className="p-3">
          <p className="font-medium text-sm">{product.title}</p>
          {product.short_description && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{product.short_description}</p>
          )}
          <div className="flex items-center gap-2 mt-1.5">
            <span className="text-sm font-semibold">${product.price?.toFixed(2)}</span>
            {product.compare_at_price && (
              <span className="text-xs text-muted-foreground line-through">${product.compare_at_price.toFixed(2)}</span>
            )}
            {product.size && (
              <span className="text-[10px] text-muted-foreground ml-auto">{product.size}</span>
            )}
          </div>
        </div>
      </motion.div>
    </Link>
  );
}