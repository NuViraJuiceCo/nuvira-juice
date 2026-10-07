import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { RotateCcw, ChevronRight, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import OrderItemThumbnail from '@/components/orders/OrderItemThumbnail';

const DISMISS_KEY = 'nuvira_quick_reorder_dismissed';

export default function QuickReorder({ lastOrder, website = false }) {
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
  });

  if (!lastOrder || dismissed) return null;

  const handleDismiss = (e) => {
    e.preventDefault();
    e.stopPropagation();
    try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch {}
    setDismissed(true);
  };

  if (website) {
    const items = lastOrder.items || [];
    const title = items.slice(0, 2).map(item => item.title).filter(Boolean).join(', ') || 'Your recent NuVira order';
    return <section className="nv-brand-last-order" aria-labelledby="nv-last-order-heading">
      <div className="nv-brand-last-order-images" aria-hidden="true">
        {items.slice(0, 2).map((item, index) => <OrderItemThumbnail key={item.cart_line_key || `${item.product_id || 'item'}-${index}`} item={item} />)}
        {!items.length && <RotateCcw size={24} />}
      </div>
      <div className="nv-brand-last-order-copy">
        <p className="nv-brand-eyebrow">Your Last Order</p>
        <h2 id="nv-last-order-heading">{title}{items.length > 2 && ` +${items.length - 2} more`}</h2>
        <p>Your favorites, ready for another look.</p>
      </div>
      <Link to="/account/orders" className="nv-brand-text-link">View Your Orders <ChevronRight size={18} aria-hidden="true" /></Link>
      <button type="button" onClick={handleDismiss} aria-label="Dismiss last order" title="Dismiss last order"><X size={17} aria-hidden="true" /></button>
    </section>;
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ delay: 0.1 }}
        className="nv-home-reorder mx-5 mt-4"
      >
        <Link to="/account/orders">
          <div className="nv-home-reorder-card flex items-center gap-3 bg-secondary/60 rounded-xl p-3.5 border border-border/50">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <RotateCcw className="w-4 h-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground">Your last order</p>
              <p className="text-sm font-medium truncate">
                {lastOrder.items?.slice(0, 2).map(i => i.title).join(', ')}
                {lastOrder.items?.length > 2 && ` +${lastOrder.items.length - 2} more`}
              </p>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
            <button
              onClick={handleDismiss}
              className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-muted active:bg-muted transition-colors shrink-0 -mr-1"
            >
              <X className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          </div>
        </Link>
      </motion.div>
    </AnimatePresence>
  );
}
