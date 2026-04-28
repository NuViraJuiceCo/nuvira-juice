import React from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider, useQuery } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import { CartProvider } from '@/lib/cartContext';
import AppLayout from '@/components/layout/AppLayout';
import SplashScreen from '@/components/SplashScreen';
import ProductDetail from '@/pages/ProductDetail';
import Checkout from '@/pages/Checkout';
import OrderConfirmation from '@/pages/OrderConfirmation';
import OrderTracker from '@/pages/OrderTracker';
import Account from '@/pages/Account';
import OrderHistory from '@/pages/OrderHistory';
import Notifications from '@/pages/Notifications';
import Support from '@/pages/Support';
import AccountSettings from '@/pages/AccountSettings';
import SubscriptionManagement from '@/pages/SubscriptionManagement';
import About from '@/pages/About';
import WhyNuVira from '@/pages/WhyNuVira';
import Events from '@/pages/Events';
import Merch from '@/pages/Merch';
import Subscribe from '@/pages/Subscribe';
import Referral from '@/pages/Referral';
import Rewards from '@/pages/Rewards';
import Legal from '@/pages/Legal';
import Connect from '@/pages/Connect';
import Contact from '@/pages/Contact';
import Partner from '@/pages/Partner';
import BookEvent from '@/pages/BookEvent';
import AdminOrders from '@/pages/AdminOrders';
import ShopifyDashboard from '@/pages/admin/ShopifyDashboard';
import AdminProducts from '@/pages/admin/AdminProducts';
import BagReturnAdmin from '@/pages/admin/BagReturnAdmin';
import LoyaltyMembers from '@/pages/admin/LoyaltyMembers';
import DriverPortal from '@/pages/driver/DriverPortal';
import ReturnReward from '@/pages/ReturnReward';
import ScrollToTop from '@/components/ScrollToTop';
import LowercaseRedirect from '@/components/LowercaseRedirect';
import Home from '@/pages/Home';
import Shop from '@/pages/Shop';
import Cart from '@/pages/Cart';
import ProgramDetail from '@/pages/ProgramDetail';
import AccountSetup from '@/pages/AccountSetup';
import { base44 } from '@/api/base44Client';
import { useNavigate, useLocation } from 'react-router-dom';

