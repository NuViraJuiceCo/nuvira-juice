import React, { useState } from 'react';
import { Package } from 'lucide-react';
import { resolveOrderItemImage } from '@/lib/order-item-images';

const SIZE_CLASSES = {
  compact: 'h-7 w-7 rounded-full',
  small: 'h-10 w-10 rounded-xl',
  default: 'h-12 w-12 rounded-xl',
};

export default function OrderItemThumbnail({ item, size = 'default', className = '' }) {
  const imageUrl = resolveOrderItemImage(item);
  const [failedImageUrl, setFailedImageUrl] = useState(null);

  const sizeClass = SIZE_CLASSES[size] || SIZE_CLASSES.default;
  const iconClass = size === 'compact' ? 'h-3.5 w-3.5' : 'h-5 w-5';

  return (
    <div className={`${sizeClass} shrink-0 overflow-hidden bg-secondary ${className}`}>
      {imageUrl && failedImageUrl !== imageUrl ? (
        <img
          src={imageUrl}
          alt={`${item?.title || item?.name || 'Ordered item'} product`}
          className="h-full w-full object-cover"
          loading="lazy"
          decoding="async"
          onError={() => setFailedImageUrl(imageUrl)}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-muted-foreground" aria-hidden="true">
          <Package className={iconClass} />
        </div>
      )}
    </div>
  );
}
