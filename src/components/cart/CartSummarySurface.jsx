import React from 'react';
import { createPortal } from 'react-dom';
import { ShieldCheck } from 'lucide-react';
import useDesktopStorefront from '@/hooks/useDesktopStorefront';

export default function CartSummarySurface({ children }) {
  const desktop = useDesktopStorefront();
  if (desktop) {
    return (
      <aside className="nv-cart-summary" aria-label="Order summary">
        <div className="nv-cart-summary-heading">
          <span className="nv-cart-summary-label">Fresh From NuVira</span>
          <h2>Order Summary</h2>
        </div>
        <div className="nv-cart-summary-content">{children}</div>
        <p className="nv-cart-summary-assurance"><ShieldCheck size={18} aria-hidden="true" /> Secure checkout with Stripe</p>
      </aside>
    );
  }
  return typeof document !== 'undefined' ? createPortal(
    <div className="fixed bottom-16 md:bottom-0 left-0 md:left-60 right-0 z-40 bg-background border-t border-border/30 pt-3" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
      <div className="max-w-lg mx-auto px-5 space-y-3">{children}</div>
    </div>, document.body,
  ) : null;
}
