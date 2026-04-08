import React from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import HeroBanner from '@/components/home/HeroBanner';
import QuickReorder from '@/components/home/QuickReorder';
import ProductRow from '@/components/home/ProductRow';
import DeliveryBadge from '@/components/home/DeliveryBadge';
import BrandSection from '@/components/home/BrandSection';
import MerchTeaser from '@/components/home/MerchTeaser';
import { Link } from 'react-router-dom';
import { Bell } from 'lucide-react';

const LOGO_URL = "https://media.base44.com/images/public/69d48d0c39891f7945481152/b04d63077_Asset18322x.png";

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

  const { data: banners = [] } = useQuery({
    queryKey: ['banners'],
    queryFn: () => base44.entities.Banner.filter({ is_active: true }, 'sort_order', 10),
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

  const { data: notifications = [] } = useQuery({
    queryKey: ['unread-notifications'],
    queryFn: () => base44.entities.Notification.filter(
      { customer_email: user?.email, is_read: false },
      '-created_date',
      20
    ),
    enabled: !!user?.email,
  });

  const scheduleRules = schedules[0]?.rules || [];
  const featured = products.filter(p => p.is_featured);
  const bestSellers = products.filter(p => p.is_best_seller);
  const seasonal = products.filter(p => p.is_seasonal);
  const bundles = products.filter(p => p.category === 'bundle');
  const lastOrder = orders[0];
  const unreadCount = notifications.length;

  return (
    <div className="pb-4">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-5 pb-2">
        <div>
          <img src={LOGO_URL} alt="NuVira Juice Company" className="h-8" />
          {user?.full_name && (
            <p className="text-xs text-muted-foreground mt-1">
              Hey {user.full_name.split(' ')[0]} 👋
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <DeliveryBadge scheduleRules={scheduleRules} />
          <Link to="/notifications" className="relative w-8 h-8 flex items-center justify-center rounded-full bg-muted">
            <Bell className="w-4 h-4 text-foreground" />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-accent text-accent-foreground text-[9px] font-bold rounded-full flex items-center justify-center">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </Link>
        </div>
      </div>

      <HeroBanner banners={banners} scheduleRules={scheduleRules} />
      <QuickReorder lastOrder={lastOrder} />

      <ProductRow
        title="Our Juices"
        subtitle="Cold-pressed, never compromised"
        products={featured.length > 0 ? featured : products.filter(p => p.category === 'juice')}
        linkTo="/shop"
      />

      {bestSellers.length > 0 && (
        <ProductRow
          title="Best Sellers"
          subtitle="Community favorites"
          products={bestSellers}
          linkTo="/shop?filter=best_sellers"
        />
      )}

      {bundles.length > 0 && (
        <ProductRow
          title="Bundles"
          subtitle="Save when you bundle"
          products={bundles}
          linkTo="/shop?filter=bundle"
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

      <MerchTeaser />
      <BrandSection />
    </div>
  );
}