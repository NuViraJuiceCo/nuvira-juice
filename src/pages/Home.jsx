import React from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import HeroBanner from '@/components/home/HeroBanner';
import QuickReorder from '@/components/home/QuickReorder';
import ProductRow from '@/components/home/ProductRow';
import DeliveryBadge from '@/components/home/DeliveryBadge';
import BrandSection from '@/components/home/BrandSection';
import { Leaf } from 'lucide-react';

export default function Home() {
  const { user } = useAuth();

  const { data: products = [] } = useQuery({
    queryKey: ['products'],
    queryFn: () => base44.entities.Product.filter({ is_available: true }, 'sort_order', 50),
  });

  const { data: schedules = [] } = useQuery({
    queryKey: ['delivery-schedule'],
    queryFn: () => base44.entities.DeliverySchedule.filter({ is_active: true }),
  });

  const { data: orders = [] } = useQuery({
    queryKey: ['my-orders'],
    queryFn: () => base44.entities.Order.filter(
      { customer_email: user?.email },
      '-created_date',
      5
    ),
    enabled: !!user?.email,
  });

  const scheduleRules = schedules[0]?.rules || [];
  const featured = products.filter(p => p.is_featured);
  const bestSellers = products.filter(p => p.is_best_seller);
  const seasonal = products.filter(p => p.is_seasonal);
  const bundles = products.filter(p => p.category === 'bundle');
  const lastOrder = orders[0];

  return (
    <div className="pb-4">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div>
          <div className="flex items-center gap-1.5">
            <Leaf className="w-5 h-5 text-primary" />
            <span className="font-heading text-lg font-bold text-primary">NuVira</span>
          </div>
          {user?.full_name && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Hey {user.full_name.split(' ')[0]} 👋
            </p>
          )}
        </div>
        <DeliveryBadge scheduleRules={scheduleRules} />
      </div>

      <HeroBanner scheduleRules={scheduleRules} />
      <QuickReorder lastOrder={lastOrder} />

      <ProductRow
        title="Featured"
        subtitle="Hand-picked for you"
        products={featured}
        linkTo="/shop?filter=featured"
      />

      <ProductRow
        title="Best Sellers"
        subtitle="Customer favorites"
        products={bestSellers}
        linkTo="/shop?filter=best_sellers"
      />

      {bundles.length > 0 && (
        <ProductRow
          title="Juice Bundles"
          subtitle="Save when you bundle"
          products={bundles}
          linkTo="/shop?filter=bundles"
        />
      )}

      {seasonal.length > 0 && (
        <ProductRow
          title="Seasonal Drops"
          subtitle="Limited time only"
          products={seasonal}
          linkTo="/shop?filter=seasonal"
        />
      )}

      <BrandSection />
    </div>
  );
}