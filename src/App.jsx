import React from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { Toaster as AppToaster } from "@/components/ui/toaster"
import { Toaster as SonnerToaster } from "@/components/ui/sonner"
import { QueryClientProvider, useQuery } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate, useLocation } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import AppErrorBoundary from '@/components/AppErrorBoundary';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import { CartProvider } from '@/lib/cartContext';
import AppLayout from '@/components/layout/AppLayout';
import SplashScreen from '@/components/SplashScreen';
import ProductDetail from '@/pages/ProductDetail';
import ShopifyCartPermalink from '@/pages/ShopifyCartPermalink';
import Checkout from '@/pages/Checkout';
import OrderConfirmation from '@/pages/OrderConfirmation';
import OrderIncomplete from '@/pages/OrderIncomplete';
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
import EventMay30 from '@/pages/EventMay30';
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
import ProductionQueueSummary from '@/pages/admin/ProductionQueueSummary';
import ProductionPlanning from '@/pages/admin/ProductionPlanning';
import Calendar from '@/pages/admin/Calendar';
import SyncHealth from '@/pages/admin/SyncHealth';
import DeliveryQueue from '@/pages/admin/DeliveryQueue';
import InventoryStatus from '@/pages/admin/InventoryStatus';
import OpsAlerts from '@/pages/admin/OpsAlerts';
import Operations from '@/pages/admin/Operations';
import POSOrders from '@/pages/admin/POSOrders';
import Resources from '@/pages/admin/Resources';
import ComplianceOps from '@/pages/admin/ComplianceOps';
import AdminProducts from '@/pages/admin/AdminProducts';
import EventCatalogSetup from '@/pages/admin/EventCatalogSetup';
import BagReturnAdmin from '@/pages/admin/BagReturnAdmin';
import LoyaltyMembers from '@/pages/admin/LoyaltyMembers';
import SyncStatus from '@/pages/admin/SyncStatus';
import LiveCheckoutMonitor from '@/pages/admin/LiveCheckoutMonitor';
import NotificationCampaigns from '@/pages/admin/NotificationCampaigns';
import ReturnReward from '@/pages/ReturnReward';
import ScrollToTop from '@/components/ScrollToTop';
import LowercaseRedirect from '@/components/LowercaseRedirect';
import Home from '@/pages/Home';
import Zone3ReviewSubmitted from '@/pages/Zone3ReviewSubmitted';
import Shop from '@/pages/Shop';
import Cart from '@/pages/Cart';
import ProgramDetail from '@/pages/ProgramDetail';
import AccountSetup from '@/pages/AccountSetup';
import NativeLogin from '@/pages/NativeLogin';
import { base44 } from '@/api/base44Client';
import { hasBase44AuthParamsInUrl, redirectToLogin } from '@/lib/nativeAuthRedirect';

// Protected route wrapper—redirect to login if not authenticated
const getLoginReturnRoute = () => {
  if (typeof window === 'undefined') return '/';
  return `${window.location.pathname}${window.location.search || ''}`;
};

const ProtectedRoute = ({ element, user }) => {
  const location = useLocation();

  React.useEffect(() => {
    if (!user) {
      redirectToLogin(getLoginReturnRoute()).catch((error) => {
        console.error('[ProtectedRoute] Login redirect failed', error);
      });
    }
  }, [user, location.pathname, location.search]);

  if (!user) {
    return null;
  }
  return element;
};

function hasSplashBeenShown() {
  if (typeof window === 'undefined') return false;
  try {
    return window.sessionStorage?.getItem('splashShown') === '1';
  } catch {
    // WKWebView can reject storage access during early native app bootstrap.
    // Treat the splash as already shown so storage errors cannot crash render.
    return true;
  }
}

