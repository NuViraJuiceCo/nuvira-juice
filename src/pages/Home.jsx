import React from 'react';
import SEO from '@/components/SEO';
import PullToRefresh from '@/components/PullToRefresh';
import { motion } from 'framer-motion';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import HeroBanner from '@/components/home/HeroBanner';
import { getProductionInfo } from '@/lib/deliveryUtils';
import { Zap } from 'lucide-react';
import QuickReorder from '@/components/home/QuickReorder';
import ProductRow from '@/components/home/ProductRow';
import DeliveryBadge from '@/components/home/DeliveryBadge';
import BrandSection from '@/components/home/BrandSection';
import TickerBanner from '@/components/home/TickerBanner';
import MerchTeaser from '@/components/home/MerchTeaser';
import { Link } from 'react-router-dom';
import { Bell } from 'lucide-react';
import OnboardingQuiz from '@/components/onboarding/OnboardingQuiz';
import ProfileSetup from '@/components/onboarding/ProfileSetup';

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
  const productionInfo = getProductionInfo(scheduleRules);

  const { data: userProfile, refetch: refetchProfile } = useQuery({
    queryKey: ['user-profile', user?.email],
    queryFn: async () => {
      const res = await base44.entities.UserProfile.filter({ customer_email: user?.email });
      return res[0] || null;
    },
    enabled: !!user?.email,
  });

  const showOnboarding = userProfile !== undefined && !userProfile?.onboarding_complete;
  const [profileSetupDone, setProfileSetupDone] = React.useState(false);

  const featured = products.filter(p => p.is_featured);
  const bestSellers = products.filter(p => p.is_best_seller);
  const seasonal = products.filter(p => p.is_seasonal);
  const bundles = products.filter(p => p.category === 'bundle');
  const lastOrder = orders[0];
  const unreadCount = notifications.length;

  const { refetch: refetchProducts } = useQuery({ queryKey: ['products'], queryFn: () => base44.entities.Product.filter({ is_available: true }, 'sort_order', 50) });
  const { refetch: refetchSchedules } = useQuery({ queryKey: ['delivery-schedule'], queryFn: () => base44.entities.DeliverySchedule.filter({ is_active: true }) });

  const handleRefresh = async () => {
    await Promise.all([refetchProducts(), refetchSchedules()]);
  };

  return (
    <PullToRefresh onRefresh={handleRefresh}>
    <div className="pb-4">
      <SEO
        title="Home"
        description="Fresh cold-pressed juices delivered to your door in the St. Louis area. Real. Living. Nutrition. — NuVira Juice Co., Wentzville, MO."
      />
      {!profileSetupDone && user?.email && <ProfileSetup onComplete={() => setProfileSetupDone(true)} />}
      {profileSetupDone && showOnboarding && <OnboardingQuiz onComplete={() => refetchProfile()} />}
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="flex items-center justify-between px-4 pb-2"
        style={{ paddingTop: 'max(1.25rem, env(safe-area-inset-top))' }}
      >
        <div>
          <img src={LOGO_URL} alt="NuVira Juice Company" className="h-8" />
          {user?.full_name && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="text-xs text-muted-foreground mt-1"
            >
              Hey {user.full_name.split(' ')[0]} 👋
            </motion.p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <DeliveryBadge scheduleRules={scheduleRules} />
          <Link to="/notifications" className="relative w-9 h-9 flex items-center justify-center rounded-full bg-muted shadow-sm">
            <Bell className="w-4 h-4 text-foreground" />
            {unreadCount > 0 && (
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 400 }}
                className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-accent text-accent-foreground text-[9px] font-bold rounded-full flex items-center justify-center"
              >
                {unreadCount > 9 ? '9+' : unreadCount}
              </motion.span>
            )}
          </Link>
        </div>
      </motion.div>

      <TickerBanner />
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
    </PullToRefresh>
  );
}