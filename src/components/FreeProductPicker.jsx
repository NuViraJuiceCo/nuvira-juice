import React, { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import CustomerDialog from '@/components/CustomerDialog';
import ProductPhoto from '@/components/shop/ProductPhoto';
import { productThumbnailImage } from '@/lib/approved-product-media';

/**
 * Props:
 *  open: boolean
 *  onClose: () => void
 *  onSelect: (product) => void
 *  title: string
 *  category: string (optional filter, e.g. 'juice')
 */
export default function FreeProductPicker({ open, onClose, onSelect, title = 'Choose Your Free Item', category, isEligible, triggerRef }) {
  const selectingRef = useRef(false);
  const [selecting, setSelecting] = useState(false);
  const [selectionError, setSelectionError] = useState('');
  const { data: products = [], isLoading, isError } = useQuery({
    queryKey: ['free-picker-products', category],
    queryFn: () => {
      const filter = { is_available: true };
      if (category) filter.category = category;
      return base44.entities.Product.filter(filter, 'sort_order', 30);
    },
    enabled: open,
  });

  const handleSelect = async (product) => {
    if (selectingRef.current) return;
    selectingRef.current = true;
    setSelecting(true);
    setSelectionError('');
    try {
      const result = await onSelect(product);
      if (result !== false) onClose();
    } catch (error) {
      setSelectionError(error?.message || 'Unable to select this item. Please try again.');
    } finally {
      selectingRef.current = false;
      setSelecting(false);
    }
  };
  const closePicker = () => { if (!selectingRef.current) { setSelectionError(''); onClose(); } };
  const eligibleProducts = isEligible ? products.filter(isEligible) : products;

  return (
    <CustomerDialog open={open} onClose={closePicker} title={title} description="Select an eligible item for your reward." busy={selecting} triggerRef={triggerRef}>

            {/* Product List */}
            <div className="overflow-y-auto flex-1 px-4 py-4 space-y-2">
              {(selectionError || isError) && <p role="alert" className="text-sm text-destructive">{selectionError || 'Products could not be loaded. Please close and try again.'}</p>}
              {!isLoading && !isError && eligibleProducts.length === 0 && <p className="text-sm text-muted-foreground">No eligible items are available right now. Your points have not been used.</p>}
              {isLoading && (
                <div className="flex items-center justify-center py-10">
                  <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              {!isLoading && eligibleProducts.map(product => (
                <button
                  type="button"
                  key={product.id}
                  disabled={selecting}
                  onClick={() => handleSelect(product)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl bg-secondary/40 hover:bg-primary/10 active:bg-primary/20 transition-colors text-left"
                >
                  <div className="w-14 h-14 rounded-lg overflow-hidden bg-muted shrink-0">
                    {productThumbnailImage(product) ? (
                      <ProductPhoto product={product} thumbnail alt={product.title} className="w-full h-full object-cover" />
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
    </CustomerDialog>
  );
}
