import React from 'react';

/**
 * MobileCarousel: Reusable horizontal scrolling container for card rows.
 * 
 * - Prevents page-level horizontal drift
 * - Allows native horizontal carousel scroll
 * - Vertical scrolling works from any position on carousel
 * - All cards respect page padding (no edge touch)
 * - Uses CSS-only approach, no custom drag handlers
 */
export default function MobileCarousel({ children, className = '' }) {
  return (
    <div className={`mobile-carousel ${className}`}>
      {children}
    </div>
  );
}