function markSplashShown() {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage?.setItem('splashShown', '1');
  } catch {
    // Storage is only a convenience for suppressing the splash.
  }
}

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin, user, checkAppState } = useAuth();
  const [showSplash, setShowSplash] = React.useState(() => !hasSplashBeenShown());
  const hasRequestedAuthRedirectRef = React.useRef(false);

  const location = useLocation();
  const isResetSignInRoute = React.useMemo(() => {
    if (location.pathname !== '/native-login') return false;
    const params = new URLSearchParams(location.search);
    return params.get('reset_sign_in') === '1';
  }, [location.pathname, location.search]);

  React.useEffect(() => {
    if (hasBase44AuthParamsInUrl()) {
      checkAppState();
    }
  }, [location.search, checkAppState]);

  // Fetch user profile for onboarding check (must be at top level)
  const {
    data: userProfileForOnboarding,
    isLoading: isLoadingProfile,
    isError: isProfileError,
    refetch: retryProfileForOnboarding,
  } = useQuery({
    queryKey: ['user-onboarding-check', user?.email],
    queryFn: async () => {
      const profiles = await base44.entities.UserProfile.filter({ customer_email: user.email });
      return profiles[0] || null;
    },
    enabled: Boolean(user?.email && !isResetSignInRoute),
    staleTime: 0,
    gcTime: 0,
  });

  const handleSplashDone = () => {
    markSplashShown();
    setShowSplash(false);
  };

  // No auto-redirect to orders on app open — customers should always land on Home.

  const profileLookupEnabled = Boolean(user?.email && !isResetSignInRoute);
  const profileRequestPending = Boolean(profileLookupEnabled && isLoadingProfile);
  const profileRequestFailed = Boolean(profileLookupEnabled && isProfileError);
  const profileLookupFinished = Boolean(profileLookupEnabled && !isLoadingProfile && !isProfileError);
  const profileMissing = Boolean(profileLookupFinished && !userProfileForOnboarding);
  const profileLoadedAndIncomplete = Boolean(
    profileLookupFinished &&
    userProfileForOnboarding &&
    !userProfileForOnboarding.onboarding_complete
  );
  const shouldRouteToAccountSetup = Boolean(
    location.pathname !== '/account-setup' &&
    (profileMissing || profileLoadedAndIncomplete)
  );
  const shouldRouteToLogin = Boolean(authError?.type === 'auth_required' && !isResetSignInRoute);

  React.useEffect(() => {
    if (!shouldRouteToLogin) {
      hasRequestedAuthRedirectRef.current = false;
      return;
    }

    if (hasRequestedAuthRedirectRef.current) return;
    hasRequestedAuthRedirectRef.current = true;
    navigateToLogin();
  }, [navigateToLogin, shouldRouteToLogin]);

  // Show loading spinner while checking app public settings, auth, or profile
  if (isLoadingPublicSettings || (!isResetSignInRoute && isLoadingAuth) || profileRequestPending) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Handle authentication errors
  if (authError && !isResetSignInRoute) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      return null;
    }
  }

  if (profileRequestFailed) {
    return (
      <div className="fixed inset-0 flex items-center justify-center px-6" role="alert" aria-live="polite">
        <div className="w-full max-w-sm rounded-3xl border border-border bg-card p-5 text-center shadow-sm">
          <h1 className="font-heading text-xl font-bold text-foreground">We could not load your account setup yet</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Check your connection and try again. NuVira will not redirect you until your profile status is confirmed.
          </p>
          <button
            type="button"
            onClick={() => retryProfileForOnboarding()}
            className="nuvira-gradient-button mt-5 h-11 w-full rounded-2xl text-sm font-semibold"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // Route to account setup declaratively so native startup never hard-reloads during render.
  if (shouldRouteToAccountSetup) {
    return <Navigate to="/account-setup" replace />;
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
          <Route path="/products/:handle" element={<ProductDetail />} />
          <Route path="/program/:key" element={<ProgramDetail />} />
          <Route path="/cart" element={<Cart />} />
          <Route path="/cart/:cartItems" element={<ShopifyCartPermalink />} />
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
          <Route path="/event/may30" element={<ProtectedRoute element={<EventMay30 />} user={user} />} />
          <Route path="/merch" element={<Merch />} />
          <Route path="/subscribe" element={<Subscribe />} />
          <Route path="/referral" element={<Referral />} />
          <Route path="/rewards" element={<ProtectedRoute element={<Rewards />} user={user} />} />
          <Route path="/legal" element={<Legal />} />
          <Route path="/connect" element={<Connect />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/partner" element={<Partner />} />
          <Route path="/book-event" element={<BookEvent />} />
          <Route path="/admin/operations" element={<ProtectedRoute element={<Operations />} user={user} />} />
          <Route path="/admin/orders" element={<ProtectedRoute element={<AdminOrders />} user={user} />} />
          <Route path="/admin/production-queue" element={<ProtectedRoute element={<ProductionQueueSummary />} user={user} />} />
          <Route path="/admin/production-planning" element={<ProtectedRoute element={<ProductionPlanning />} user={user} />} />
          <Route path="/admin/calendar" element={<ProtectedRoute element={<Calendar />} user={user} />} />
          <Route path="/admin/sync-health" element={<ProtectedRoute element={<SyncHealth />} user={user} />} />
          <Route path="/admin/delivery-queue" element={<ProtectedRoute element={<DeliveryQueue />} user={user} />} />
          <Route path="/admin/inventory-status" element={<ProtectedRoute element={<InventoryStatus />} user={user} />} />
          <Route path="/admin/ops-alerts" element={<ProtectedRoute element={<OpsAlerts />} user={user} />} />
          <Route path="/admin/pos-orders" element={<ProtectedRoute element={<POSOrders />} user={user} />} />
          <Route path="/admin/resources" element={<ProtectedRoute element={<Resources />} user={user} />} />
          <Route path="/admin/compliance-ops" element={<ProtectedRoute element={<ComplianceOps />} user={user} />} />
          <Route path="/admin/compliance" element={<Navigate to="/admin/compliance-ops" replace />} />
          <Route path="/admin/shopify" element={<ProtectedRoute element={<ShopifyDashboard />} user={user} />} />
          <Route path="/admin/products" element={<ProtectedRoute element={<AdminProducts />} user={user} />} />
          <Route path="/admin/event-catalog-setup" element={<ProtectedRoute element={<EventCatalogSetup />} user={user} />} />
          <Route path="/admin/bag-returns" element={<ProtectedRoute element={<BagReturnAdmin />} user={user} />} />
          <Route path="/admin/loyalty-members" element={<ProtectedRoute element={<LoyaltyMembers />} user={user} />} />
          <Route path="/admin/sync-status" element={<ProtectedRoute element={<SyncStatus />} user={user} />} />
          <Route path="/admin/live-monitor" element={<ProtectedRoute element={<LiveCheckoutMonitor />} user={user} />} />
          <Route path="/admin/notifications" element={<ProtectedRoute element={<NotificationCampaigns />} user={user} />} />
          <Route path="/return-reward" element={<ProtectedRoute element={<ReturnReward />} user={user} />} />
        </Route>
        <Route path="/checkout" element={<Checkout />} />
        <Route path="/order-confirmation" element={<OrderConfirmation />} />
        <Route path="/order-confirmation/:id" element={<OrderConfirmation />} />
        <Route path="/order-incomplete" element={<OrderIncomplete />} />
        <Route path="/order-tracker/:id" element={<OrderTracker />} />
        <Route path="/native-login" element={<NativeLogin />} />
        <Route path="/account-setup" element={<AccountSetup />} />
        <Route path="/zone3-review-submitted" element={<Zone3ReviewSubmitted />} />
        {/* Redirect old/invalid routes to correct pages */}
        <Route path="/event" element={<Navigate to="/events" replace />} />
        <Route path="/event/*" element={<Navigate to="/events" replace />} />
        <Route path="/inavii_ig_media" element={<Navigate to="/" replace />} />
        <Route path="/inavii_ig_media/*" element={<Navigate to="/" replace />} />
        {/* Redirect old driver portal routes to home */}
        <Route path="/driver" element={<Navigate to="/" replace />} />
        <Route path="/driver/*" element={<Navigate to="/" replace />} />
        <Route path="*" element={<PageNotFound />} />
      </Routes>
    </CartProvider>
  );
};


function App() {

  return (
    <HelmetProvider>
    <AppErrorBoundary>
      <AuthProvider>
        <QueryClientProvider client={queryClientInstance}>
          <Router>
            <AuthenticatedApp />
          </Router>
          <AppToaster />
          <SonnerToaster position="top-center" richColors />
        </QueryClientProvider>
      </AuthProvider>
    </AppErrorBoundary>
    </HelmetProvider>
  )
}

export default App
