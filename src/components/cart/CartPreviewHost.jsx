import React, { lazy, Suspense, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useCart } from '@/lib/cartContext';

const CartPreview = lazy(() => import('./CartPreview'));

export default function CartPreviewHost() {
  const { pathname, search } = useLocation();
  const { cartPreview, closeCartPreview } = useCart();
  useEffect(() => { closeCartPreview(); }, [pathname, search, closeCartPreview]);
  // Loading a saved cart must not open a dialog or fetch its presentation chunk.
  return cartPreview ? <Suspense fallback={null}><CartPreview /></Suspense> : null;
}