// Protected route wrapper—redirect to login if not authenticated
const ProtectedRoute = ({ element, user }) => {
  if (!user) {
    base44.auth.redirectToLogin(window.location.pathname);
    return null;
  }
  return element;
};

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin, user } = useAuth();
  const [showSplash, setShowSplash] = React.useState(() => !sessionStorage.getItem('splashShown'));
  const [checkingOrders, setCheckingOrders] = React.useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  // Fetch user profile for onboarding check (must be at top level)
  const { data: userProfileForOnboarding, isLoading: isLoadingProfile } = useQuery({
    queryKey: ['user-onboarding-check', user?.email],
    queryFn: async () => {
      const profiles = await base44.entities.UserProfile.filter({ customer_email: user.email });
      return profiles[0] || null;
    },
    enabled: !!user?.email,
    staleTime: 0,
    gcTime: 0,
  });

  const handleSplashDone = () => {
    sessionStorage.setItem('splashShown', '1');
    setShowSplash(false);
  };

  // Check for existing orders on first login and redirect
  React.useEffect(() => {
    if (!user?.email || location.pathname !== '/' || sessionStorage.getItem('ordersChecked')) return;

    const checkOrders = async () => {
      try {
        setCheckingOrders(true);
        const orders = await base44.entities.Order.filter(
          { customer_email: user.email },
          'created_date',
          1
        );
        if (orders.length > 0) {
          sessionStorage.setItem('ordersChecked', '1');
          navigate('/account/orders');
        } else {
          sessionStorage.setItem('ordersChecked', '1');
        }
      } catch (err) {
        console.warn('Failed to check orders:', err);
        sessionStorage.setItem('ordersChecked', '1');
      } finally {
        setCheckingOrders(false);
      }
    };

    checkOrders();
  }, [user?.email, location.pathname, navigate]);

  // Show loading spinner while checking app public settings, auth, or profile
  if (isLoadingPublicSettings || isLoadingAuth || checkingOrders || (user?.email && isLoadingProfile)) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Handle authentication errors
  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      navigateToLogin();
      return null;
    }
  }

  // Auto-redirect drivers to /driver (but not admins — they see everything)
  if (user?.role === 'driver' && !location.pathname.startsWith('/driver')) {
    window.location.replace('/driver');
    return null;
  }

  // Auto-redirect to account setup if profile is not complete (but skip if already on setup page)
  if (user?.email && !userProfileForOnboarding?.onboarding_complete && location.pathname !== '/account-setup') {
    window.location.replace('/account-setup');
    return null;
  }

  // Render the main app
  return (
    <CartProvider>
      <ScrollToTop />
      <LowercaseRedirect />
      {showSplash && <SplashScreen onDone={handleSplashDone} />}
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/shop" element={<Shop />} />
          <Route path="/shop/:id" element={<ProductDetail />} />
          <Route path="/program/:key" element={<ProgramDetail />} />
          <Route path="/cart" element={<Cart />} />
          <Route path="/notifications" element={<ProtectedRoute element={<Notifications />} user={user} />} />
          <Route path="/account" element={<ProtectedRoute element={<Account />} user={user} />} />
          <Route path="/account/orders" element={<ProtectedRoute element={<OrderHistory />} user={user} />} />
          <Route path="/account/settings" element={<ProtectedRoute element={<AccountSettings />} user={user} />} />
          <Route path="/account/subscriptions" element={<ProtectedRoute element={<SubscriptionManagement />} user={user} />} />
          <Route path="/support" element={<Support />} />
          <Route path="/our-story" element={<About />} />
          <Route path="/about" element={<About />} />
          <Route path="/why-nuvira" element={<WhyNuVira />} />
          <Route path="/events" element={<Events />} />
          <Route path="/merch" element={<Merch />} />
          <Route path="/subscribe" element={<Subscribe />} />
          <Route path="/referral" element={<Referral />} />
          <Route path="/rewards" element={<ProtectedRoute element={<Rewards />} user={user} />} />
          <Route path="/legal" element={<Legal />} />
          <Route path="/connect" element={<Connect />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/partner" element={<Partner />} />
          <Route path="/book-event" element={<BookEvent />} />
          <Route path="/admin/orders" element={<ProtectedRoute element={<AdminOrders />} user={user} />} />
          <Route path="/admin/shopify" element={<ProtectedRoute element={<ShopifyDashboard />} user={user} />} />
          <Route path="/admin/products" element={<ProtectedRoute element={<AdminProducts />} user={user} />} />
          <Route path="/admin/bag-returns" element={<ProtectedRoute element={<BagReturnAdmin />} user={user} />} />
          <Route path="/admin/loyalty-members" element={<ProtectedRoute element={<LoyaltyMembers />} user={user} />} />
          <Route path="/return-reward" element={<ProtectedRoute element={<ReturnReward />} user={user} />} />
        </Route>
        {/* Driver portal — standalone, no customer nav */}
        <Route path="/driver" element={<DriverPortal />} />
        <Route path="/driver/returns" element={<DriverPortal />} />
        <Route path="/driver/route" element={<DriverPortal />} />
        <Route path="/checkout" element={<Checkout />} />
        <Route path="/order-confirmation/:id" element={<OrderConfirmation />} />
        <Route path="/order-tracker/:id" element={<OrderTracker />} />
        <Route path="/account-setup" element={<AccountSetup />} />
        <Route path="*" element={<PageNotFound />} />
      </Routes>
    </CartProvider>
  );
};


function App() {

  return (
    <HelmetProvider>
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <AuthenticatedApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
    </HelmetProvider>
  )
}

export default App