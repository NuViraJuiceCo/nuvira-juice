import React, { useState, useMemo, useEffect } from 'react';
import SEO from '@/components/SEO';
import PullToRefresh from '@/components/PullToRefresh';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { motion, AnimatePresence } from 'framer-motion';
import ProductCard from '@/components/shop/ProductCard';
import ProgramCards from '@/components/home/ProgramCards';
import { absoluteUrl, productPath } from '@/lib/seo-slugs';

const ALL_CATEGORIES = [
  { key: 'all', label: 'All' },
  { key: 'juice', label: 'Juices' },
  { key: 'shot', label: 'Wellness Shots' },
  { key: 'bundle', label: 'Bundles' },
  { key: 'merch', label: 'Merch' },
  { key: 'wellness_pack', label: 'Wellness' },
  { key: 'seasonal', label: 'Seasonal' },
];

export default function Shop({ seoActive = true }) {
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');

  const [searchParams, setSearchParams] = useSearchParams();
  const filterParam = searchParams.get('filter');

  // Always reset to "all" tab when navigating to the shop page
  useEffect(() => {
    setCategory('all');
    setSearch('');
  }, []);

  const { data: products = [], isLoading, refetch } = useQuery({
    queryKey: ['products'],
    queryFn: () => base44.entities.Product.filter({ is_available: true }, 'sort_order', 100),
  });

  const { data: bundles = [] } = useQuery({
    queryKey: ['bundles'],
    queryFn: () => base44.entities.SubscriptionBundle.list('sort_order', 100),
  });



  const filtered = useMemo(() => {
    let result = products;

    // URL filter param
    if (filterParam === 'featured') result = result.filter(p => p.is_featured);
    else if (filterParam === 'best_sellers') result = result.filter(p => p.is_best_seller);
    else if (filterParam === 'seasonal') result = result.filter(p => p.is_seasonal);
    else if (filterParam === 'bundles') result = result.filter(p => p.category === 'bundle');

    // Category filter
    if (category === 'seasonal') {
      result = result.filter(p => p.is_seasonal || p.category === 'seasonal');
    } else if (category !== 'all') {
      result = result.filter(p => p.category === category);
    }

    // Search
    if (search.trim()) {
      const q = search.toLowerCase();
      const wordBoundaryRegex = new RegExp(`\\b${q}`, 'i');
      result = result.filter(p => {
        // Direct product match
        const directMatch = wordBoundaryRegex.test(p.title || '') ||
          wordBoundaryRegex.test(p.short_description || '') ||
          wordBoundaryRegex.test(p.ingredients || '') ||
          p.tags?.some(t => t.toLowerCase().includes(q));
        
        if (directMatch) return true;
        
        // Check if bundle contains products matching the search
        if (p.category === 'bundle') {
          const bundle = bundles.find(b => b.id === p.id);
          if (bundle?.default_composition) {
            const containsIngredient = bundle.default_composition.some(item => {
              const product = products.find(prod => prod.id === item.product_id);
              return product && (
                wordBoundaryRegex.test(product.ingredients || '') ||
                wordBoundaryRegex.test(product.title || '')
              );
            });
            return containsIngredient;
          }
        }
        
        return false;
      });
    }

    return result;
  }, [products, category, search, filterParam]);

  const shopStructuredData = useMemo(() => ({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "name": "Shop NuVira Cold-Pressed Juices",
        "description": "Browse fresh NuVira cold-pressed juices, wellness shots, bundles, merch, and 3-day programs for Wentzville and the St. Louis area.",
        "url": absoluteUrl('/shop'),
        "isPartOf": {
          "@type": "WebSite",
          "name": "NuVira Juice Co.",
          "url": absoluteUrl('/'),
          "potentialAction": {
            "@type": "SearchAction",
            "target": `${absoluteUrl('/shop')}?q={search_term_string}`,
            "query-input": "required name=search_term_string"
          }
        }
      },
      {
        "@type": "BreadcrumbList",
        "itemListElement": [
          { "@type": "ListItem", "position": 1, "name": "Home", "item": absoluteUrl('/') },
          { "@type": "ListItem", "position": 2, "name": "Shop", "item": absoluteUrl('/shop') }
        ]
      },
      {
        "@type": "ItemList",
        "name": "NuVira products",
        "itemListElement": products.slice(0, 20).map((product, index) => ({
          "@type": "ListItem",
          "position": index + 1,
          "url": absoluteUrl(productPath(product)),
          "item": {
            "@type": "Product",
            "name": product.title,
            "image": product.image_url,
            "description": product.short_description || product.description,
            "brand": { "@type": "Brand", "name": "NuVira Juice Co." },
            "offers": {
              "@type": "Offer",
              "url": absoluteUrl(productPath(product)),
              "priceCurrency": "USD",
              "price": product.price?.toFixed(2),
              "availability": product.is_available !== false ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
              "seller": { "@type": "Organization", "name": "NuVira Juice Co." }
            }
          }
        }))
      }
    ]
  }), [products]);

  return (
    <PullToRefresh onRefresh={refetch}>
    <div className="pb-4">
      {seoActive && (
        <SEO
          title="Shop Cold-Pressed Juices"
          description="Browse NuVira's lineup of fresh cold-pressed juices, bundles, and wellness packs. Order online for delivery in the St. Louis, MO area."
          canonicalPath="/shop"
          structuredData={shopStructuredData}
        />
      )}
      {/* Header */}
      <div className="px-4 pb-3" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
        {seoActive ? (
          <h1 className="font-heading text-xl font-bold">Shop</h1>
        ) : (
          <div className="font-heading text-xl font-bold" aria-hidden="true">Shop</div>
        )}
        <p className="text-xs text-muted-foreground">Fresh cold-pressed juices & more</p>
      </div>

      {/* Search */}
      <div className="px-4 mb-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search juices, bundles, merch..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-10 rounded-xl bg-secondary/50 border-0 text-sm"
          />
        </div>
      </div>

      {/* Categories — only show tabs that have products (except "all") */}
      <div className="flex gap-2 px-4 overflow-x-auto pb-3 no-scrollbar">
        {ALL_CATEGORIES.filter(cat => {
          if (cat.key === 'all') return true;
          if (cat.key === 'seasonal') return products.some(p => p.is_seasonal || p.category === 'seasonal');
          return products.some(p => p.category === cat.key);
        }).map(cat => (
          <button
            key={cat.key}
            onClick={() => { setCategory(cat.key); setSearchParams({}); }}
            className={`shrink-0 px-4 py-1.5 rounded-full border text-xs font-semibold transition-all ${
              category === cat.key
                ? 'nuvira-filter-pill-active'
                : 'nuvira-filter-pill text-foreground/75 hover:text-foreground'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Programs — show when not searching/filtering */}
      {!search.trim() && category === 'all' && !filterParam && (
        <div className="mb-6">
          <div className="px-5 mb-3">
            <h2 className="font-heading text-base font-bold">3-Day Programs</h2>
            <p className="text-[11px] text-muted-foreground">Structured for results — 12 bottles delivered</p>
          </div>
          <ProgramCards />
          <div className="px-4 mt-5 mb-1">
            <h2 className="font-heading text-base font-bold">Quick Options</h2>
            <p className="text-[11px] text-muted-foreground">Single bottles & small orders</p>
          </div>
        </div>
      )}

      {/* Product Grid */}
      <div className="px-5">
        {isLoading ? (
          <div className="grid grid-cols-2 gap-3">
            {[1,2,3,4].map(i => (
              <div key={i} className="bg-secondary/50 rounded-xl aspect-[3/4] animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-lg font-heading font-semibold mb-1">Coming Soon</p>
            <p className="text-muted-foreground text-sm mb-5">New Drops Are On The Way</p>
            <button
              onClick={() => { setCategory('all'); setSearchParams({}); }}
              className="px-6 py-2 bg-primary text-primary-foreground rounded-full text-sm font-semibold"
            >
              Shop All Juices
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <AnimatePresence>
              {filtered.map(product => (
                <motion.div
                  key={product.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <ProductCard product={product} />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {seoActive && (
        <section className="px-5 pt-8 pb-2">
          <div className="border-t border-border/35 pt-5">
            <h2 className="font-heading text-lg font-bold">Shop by Local Need</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Fresh cold-pressed juice, 3-day programs, and event options for Wentzville and the St. Louis area.
            </p>
            <div className="grid grid-cols-2 gap-2 mt-4">
              <Link to="/cold-pressed-juice-delivery" className="rounded-lg border border-border/45 px-3 py-2 text-xs font-semibold text-foreground/80">
                Cold-Pressed Delivery
              </Link>
              <Link to="/juice-cleanse-wentzville" className="rounded-lg border border-border/45 px-3 py-2 text-xs font-semibold text-foreground/80">
                3-Day Juice Programs
              </Link>
              <Link to="/all-natural-juice-wentzville" className="rounded-lg border border-border/45 px-3 py-2 text-xs font-semibold text-foreground/80">
                All-Natural Juice
              </Link>
              <Link to="/juice-catering-st-louis" className="rounded-lg border border-border/45 px-3 py-2 text-xs font-semibold text-foreground/80">
                Juice Catering
              </Link>
              <Link to="/cold-pressed-juice-ofallon-mo" className="rounded-lg border border-border/45 px-3 py-2 text-xs font-semibold text-foreground/80">
                O'Fallon Juice
              </Link>
              <Link to="/juice-delivery-st-charles-mo" className="rounded-lg border border-border/45 px-3 py-2 text-xs font-semibold text-foreground/80">
                St. Charles Delivery
              </Link>
              <Link to="/wellness-shots-wentzville" className="rounded-lg border border-border/45 px-3 py-2 text-xs font-semibold text-foreground/80">
                Wellness Shots
              </Link>
              <Link to="/fresh-juice-for-events-st-louis" className="rounded-lg border border-border/45 px-3 py-2 text-xs font-semibold text-foreground/80">
                Event Juice
              </Link>
            </div>
          </div>
        </section>
      )}
    </div>
    </PullToRefresh>
  );
}
