import React from 'react';
import SEO, { LOCAL_BUSINESS_SCHEMA } from '@/components/SEO';
import PullToRefresh from '@/components/PullToRefresh';
import BrowserAppPrompt from '@/components/BrowserAppPrompt';
import { motion } from 'framer-motion';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import HeroBanner from '@/components/home/HeroBanner';
import { getProductionInfo } from '@/lib/deliveryUtils';
import QuickReorder from '@/components/home/QuickReorder';
import ProductRow from '@/components/home/ProductRow';
import DeliveryBadge from '@/components/home/DeliveryBadge';
import BrandSection from '@/components/home/BrandSection';
import NuViraHighlights from '@/components/home/NuViraHighlights';
import MerchTeaser from '@/components/home/MerchTeaser';
import SustainabilityTeaser from '@/components/home/SustainabilityTeaser';
import SubscriptionCard from '@/components/home/SubscriptionCard';
import NotificationPrompt from '@/components/home/NotificationPrompt';
import { isEventCheckInVisible } from '@/lib/eventCheckIn';


import ProgramCards from '@/components/home/ProgramCards';
import DeliveryAvailabilityCard from '@/components/delivery/DeliveryAvailabilityCard';
import { Link } from 'react-router-dom';
import { Bell, Gift } from 'lucide-react';


const LOGO_URL = "https://media.base44.com/images/public/69d48d0c39891f7945481152/b04d63077_Asset18322x.png";

function asList(value) {
  return Array.isArray(value) ? value : [];
}

