import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * Props:
 *  open: boolean
 *  onClose: () => void
 *  onSelect: (product) => void
 *  title: string
 *  category: string (optional filter, e.g. 'juice')
 */
export default function FreeProductPicker({ open, onClose, onSelect, title = 'Choose Your Free Item', category }) {
  const { data: products = [], isLoading } = useQuery({
    queryKey: ['free-picker-products', category],
    queryFn: () => {
      const filter = { is_available: true };
      if (category) filter.category = category;
      return base44.entities.Product.filter(filter, 'sort_order', 30);
    },
    enabled: open,
  });

  const handleSelect = (product) => {
    onSelect(product);
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
          />

          {/* Sheet */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 z-40 bg-card rounded-t-3xl shadow-2xl max-h-[80vh] flex flex-col"
          >
            {/* Handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 bg-border rounded-full" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <h2 className="font-heading text-lg font-bold">{title}</h2>
              <button onClick={onClose} className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Product List */}
            <div className="overflow-y-auto flex-1 px-4 py-4 space-y-2">
              {isLoading && (
                <div className="flex items-center justify-center py-10">
                  <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              {!isLoading && products.map(product => (
                <button
                  key={product.id}
                  onClick={() => handleSelect(product)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl bg-secondary/40 hover:bg-primary/10 active:bg-primary/20 transition-colors text-left"
                >
                  <div className="w-14 h-14 rounded-lg overflow-hidden bg-muted shrink-0">
                    {product.image_url ? (
                      <img src={product.image_url} alt={product.title} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-2xl">🍊</div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{product.title}</p>
                    {product.short_description && (
                      <p className="text-xs text-muted-foreground truncate">{product.short_description}</p>
                    )}
                    {product.size && <p className="text-xs text-muted-foreground">{product.size}</p>}
                  </div>
                  <span className="text-xs font-bold text-primary bg-primary/10 px-2.5 py-1 rounded-full whitespace-nowrap">Free →</span>
                </button>
              ))}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}