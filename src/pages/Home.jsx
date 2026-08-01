import React from 'react';
import SEO, { LOCAL_BUSINESS_SCHEMA } from '@/components/SEO';
import PullToRefresh from '@/components/PullToRefresh';
import BrowserAppPrompt from '@/components/BrowserAppPrompt';
import { motion } from 'framer-motion';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import HeroBanner from '@/components/home/HeroBanner';
import QuickReorder from '@/components/home/QuickReorder';
import ProductRow from '@/components/home/ProductRow';
import BrandSection from '@/components/home/BrandSection';
import NuViraHighlights from '@/components/home/NuViraHighlights';
import MerchTeaser from '@/components/home/MerchTeaser';
import SustainabilityTeaser from '@/components/home/SustainabilityTeaser';
import SubscriptionCard from '@/components/home/SubscriptionCard';
import NotificationPrompt from '@/components/home/NotificationPrompt';
import { PUBLIC_PRODUCT_FALLBACKS } from '@/lib/public-products';


import ProgramCards from '@/components/home/ProgramCards';
import DeliveryAvailabilityCard from '@/components/delivery/DeliveryAvailabilityCard';
import { Link } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { isNativeAppRuntime } from '@/lib/nativeRuntime';


const LOGO_URL = "https://media.base44.com/images/public/69d48d0c39891f7945481152/b04d63077_Asset18322x.png";

export default function Home({ seoActive = true }) {
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

  const { data: products = [] } = useQuery({
    queryKey: ['products'],
    queryFn: async () => {
      try {
        const liveProducts = await base44.entities.Product.filter({ is_available: true }, 'sort_order', 50);
        return liveProducts?.length ? liveProducts : PUBLIC_PRODUCT_FALLBACKS;
      } catch (error) {
        console.warn('[Home] Falling back to public product catalog', error);
        return PUBLIC_PRODUCT_FALLBACKS;
      }
    },
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
  const showWebsiteFooter = !isNativeAppRuntime();

  // Pull refetch handles from the queries already registered above — no duplicate registration
  const { refetch: refetchProducts } = useQuery({ queryKey: ['products'] });
  const handleRefresh = async () => {
    await refetchProducts();
  };

  return (
    <>
    <BrowserAppPrompt pageRoute="/" />
    <PullToRefresh onRefresh={handleRefresh}>
    <div className="pb-4">
      {seoActive && (
        <>
          <SEO
            title="Cold-Pressed Juice Delivery in Wentzville & St. Louis, MO"
            description="NuVira Juice Co. delivers fresh cold-pressed juices in Wentzville, O'Fallon, St. Charles, and the greater St. Louis area. Order online today — Real. Living. Nutrition."
            keywords="cold pressed juice Wentzville MO, juice delivery St. Louis, fresh juice O'Fallon, NuVira Juice Co, juice cleanse St. Charles, wellness shots Missouri, cold pressed juice delivery near me"
            structuredData={LOCAL_BUSINESS_SCHEMA}
          />
          {/* Visually hidden h1 for SEO — the logo serves as the visual brand mark */}
          <h1 className="sr-only">NuVira Juice Co. — Cold-Pressed Juice Delivery in Wentzville &amp; St. Louis, MO</h1>
        </>
      )}

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

      <HeroBanner banners={banners} heroHeadline="Build Your Routine" heroSubtext="Choose your goal. We'll handle the rest." />

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
      {showWebsiteFooter && (
        <footer className="px-5 pt-6 pb-2 border-t border-border/30 mt-4">
          <div className="grid grid-cols-2 gap-2 mb-4">
            <Link to="/cold-pressed-juice-delivery" className="rounded-lg border border-border/45 px-3 py-2 text-xs font-semibold text-foreground/80">
              Cold-Pressed Delivery
            </Link>
            <Link to="/fresh-juice-delivery-st-louis" className="rounded-lg border border-border/45 px-3 py-2 text-xs font-semibold text-foreground/80">
              St. Louis Juice Delivery
            </Link>
            <Link to="/cold-pressed-juice-wentzville" className="rounded-lg border border-border/45 px-3 py-2 text-xs font-semibold text-foreground/80">
              Wentzville Juice
            </Link>
            <Link to="/juice-catering-st-louis" className="rounded-lg border border-border/45 px-3 py-2 text-xs font-semibold text-foreground/80">
              Event Juice Catering
            </Link>
            <Link to="/cold-pressed-juice-ofallon-mo" className="rounded-lg border border-border/45 px-3 py-2 text-xs font-semibold text-foreground/80">
              O'Fallon Juice
            </Link>
            <Link to="/juice-delivery-st-charles-mo" className="rounded-lg border border-border/45 px-3 py-2 text-xs font-semibold text-foreground/80">
              St. Charles Delivery
            </Link>
            <Link to="/juice-delivery-lake-saint-louis" className="rounded-lg border border-border/45 px-3 py-2 text-xs font-semibold text-foreground/80">
              Lake Saint Louis
            </Link>
            <Link to="/wellness-shots-wentzville" className="rounded-lg border border-border/45 px-3 py-2 text-xs font-semibold text-foreground/80">
              Wellness Shots
            </Link>
          </div>
          <div className="flex flex-wrap justify-center gap-x-5 gap-y-1 mb-3">
            <Link to="/our-story" className="text-xs text-muted-foreground hover:text-foreground transition-colors">About Us</Link>
            <Link to="/contact" className="text-xs text-muted-foreground hover:text-foreground transition-colors">Contact</Link>
            <Link to="/support" className="text-xs text-muted-foreground hover:text-foreground transition-colors">FAQ</Link>
            <Link to="/legal" className="text-xs text-muted-foreground hover:text-foreground transition-colors">Legal</Link>
          </div>
          <p className="text-center text-[10px] text-muted-foreground">© {new Date().getFullYear()} NuVira Juice Co. · Wentzville, MO · <a href="mailto:info@nuvirajuice.com" className="hover:text-foreground transition-colors">info@nuvirajuice.com</a></p>
        </footer>
      )}
    </div>
    </PullToRefresh>
    </>
  );
}
