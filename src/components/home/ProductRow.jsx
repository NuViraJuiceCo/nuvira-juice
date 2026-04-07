import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { motion } from 'framer-motion';
import ProductCard from '@/components/shop/ProductCard';

export default function ProductRow({ title, subtitle, products, linkTo }) {
  if (!products || products.length === 0) return null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-6"
    >
      <div className="flex items-center justify-between px-4 mb-3">
        <div>
          <h3 className="font-heading text-lg font-semibold">{title}</h3>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {linkTo && (
          <Link to={linkTo} className="text-xs text-primary font-medium flex items-center gap-0.5">
            See All <ChevronRight className="w-3 h-3" />
          </Link>
        )}
      </div>
      <div className="flex gap-3 overflow-x-auto px-4 pb-2 no-scrollbar snap-x snap-mandatory">
        {products.map((product, i) => (
          <div key={product.id} className="snap-start shrink-0 w-40">
            <ProductCard product={product} compact />
          </div>
        ))}
      </div>
    </motion.section>
  );
}