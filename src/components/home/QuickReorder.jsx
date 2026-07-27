import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { RotateCcw, ChevronRight, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const DISMISS_KEY = 'nuvira_quick_reorder_dismissed';

export default function QuickReorder({ lastOrder }) {
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

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ delay: 0.1 }}
        className="mx-5 mt-4"
      >
        <Link to="/account/orders">
          <div className="flex items-center gap-3 bg-secondary/60 rounded-xl p-3.5 border border-border/50">
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