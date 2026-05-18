import React, { useRef, useLayoutEffect, useEffect } from 'react';
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
  const locationKeyRef = useRef(location.key);

  // Detect when location.key changes (more reliable than pathname for tab nav)
  useEffect(() => {
    locationKeyRef.current = location.key;
  }, [location.key]);

  // Reset carousel scroll with multiple strategies to ensure it works
  useLayoutEffect(() => {
    const el = carouselRef.current;
    if (!el) return;

    // Strategy 1: Immediate sync reset
    const resetScroll = () => {
      el.scrollLeft = 0;
      el.scrollTo({ left: 0, behavior: 'auto' });
    };

    resetScroll();

    // Strategy 2: Reset in next frame (for DOM settling)
    const raf1 = requestAnimationFrame(resetScroll);

    // Strategy 3: Reset one more frame later (for nested layouts)
    const raf2 = requestAnimationFrame(() => requestAnimationFrame(resetScroll));

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [location.key]);

  return (
    <div ref={carouselRef} className={`mobile-carousel ${className}`} data-mobile-carousel="true">
      {children}
    </div>
  );
}