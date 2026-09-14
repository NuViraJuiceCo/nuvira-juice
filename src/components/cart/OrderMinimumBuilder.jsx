import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, Plus, RefreshCw, ShoppingBag } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useCart } from '@/lib/cartContext';
import { orderMinimumGuidance } from '@/lib/orderMinimumGuidance';
import { productPath } from '@/lib/seo-slugs';
import ProductPhoto from '@/components/shop/ProductPhoto';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function OrderMinimumBuilder() {
  const { items, addItem } = useCart();
  const guidance = orderMinimumGuidance(items);
  const [category, setCategory] = useState(items.some(item => item.category === 'juice') ? 'juice'
    : items.some(item => item.category === 'shot') ? 'shot' : 'juice');
  const { data: products = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['minimum-order-products'],
    queryFn: () => base44.entities.Product.filter({ is_available: true }, 'sort_order', 100),
    enabled: guidance.visible && guidance.canBuild,
    retry: 1,
  });
  if (!guidance.visible) return null;
  const choices = products.filter(product => product.category === category && product.is_available === true
    && product.id && Number.isFinite(product.price) && product.price > 0);

  return (
    <section aria-label="Build your qualifying order" className="border-y border-border/60 py-4">
      <div role="status" aria-live="polite" aria-atomic="true">
        <div className="flex items-start gap-2">
          {guidance.meetsMinimum && <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-primary" />}
          <h2 className="text-sm font-semibold leading-5">{guidance.title}</h2>
        </div>
        {guidance.alternative && <p className="mt-1 text-xs leading-5 text-muted-foreground">{guidance.alternative}</p>}
      </div>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        {guidance.meetsMinimum ? 'Delivery-area dollar minimums still apply. Your address confirms eligibility at checkout.'
          : 'Minimum: 3 juices, 6 shots, or an equivalent mix. Earned reward items count.'}
      </p>
      <div role="progressbar" aria-label="Order count minimum" aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={Math.round(guidance.progress)} aria-valuetext={guidance.title}
        className="mt-3 h-1.5 overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full bg-primary transition-[width] duration-200 motion-reduce:transition-none" style={{ width: `${guidance.progress}%` }} />
      </div>
      {guidance.canBuild && (
        <div className="mt-4">
          <Tabs value={category} onValueChange={setCategory}>
            <TabsList aria-label="Choose drinks" className="grid h-11 w-full grid-cols-2">
              <TabsTrigger value="juice" className="h-9">Juices</TabsTrigger>
              <TabsTrigger value="shot" className="h-9">Shots</TabsTrigger>
            </TabsList>
            <TabsContent value={category}>
          {isLoading ? <p role="status" className="py-4 text-xs text-muted-foreground">Loading available drinks...</p>
            : isError ? (
              <div className="flex flex-wrap items-center justify-between gap-2 py-3">
                <p className="text-xs text-muted-foreground">Available drinks could not load.</p>
                <Button variant="outline" onClick={() => refetch()} className="min-h-11 gap-2"><RefreshCw className="h-4 w-4" />Retry</Button>
              </div>
            ) : choices.length === 0 ? <p className="py-4 text-xs text-muted-foreground">No {category === 'juice' ? 'juices' : 'shots'} available right now.</p>
              : (
                <ul className="divide-y divide-border/40">
                  {choices.map(product => (
                    <li key={product.id} className="flex items-center gap-3 py-3">
                      <Link to={productPath(product)} className="flex min-w-0 flex-1 items-center gap-3">
                        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-secondary/50">
                          <ProductPhoto product={product} thumbnail alt="" className="h-full w-full object-contain" loading="lazy"
                            fallback={<ShoppingBag className="m-4 h-6 w-6 text-muted-foreground" />} />
                        </div>
                        <div className="min-w-0">
                          <p className="break-words text-sm font-semibold">{product.title}</p>
                          <p className="text-xs leading-5 text-muted-foreground">${product.price.toFixed(2)}{product.size ? ` / ${product.size}` : ''}</p>
                        </div>
                      </Link>
                      <Button variant="outline" size="icon" className="h-11 w-11 shrink-0 rounded-lg" onClick={() => addItem(product, 1)}
                        aria-label={`Add one ${product.title} for $${product.price.toFixed(2)}`} title={`Add ${product.title}`}>
                        <Plus className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>
          </Tabs>
          <Link to="/shop" className="inline-flex min-h-11 items-center gap-2 text-xs font-semibold text-primary">
            Browse all drinks <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
          <p className="text-xs leading-5 text-muted-foreground">Delivery-area dollar minimums also apply.</p>
        </div>
      )}
    </section>
  );
}