export default function Home() {
  const { user } = useAuth();

  // Read first name from localStorage cache so it reflects immediately after settings change
  const cachedFirstName = React.useMemo(() => {
    if (!user?.email) return null;
    try {
      const saved = localStorage.getItem(`accountSettings_${user.email}`);
      return saved ? JSON.parse(saved).first || null : null;
    } catch { return null; }
  }, [user?.email]);

  const displayFirstName = cachedFirstName || user?.first_name;

  const { data: productsData = [] } = useQuery({
    queryKey: ['products'],
    queryFn: () => base44.entities.Product.filter({ is_available: true }, 'sort_order', 50),
  });

  const { data: schedulesData = [] } = useQuery({
    queryKey: ['delivery-schedule'],
    queryFn: () => base44.entities.DeliverySchedule.filter({ is_active: true }),
  });

  const { data: bannersData = [] } = useQuery({
    queryKey: ['banners'],
    queryFn: () => base44.entities.Banner.filter({ is_active: true }, 'sort_order', 10),
  });

  const { data: ordersData = [] } = useQuery({
    queryKey: ['my-orders'],
    queryFn: () => base44.entities.Order.filter(
      { customer_email: user?.email },
      '-created_date',
      5
    ),
    enabled: !!user?.email,
  });

  const { data: notificationsData = [] } = useQuery({
    queryKey: ['unread-notifications'],
    queryFn: () => base44.entities.Notification.filter(
      { customer_email: user?.email, is_read: false },
      '-created_date',
      20
    ),
    enabled: !!user?.email,
  });

  const products = asList(productsData);
  const schedules = asList(schedulesData);
  const banners = asList(bannersData);
  const orders = asList(ordersData);
  const notifications = asList(notificationsData);

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



  const featured = products.filter(p => p.is_featured);
  const bestSellers = products.filter(p => p.is_best_seller);
  const seasonal = products.filter(p => p.is_seasonal);
  const bundles = products.filter(p => p.category === 'bundle');
  const lastOrder = orders[0];
  const unreadCount = notifications.length;
  const showEventCheckIn = isEventCheckInVisible();

  // Pull refetch handles from the queries already registered above — no duplicate registration
  const { refetch: refetchProducts } = useQuery({ queryKey: ['products'] });
  const { refetch: refetchSchedules } = useQuery({ queryKey: ['delivery-schedule'] });

  const handleRefresh = async () => {
    await Promise.all([refetchProducts(), refetchSchedules()]);
  };

  return (
    <>
    <BrowserAppPrompt pageRoute="/" />
    <PullToRefresh onRefresh={handleRefresh}>
    <div className="pb-4">
      <SEO
        title="Cold-Pressed Juice Delivery in Wentzville & St. Louis, MO"
        description="NuVira Juice Co. delivers fresh cold-pressed juices in Wentzville, O'Fallon, St. Charles, and the greater St. Louis area. Order online today — Real. Living. Nutrition."
        keywords="cold pressed juice Wentzville MO, juice delivery St. Louis, fresh juice O'Fallon, NuVira Juice Co, juice cleanse St. Charles, wellness shots Missouri, cold pressed juice delivery near me"
        structuredData={LOCAL_BUSINESS_SCHEMA}
      />
      {/* Visually hidden h1 for SEO — the logo serves as the visual brand mark */}
      <h1 className="sr-only">NuVira Juice Co. — Cold-Pressed Juice Delivery in Wentzville &amp; St. Louis, MO</h1>

      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="flex items-center justify-between px-5 pb-2"
        style={{ paddingTop: 'max(1.25rem, env(safe-area-inset-top))' }}
      >
        <div>
          <img src={LOGO_URL} alt="NuVira Juice Company" className="h-8" />
          {displayFirstName && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="text-xs text-muted-foreground mt-1"
            >
              Hey {displayFirstName} 👋
            </motion.p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <DeliveryBadge scheduleRules={scheduleRules} />
          <Link to="/notifications" aria-label="View notifications" className="relative w-9 h-9 flex items-center justify-center rounded-full bg-muted shadow-sm">
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

      <HeroBanner banners={banners} scheduleRules={scheduleRules} heroHeadline="Build Your Routine" heroSubtext="Choose your goal. We'll handle the rest." />

      {showEventCheckIn && (
        <div className="mt-4 px-5">
          <Link
            to="/event/may30"
            className="flex items-center gap-3 rounded-xl border border-primary/25 bg-primary/10 p-3 text-left"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Gift className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold text-foreground">Event Check-In</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                Claim the one-time 250 point event visit bonus.
              </span>
            </span>
          </Link>
        </div>
      )}

      {/* QuickReorder — immediately after hero for returning customers */}
      <QuickReorder lastOrder={lastOrder} />

      {/* Delivery Availability — visible early, below hero */}
      <DeliveryAvailabilityCard />

      {/* Programs — Primary Revenue Section */}
      <div className="mt-10 px-5 mb-3">
        <h2 className="font-heading text-2xl font-bold mb-1">Your Wellness Plan</h2>
        <p className="text-sm text-muted-foreground">Choose your goal. We'll handle the rest.</p>
      </div>
      <div className="mt-2">
        <ProgramCards />
      </div>

      {/* NuVira Highlights — premium content section after programs */}
      <NuViraHighlights />

      {/* Subscription visibility card — premium, subtle discovery */}
      <SubscriptionCard />

      {/* Quick Options — Secondary */}
      {(featured.length > 0 || products.filter(p => p.category === 'juice').length > 0) && (
        <div className="mt-10">
          <ProductRow
            title="Quick Options"
            subtitle="Single bottles & small bundles"
            products={[
              ...products.filter(p => p.category === 'juice' && !p.is_seasonal).slice(0, 4),
            ]}
            linkTo="/shop"
          />
        </div>
      )}

      {seasonal.length > 0 && (
        <div className="mt-10">
          <ProductRow
            title="Seasonal Drops"
            subtitle="Limited time only"
            products={seasonal}
            linkTo="/shop?filter=seasonal"
          />
        </div>
      )}

      <SustainabilityTeaser />
      <BrandSection />
      <MerchTeaser />

      {/* NotificationPrompt — low-priority, after all content */}
      <div className="mt-4 mx-5">
        <NotificationPrompt />
      </div>

      {/* Site Footer — SEO & trust links */}
      <footer className="px-5 pt-6 pb-2 border-t border-border/30 mt-4">
        <div className="flex flex-wrap justify-center gap-x-5 gap-y-1 mb-3">
          <Link to="/about" className="text-xs text-muted-foreground hover:text-foreground transition-colors">About Us</Link>
          <Link to="/contact" className="text-xs text-muted-foreground hover:text-foreground transition-colors">Contact</Link>
          <Link to="/support" className="text-xs text-muted-foreground hover:text-foreground transition-colors">FAQ</Link>
          <Link to="/legal" className="text-xs text-muted-foreground hover:text-foreground transition-colors">Legal</Link>
        </div>
        <p className="text-center text-[10px] text-muted-foreground">© {new Date().getFullYear()} NuVira Juice Co. · Wentzville, MO · <a href="mailto:info@nuvirajuice.com" className="hover:text-foreground transition-colors">info@nuvirajuice.com</a></p>
      </footer>
    </div>
    </PullToRefresh>
    </>
  );
}
