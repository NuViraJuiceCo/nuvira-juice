import React, { useState, useMemo } from 'react';
import SEO from '@/components/SEO';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Search, SlidersHorizontal } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { motion, AnimatePresence } from 'framer-motion';
import ProductCard from '@/components/shop/ProductCard';

const CATEGORIES = [
  { key: 'all', label: 'All' },
  { key: 'juice', label: 'Juices' },
  { key: 'bundle', label: 'Bundles' },
  { key: 'wellness_pack', label: 'Wellness' },
  { key: 'seasonal', label: 'Seasonal' },
];

export default function Shop() {
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');

  const [searchParams, setSearchParams] = useSearchParams();
  const filterParam = searchParams.get('filter');

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['products'],
    queryFn: () => base44.entities.Product.filter({ is_available: true }, 'sort_order', 100),
  });

  const filtered = useMemo(() => {
    let result = products;

    // URL filter param
    if (filterParam === 'featured') result = result.filter(p => p.is_featured);
    else if (filterParam === 'best_sellers') result = result.filter(p => p.is_best_seller);
    else if (filterParam === 'seasonal') result = result.filter(p => p.is_seasonal);
    else if (filterParam === 'bundles') result = result.filter(p => p.category === 'bundle');

    // Category filter
    if (category !== 'all') {
      result = result.filter(p => p.category === category);
    }

    // Search
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(p =>
        p.title?.toLowerCase().includes(q) ||
        p.short_description?.toLowerCase().includes(q) ||
        p.tags?.some(t => t.toLowerCase().includes(q))
      );
    }

    return result;
  }, [products, category, search, filterParam]);

  return (
    <div className="pb-4">
      <SEO
        title="Shop Cold-Pressed Juices"
        description="Browse NuVira's lineup of fresh cold-pressed juices, bundles, and wellness packs. Order online for delivery in the St. Louis, MO area."
      />
      {/* Header */}
      <div className="px-4 pt-4 pb-3">
        <h1 className="font-heading text-xl font-bold">Shop</h1>
        <p className="text-xs text-muted-foreground">Fresh cold-pressed juices & more</p>
      </div>

      {/* Search */}
      <div className="px-4 mb-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search juices, bundles..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-10 rounded-xl bg-secondary/50 border-0 text-sm"
          />
        </div>
      </div>

      {/* Categories */}
      <div className="flex gap-2 px-4 overflow-x-auto pb-3 no-scrollbar">
        {CATEGORIES.map(cat => (
          <button
            key={cat.key}
            onClick={() => { setCategory(cat.key); setSearchParams({}); }}
            className={`shrink-0 px-4 py-1.5 rounded-full text-xs font-medium transition-colors ${
              category === cat.key
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-secondary-foreground'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Product Grid */}
      <div className="px-4">
        {isLoading ? (
          <div className="grid grid-cols-2 gap-3">
            {[1,2,3,4].map(i => (
              <div key={i} className="bg-secondary/50 rounded-xl aspect-[3/4] animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-muted-foreground text-sm">No products found</p>
          </div>
        ) : (
          <motion.div layout className="grid grid-cols-2 gap-3">
            <AnimatePresence>
              {filtered.map(product => (
                <motion.div
                  key={product.id}
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                >
                  <ProductCard product={product} />
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </div>
    </div>
  );
}