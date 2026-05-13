import React, { useRef, useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * MobileCarousel: Reusable horizontal scrolling container for card rows.
 * 
 * - Prevents page-level horizontal drift
 * - Allows native horizontal carousel scroll
 * - Vertical scrolling works from any position on carousel
 * - All cards respect page padding (no edge touch)
 * - Uses CSS-only approach, no custom drag handlers
 * - Auto-resets scroll position on route change for clean UX
 */
export default function MobileCarousel({ children, className = '' }) {
  const carouselRef = useRef(null);
  const location = useLocation();

  // Reset carousel scroll when user navigates to a new page
  useEffect(() => {
    if (!carouselRef.current) return;
    
    // Use requestAnimationFrame to ensure DOM is ready
    requestAnimationFrame(() => {
      if (carouselRef.current) {
        carouselRef.current.scrollLeft = 0;
      }
    });
  }, [location.pathname]);

  return (
    <div ref={carouselRef} className={`mobile-carousel ${className}`}>
      {children}
    </div>
  );
}