import React from 'react';
import { Link } from 'react-router-dom';
import { RotateCcw, ChevronRight } from 'lucide-react';
import { motion } from 'framer-motion';

export default function QuickReorder({ lastOrder }) {
  if (!lastOrder) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
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
        </div>
      </Link>
    </motion.div>
  );
}