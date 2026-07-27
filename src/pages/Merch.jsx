import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { useQuery } from '@tanstack/react-query';
import SEO from '@/components/SEO';
import { BRAND_IMAGES, brandImageUrl } from '@/lib/brandImages';
import { productPath } from '@/lib/seo-slugs';
import { PUBLIC_PRODUCT_FALLBACKS } from '@/lib/public-products';

const TOTE_URL = BRAND_IMAGES.toteBag;

function normalizeProductMerch(product) {
  return {
    id: product.id || product.title,
    name: product.title || product.name,
    description: product.short_description || product.description,
    sizes: product.sizes || (product.size ? [product.size] : []),
    price: Number(product.price) || 0,
    image_url: product.image_url || TOTE_URL,
    is_available: product.is_available !== false,
    path: productPath(product),
  };
}

function normalizeLegacyMerch(item) {
  return {
    id: item.id || item.name,
    name: item.name || item.title,
    description: item.description || item.short_description,
    sizes: item.sizes || (item.size ? [item.size] : []),
    price: Number(item.price) || 0,
    image_url: item.image_url || TOTE_URL,
    is_available: item.is_available !== false,
    path: item.title ? productPath(item) : null,
  };
}

export default function Merch() {
  const { user } = useAuth();
  const [email, setEmail] = useState(user?.email || '');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const { data: legacyMerchItems = [], isLoading: isLoadingLegacyMerch } = useQuery({
    queryKey: ['merch'],
    queryFn: () => base44.entities.Merch.filter({}, 'sort_order', 50),
  });

  const { data: merchProducts = [], isLoading: isLoadingMerchProducts } = useQuery({
    queryKey: ['merch-products'],
    queryFn: () => base44.entities.Product.filter({ category: 'merch', is_available: true }, 'sort_order', 50),
  });

  const merchItems = useMemo(() => {
    const normalized = [
      ...merchProducts.map(normalizeProductMerch),
      ...legacyMerchItems.map(normalizeLegacyMerch),
    ].filter(item => item.name);

    const source = normalized.length > 0
      ? normalized
      : PUBLIC_PRODUCT_FALLBACKS.filter(product => product.category === 'merch').map(normalizeProductMerch);

    return Array.from(new Map(source.map(item => [item.id || item.name, item])).values());
  }, [legacyMerchItems, merchProducts]);

  const isLoadingMerch = isLoadingLegacyMerch || isLoadingMerchProducts;

  const handleNotify = async () => {
    if (!email) return;
    setLoading(true);
    await base44.integrations.Core.SendEmail({
      to: 'nuvirajuiceco@gmail.com',
      subject: 'Merch Drop Waitlist',
      body: `${email} wants to be notified when NuVira merch drops.`,
    });
    setSubmitted(true);
    setLoading(false);
    toast.success("You're on the list! We'll notify you when merch drops.");
  };

  return (
    <div className="min-h-screen bg-background pb-8">
      <SEO
        title="NuVira Merch"
        description="Shop NuVira Juice Co. merch, including reusable totes and limited wellness lifestyle drops."
        image={brandImageUrl(TOTE_URL)}
      />
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border/40 bg-background/95 px-4 py-3 backdrop-blur md:hidden">
        <Link to="/shop">
          <button className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-muted transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
        </Link>
        <span className="font-heading text-base font-semibold">Merch</span>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-6 md:px-8 md:py-10 lg:px-12">
        <div className="mb-8 hidden md:flex">
          <Link to="/shop" className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
            Shop
          </Link>
        </div>

        {/* Hero */}
        <div className="relative overflow-hidden rounded-2xl h-64 md:h-80">
          <img src={TOTE_URL} alt="Large NuVira tote bag" className="w-full h-full object-cover object-[center_45%]" />
          <div className="absolute inset-0 bg-gradient-to-r from-black/75 via-black/35 to-black/10" />
          <div className="absolute inset-0 flex items-end p-5 md:p-10">
            <div className="max-w-xl">
              <span className="text-white/75 text-[10px] font-bold uppercase tracking-widest">Now Available</span>
              <h1 className="mt-1 font-heading text-3xl font-bold text-white md:text-5xl">NuVira Merch</h1>
              <p className="mt-2 text-sm leading-relaxed text-white/85 md:text-base">Reusable totes and limited lifestyle drops.</p>
            </div>
          </div>
        </div>

      {/* Notify CTA */}
      {!isLoadingMerch && merchItems.length === 0 && (
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="mt-6 rounded-2xl border border-border/40 bg-card p-5 md:p-6"
        >
          <div className="flex items-center gap-2 mb-3">
            <Bell className="w-4 h-4 text-primary" />
            <p className="font-semibold text-sm">Get notified at launch</p>
          </div>
          {submitted ? (
            <div className="bg-primary/10 rounded-xl py-3 px-4 text-center">
              <p className="text-primary text-sm font-semibold">You're on the list 🌿</p>
              <p className="text-xs text-muted-foreground mt-0.5">We'll hit you first when merch drops.</p>
            </div>
          ) : (
            <div className="flex gap-2">
              <Input
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="your@email.com"
                className="rounded-xl h-11 flex-1"
                type="email"
              />
              <Button
                onClick={handleNotify}
                disabled={loading || !email}
                className="h-11 shrink-0 rounded-xl bg-[linear-gradient(135deg,#b8ef5b_0%,#35c848_46%,#0fa34a_100%)] px-4 text-white shadow-sm shadow-primary/20"
              >
                {loading ? '...' : 'Notify Me'}
              </Button>
            </div>
          )}
        </motion.div>
      )}

      {/* Merch Items */}
      <div className="mt-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Shop</p>
        {isLoadingMerch ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {[1, 2].map(i => (
              <div key={i} className="aspect-[3/4] rounded-2xl bg-secondary/50 animate-pulse" />
            ))}
          </div>
        ) : merchItems.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-8">No items yet</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {merchItems.map((item, i) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 + i * 0.07 }}
                className="overflow-hidden rounded-2xl border border-border/30 bg-card"
              >
                <Link to={item.path || '/shop?filter=merch'} className="block h-full">
                  {item.image_url && (
                    <div className="aspect-square bg-secondary/50 overflow-hidden">
                      <img src={item.image_url} alt={item.name} className="w-full h-full object-cover" loading="lazy" />
                    </div>
                  )}
                  <div className="p-3">
                    <p className="font-semibold text-sm mb-0.5 line-clamp-2">{item.name}</p>
                    {item.description && (
                      <p className="text-[10px] text-muted-foreground leading-relaxed mb-2 line-clamp-2">{item.description}</p>
                    )}
                    {item.sizes && item.sizes.length > 0 && (
                      <p className="text-[10px] text-muted-foreground mb-2">Sizes: {item.sizes.join(', ')}</p>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-primary">${item.price?.toFixed(2)}</span>
                      <span className={`text-[9px] px-2 py-0.5 rounded-full font-medium ${item.is_available ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'}`}>
                        {item.is_available ? 'Available' : 'Coming Soon'}
                      </span>
                    </div>
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Brand note */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        className="mx-auto mt-8 max-w-2xl text-center"
      >
        <p className="text-xs text-muted-foreground leading-relaxed">
          NuVira merch is designed for the wellness lifestyle — minimal, intentional, and STL-rooted.
          Everything drops in limited quantities.
        </p>
      </motion.div>
      </main>
    </div>
  );
}
