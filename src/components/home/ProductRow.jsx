import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { motion } from 'framer-motion';
import ProductCard from '@/components/shop/ProductCard';

export default function ProductRow({ title, subtitle, products, linkTo }) {
  if (!products || products.length === 0) return null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.5 }}
      className="mt-7"
    >
      <div className="flex items-center justify-between px-4 mb-3">
        <div>
          <h3 className="font-heading text-lg font-bold">{title}</h3>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {linkTo && (
          <Link to={linkTo} className="text-xs text-primary font-semibold flex items-center gap-0.5 bg-primary/8 px-3 py-1 rounded-full">
            See All <ChevronRight className="w-3 h-3" />
          </Link>
        )}
      </div>
      <div className="flex gap-4 overflow-x-auto px-4 pb-3 no-scrollbar snap-x snap-mandatory">
        {products.map((product, i) => (
          <motion.div
            key={product.id}
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.07, duration: 0.4 }}
            className="snap-start shrink-0 w-44"
          >
            <ProductCard product={product} compact />
          </motion.div>
        ))}
      </div>
    </motion.section>
  );
}