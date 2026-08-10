import React, { Suspense } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { Toaster as AppToaster } from "@/components/ui/toaster"
import { Toaster as SonnerToaster } from "@/components/ui/sonner"
import { QueryClientProvider, useQuery } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate, useLocation, useNavigate } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import AppErrorBoundary from '@/components/AppErrorBoundary';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import { CartProvider } from '@/lib/cartContext';
import AppLayout from '@/components/layout/AppLayout';
import SplashScreen from '@/components/SplashScreen';
import ScrollToTop from '@/components/ScrollToTop';
import LowercaseRedirect from '@/components/LowercaseRedirect';
import SeoHeadSanitizer from '@/components/SeoHeadSanitizer';
import { base44 } from '@/api/base44Client';
import { hasBase44AuthParamsInUrl, redirectToLogin } from '@/lib/nativeAuthRedirect';
import { isAdminUser } from '@/lib/admin-access';
import {
  ensureAuthenticatedNativePushRegistration,
  installNativePushListeners,
} from '@/lib/pushNotifications';

const ProductDetail = React.lazy(() => import('@/pages/ProductDetail'));
const LocalSeoLanding = React.lazy(() => import('@/pages/LocalSeoLanding'));
const ShopifyCartPermalink = React.lazy(() => import('@/pages/ShopifyCartPermalink'));
const Checkout = React.lazy(() => import('@/pages/Checkout'));
const OrderConfirmation = React.lazy(() => import('@/pages/OrderConfirmation'));
const OrderIncomplete = React.lazy(() => import('@/pages/OrderIncomplete'));
const OrderTracker = React.lazy(() => import('@/pages/OrderTracker'));
const OrderOptions = React.lazy(() => import('@/pages/OrderOptions'));
const Account = React.lazy(() => import('@/pages/Account'));
const OrderHistory = React.lazy(() => import('@/pages/OrderHistory'));
const ProgramJourney = React.lazy(() => import('@/pages/ProgramJourney'));
const Notifications = React.lazy(() => import('@/pages/Notifications'));
const Support = React.lazy(() => import('@/pages/Support'));
const AccountSettings = React.lazy(() => import('@/pages/AccountSettings'));
const DeleteAccount = React.lazy(() => import('@/pages/DeleteAccount'));
const SubscriptionManagement = React.lazy(() => import('@/pages/SubscriptionManagement'));
const About = React.lazy(() => import('@/pages/About'));
const WhyNuVira = React.lazy(() => import('@/pages/WhyNuVira'));
const Events = React.lazy(() => import('@/pages/Events'));
const Merch = React.lazy(() => import('@/pages/Merch'));
const Subscribe = React.lazy(() => import('@/pages/Subscribe'));
const Referral = React.lazy(() => import('@/pages/Referral'));
const Rewards = React.lazy(() => import('@/pages/Rewards'));
const Legal = React.lazy(() => import('@/pages/Legal'));
const Connect = React.lazy(() => import('@/pages/Connect'));
const Contact = React.lazy(() => import('@/pages/Contact'));
const Partner = React.lazy(() => import('@/pages/Partner'));
const BookEvent = React.lazy(() => import('@/pages/BookEvent'));
const AdminOrders = React.lazy(() => import('@/pages/AdminOrders'));
const ShopifyDashboard = React.lazy(() => import('@/pages/admin/ShopifyDashboard'));
const ProductionQueueSummary = React.lazy(() => import('@/pages/admin/ProductionQueueSummary'));
const ProductionPlanning = React.lazy(() => import('@/pages/admin/ProductionPlanning'));
const Calendar = React.lazy(() => import('@/pages/admin/Calendar'));
const DeliveryQueue = React.lazy(() => import('@/pages/admin/DeliveryQueue'));
const RouteOps = React.lazy(() => import('@/pages/admin/RouteOps'));
const InventoryStatus = React.lazy(() => import('@/pages/admin/InventoryStatus'));
const OpsAlerts = React.lazy(() => import('@/pages/admin/OpsAlerts'));
const Operations = React.lazy(() => import('@/pages/admin/Operations'));
const POSOrders = React.lazy(() => import('@/pages/admin/POSOrders'));
const Resources = React.lazy(() => import('@/pages/admin/Resources'));
const ComplianceOps = React.lazy(() => import('@/pages/admin/ComplianceOps'));
const AdminProducts = React.lazy(() => import('@/pages/admin/AdminProducts'));
const DiscountCodes = React.lazy(() => import('@/pages/admin/DiscountCodes'));
const BagReturnAdmin = React.lazy(() => import('@/pages/admin/BagReturnAdmin'));
const LoyaltyMembers = React.lazy(() => import('@/pages/admin/LoyaltyMembers'));
const SyncStatus = React.lazy(() => import('@/pages/admin/SyncStatus'));
const NotificationCampaigns = React.lazy(() => import('@/pages/admin/NotificationCampaigns'));
const AdminEvents = React.lazy(() => import('@/pages/admin/AdminEvents'));
const PurchaseOrders = React.lazy(() => import('@/pages/admin/PurchaseOrders'));
const Suppliers = React.lazy(() => import('@/pages/admin/Suppliers'));
const Reporting = React.lazy(() => import('@/pages/admin/Reporting'));
const ReviewQueue = React.lazy(() => import('@/pages/admin/ReviewQueue'));
const AuditTrail = React.lazy(() => import('@/pages/admin/AuditTrail'));
const ReturnReward = React.lazy(() => import('@/pages/ReturnReward'));
const Home = React.lazy(() => import('@/pages/Home'));
const Zone3ReviewSubmitted = React.lazy(() => import('@/pages/Zone3ReviewSubmitted'));
const Shop = React.lazy(() => import('@/pages/Shop'));
const Cart = React.lazy(() => import('@/pages/Cart'));
const ProgramDetail = React.lazy(() => import('@/pages/ProgramDetail'));
const AccountSetup = React.lazy(() => import('@/pages/AccountSetup'));
const NativeLogin = React.lazy(() => import('@/pages/NativeLogin'));
const Login = React.lazy(() => import('@/pages/Login'));
const Register = React.lazy(() => import('@/pages/Register'));
const ForgotPassword = React.lazy(() => import('@/pages/ForgotPassword'));
const ResetPassword = React.lazy(() => import('@/pages/ResetPassword'));
const OAuthConsent = React.lazy(() => import('@/pages/OAuthConsent'));

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

const AdminAccessDenied = () => (
  <div className="min-h-screen flex items-center justify-center bg-background px-6">
    <div className="w-full max-w-md rounded-3xl border border-border bg-card p-6 text-center shadow-sm">
      <h1 className="font-heading text-xl font-bold text-foreground">Admin access required</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        This workspace contains customer, order, production, and delivery operations. Sign in with an authorized NuVira admin account to continue.
      </p>
      <a href="/" className="nuvira-gradient-button mt-5 inline-flex h-11 items-center justify-center rounded-2xl px-5 text-sm font-semibold">
        Return to customer app
      </a>
    </div>
  </div>
);

const AdminProtectedRoute = ({ element, user }) => (
  <ProtectedRoute
    user={user}
    element={isAdminUser(user) ? element : <AdminAccessDenied />}
  />
);

const AdminRedirect = ({ to, user }) => (
  <AdminProtectedRoute element={<Navigate to={to} replace />} user={user} />
);

function AppRouteFallback() {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-background px-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
        <p className="text-sm font-medium text-muted-foreground">Loading NuVira...</p>
      </div>
    </div>
  );
}

function BootstrapRecovery({ title, message, onRetry }) {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-background px-6" role="alert" aria-live="polite">
      <div className="w-full max-w-sm rounded-3xl border border-border bg-card p-5 text-center shadow-sm">
        <h1 className="font-heading text-xl font-bold text-foreground">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="nuvira-gradient-button mt-5 h-11 w-full rounded-2xl text-sm font-semibold"
        >
          Try Again
        </button>
      </div>
    </div>
  );
}

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
  const navigate = useNavigate();
  const [showSplash, setShowSplash] = React.useState(() => !hasSplashBeenShown());
  const hasRequestedAuthRedirectRef = React.useRef(false);

  const location = useLocation();

  React.useEffect(() => {
    let active = true;
    let removeListeners = null;

    installNativePushListeners({
      onNotificationAction: ({ route }) => navigate(route),
    }).then((remove) => {
      if (active) {
        removeListeners = remove;
      } else {
        remove();
      }
    }).catch((error) => {
      console.warn('[App] Native push listeners unavailable', error);
    });

    return () => {
      active = false;
      removeListeners?.();
    };
  }, [navigate]);

  React.useEffect(() => {
    if (!user?.email) return undefined;

    let active = true;
    let retryTimer = null;
    const reconcilePushRegistration = async (attempt = 0) => {
      const result = await ensureAuthenticatedNativePushRegistration().catch((error) => ({
        success: false,
        status: 'error',
        reason: error?.message || 'native_push_registration_failed',
      }));
      if (!active || result.success || result.status === 'unsupported' || result.status === 'denied' || result.status === 'default') return;
      if (attempt < 2) {
        retryTimer = window.setTimeout(() => reconcilePushRegistration(attempt + 1), 3000 * (attempt + 1));
      } else {
        console.warn('[App] Authenticated native push registration could not be confirmed');
      }
    };

    reconcilePushRegistration();
    return () => {
      active = false;
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [user?.email]);

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
  const isProtectedStartupRoute = /^\/(account|admin|notifications|rewards|return-reward)(\/|$)/.test(location.pathname);

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
      <div className="fixed inset-0 flex items-center justify-center bg-background px-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
          <p className="text-sm font-medium text-muted-foreground">Loading your NuVira session...</p>
        </div>
      </div>
    );
  }

  if (isProtectedStartupRoute && !user && !isResetSignInRoute && authError?.type === 'bootstrap_timeout') {
    return (
      <BootstrapRecovery
        title="Sign-in check timed out"
        message="NuVira could not confirm your session quickly enough. Retry once your connection is stable."
        onRetry={() => checkAppState()}
      />
    );
  }

  if (isProtectedStartupRoute && !user && !isResetSignInRoute && authError?.type === 'bootstrap_error') {
    return (
      <BootstrapRecovery
        title="We could not verify your session"
        message="The app stayed open safely. Try again before accessing account or admin tools."
        onRetry={() => checkAppState()}
      />
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
      <SeoHeadSanitizer />
      {showSplash && location.pathname !== '/order-options' && <SplashScreen onDone={handleSplashDone} />}
      <Suspense fallback={<AppRouteFallback />}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/shop" element={<Shop />} />
          <Route path="/shop/:id" element={<ProductDetail />} />
          <Route path="/product/:slug" element={<ProductDetail />} />
          <Route path="/products/:handle" element={<ProductDetail />} />
          <Route path="/program/:key" element={<ProgramDetail />} />
          <Route path="/cart" element={<Cart />} />
          <Route path="/cart/:cartItems" element={<ShopifyCartPermalink />} />
          <Route path="/notifications" element={<ProtectedRoute element={<Notifications />} user={user} />} />
          <Route path="/account" element={<ProtectedRoute element={<Account />} user={user} />} />
          <Route path="/account/orders" element={<ProtectedRoute element={<OrderHistory />} user={user} />} />
          <Route path="/account/programs" element={<ProtectedRoute element={<ProgramJourney />} user={user} />} />
          <Route path="/account/programs/:id" element={<ProtectedRoute element={<ProgramJourney />} user={user} />} />
          <Route path="/account/settings" element={<ProtectedRoute element={<AccountSettings />} user={user} />} />
          <Route path="/delete-account" element={<DeleteAccount />} />
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
          <Route path="/cold-pressed-juice-delivery" element={<LocalSeoLanding pageKey="cold-pressed-juice-delivery" />} />
          <Route path="/fresh-juice-delivery-st-louis" element={<LocalSeoLanding pageKey="fresh-juice-delivery-st-louis" />} />
          <Route path="/cold-pressed-juice-wentzville" element={<LocalSeoLanding pageKey="cold-pressed-juice-wentzville" />} />
          <Route path="/juice-cleanse-wentzville" element={<LocalSeoLanding pageKey="juice-cleanse-wentzville" />} />
          <Route path="/all-natural-juice-wentzville" element={<LocalSeoLanding pageKey="all-natural-juice-wentzville" />} />
          <Route path="/juice-catering-st-louis" element={<LocalSeoLanding pageKey="juice-catering-st-louis" />} />
          <Route path="/cold-pressed-juice-ofallon-mo" element={<LocalSeoLanding pageKey="cold-pressed-juice-ofallon-mo" />} />
          <Route path="/juice-delivery-st-charles-mo" element={<LocalSeoLanding pageKey="juice-delivery-st-charles-mo" />} />
          <Route path="/juice-delivery-lake-saint-louis" element={<LocalSeoLanding pageKey="juice-delivery-lake-saint-louis" />} />
          <Route path="/wellness-shots-wentzville" element={<LocalSeoLanding pageKey="wellness-shots-wentzville" />} />
          <Route path="/corporate-juice-catering-st-louis" element={<LocalSeoLanding pageKey="corporate-juice-catering-st-louis" />} />
          <Route path="/fresh-juice-for-events-st-louis" element={<LocalSeoLanding pageKey="fresh-juice-for-events-st-louis" />} />
          <Route path="/operations" element={<AdminRedirect to="/admin/operations" user={user} />} />
          <Route path="/dashboard" element={<AdminRedirect to="/admin/operations" user={user} />} />
          <Route path="/orders" element={<AdminRedirect to="/admin/orders" user={user} />} />
          <Route path="/production" element={<AdminRedirect to="/admin/production-queue" user={user} />} />
          <Route path="/production-planning" element={<AdminRedirect to="/admin/production-planning" user={user} />} />
          <Route path="/prod-scheduler" element={<AdminRedirect to="/admin/production-planning" user={user} />} />
          <Route path="/fulfillment" element={<AdminRedirect to="/admin/delivery-queue" user={user} />} />
          <Route path="/driver" element={<AdminRedirect to="/admin/delivery-queue" user={user} />} />
          <Route path="/driver/*" element={<AdminRedirect to="/admin/delivery-queue" user={user} />} />
          <Route path="/driver-portal" element={<AdminRedirect to="/admin/delivery-queue" user={user} />} />
          <Route path="/driver-portal/*" element={<AdminRedirect to="/admin/delivery-queue" user={user} />} />
          <Route path="/compliance" element={<AdminRedirect to="/admin/compliance-ops" user={user} />} />
          <Route path="/compliance-center" element={<AdminRedirect to="/admin/compliance-ops" user={user} />} />
          <Route path="/compliance-logs" element={<AdminRedirect to="/admin/compliance-ops" user={user} />} />
          <Route path="/inventory" element={<AdminRedirect to="/admin/inventory-status" user={user} />} />
          <Route path="/calendar" element={<AdminRedirect to="/admin/calendar" user={user} />} />
          <Route path="/events-admin" element={<AdminRedirect to="/admin/events" user={user} />} />
          <Route path="/purchase-orders" element={<AdminRedirect to="/admin/purchase-orders" user={user} />} />
          <Route path="/suppliers" element={<AdminRedirect to="/admin/suppliers" user={user} />} />
          <Route path="/reporting" element={<AdminRedirect to="/admin/reporting" user={user} />} />
          <Route path="/audit-logs" element={<AdminRedirect to="/admin/audit-trail" user={user} />} />
          <Route path="/order-review-queue" element={<AdminRedirect to="/admin/review-queue" user={user} />} />
          <Route path="/route-optimizer" element={<AdminRedirect to="/admin/route-ops" user={user} />} />
          <Route path="/resources" element={<AdminRedirect to="/admin/resources" user={user} />} />
          <Route path="/loyalty-admin" element={<AdminRedirect to="/admin/loyalty-members" user={user} />} />
          <Route path="/live-monitor" element={<AdminRedirect to="/admin/sync-health" user={user} />} />
          <Route path="/alerts" element={<AdminRedirect to="/admin/ops-alerts" user={user} />} />
          <Route path="/sync-health" element={<AdminRedirect to="/admin/sync-health" user={user} />} />
          <Route path="/admin/operations" element={<AdminProtectedRoute element={<Operations />} user={user} />} />
          <Route path="/admin/dashboard" element={<AdminRedirect to="/admin/operations" user={user} />} />
          <Route path="/admin/orders" element={<AdminProtectedRoute element={<AdminOrders />} user={user} />} />
          <Route path="/admin/production" element={<AdminRedirect to="/admin/production-queue" user={user} />} />
          <Route path="/admin/production-queue" element={<AdminProtectedRoute element={<ProductionQueueSummary />} user={user} />} />
          <Route path="/admin/prod-scheduler" element={<AdminRedirect to="/admin/production-planning" user={user} />} />
          <Route path="/admin/production-planning" element={<AdminProtectedRoute element={<ProductionPlanning />} user={user} />} />
          <Route path="/admin/calendar" element={<AdminProtectedRoute element={<Calendar />} user={user} />} />
          <Route path="/admin/sync-health" element={<AdminProtectedRoute element={<Navigate to="/admin/operations" replace />} user={user} />} />
          <Route path="/admin/driver" element={<AdminRedirect to="/admin/delivery-queue" user={user} />} />
          <Route path="/admin/driver/*" element={<AdminRedirect to="/admin/delivery-queue" user={user} />} />
          <Route path="/admin/driver-portal" element={<AdminRedirect to="/admin/delivery-queue" user={user} />} />
          <Route path="/admin/driver-portal/*" element={<AdminRedirect to="/admin/delivery-queue" user={user} />} />
          <Route path="/admin/fulfillment" element={<AdminRedirect to="/admin/delivery-queue" user={user} />} />
          <Route path="/admin/delivery" element={<AdminRedirect to="/admin/delivery-queue" user={user} />} />
          <Route path="/admin/delivery/*" element={<AdminRedirect to="/admin/delivery-queue" user={user} />} />
          <Route path="/admin/delivery-queue" element={<AdminProtectedRoute element={<DeliveryQueue />} user={user} />} />
          <Route path="/admin/route-ops" element={<AdminProtectedRoute element={<RouteOps />} user={user} />} />
          <Route path="/admin/route-optimizer" element={<AdminRedirect to="/admin/route-ops" user={user} />} />
          <Route path="/admin/delivery-route-reviews" element={<AdminRedirect to="/admin/route-ops" user={user} />} />
          <Route path="/admin/inventory" element={<AdminRedirect to="/admin/inventory-status" user={user} />} />
          <Route path="/admin/inventory-status" element={<AdminProtectedRoute element={<InventoryStatus />} user={user} />} />
          <Route path="/admin/purchase-orders" element={<AdminProtectedRoute element={<PurchaseOrders />} user={user} />} />
          <Route path="/admin/suppliers" element={<AdminProtectedRoute element={<Suppliers />} user={user} />} />
          <Route path="/admin/ops-alerts" element={<AdminProtectedRoute element={<OpsAlerts />} user={user} />} />
          <Route path="/admin/pos-orders" element={<AdminProtectedRoute element={<POSOrders />} user={user} />} />
          <Route path="/admin/resources" element={<AdminProtectedRoute element={<Resources />} user={user} />} />
          <Route path="/admin/compliance-ops" element={<AdminProtectedRoute element={<ComplianceOps />} user={user} />} />
          <Route path="/admin/compliance" element={<Navigate to="/admin/compliance-ops" replace />} />
          <Route path="/admin/compliance-center" element={<AdminRedirect to="/admin/compliance-ops" user={user} />} />
          <Route path="/admin/compliance-logs" element={<AdminRedirect to="/admin/compliance-ops" user={user} />} />
          <Route path="/admin/shopify" element={<AdminProtectedRoute element={<ShopifyDashboard />} user={user} />} />
          <Route path="/admin/products" element={<AdminProtectedRoute element={<AdminProducts />} user={user} />} />
          <Route path="/admin/discount-codes" element={<AdminProtectedRoute element={<DiscountCodes />} user={user} />} />
          <Route path="/admin/bag-returns" element={<AdminProtectedRoute element={<BagReturnAdmin />} user={user} />} />
          <Route path="/admin/loyalty-members" element={<AdminProtectedRoute element={<LoyaltyMembers />} user={user} />} />
          <Route path="/admin/sync-status" element={<AdminProtectedRoute element={<SyncStatus />} user={user} />} />
          <Route path="/admin/live-monitor" element={<AdminRedirect to="/admin/sync-health" user={user} />} />
          <Route path="/admin/notifications" element={<AdminProtectedRoute element={<NotificationCampaigns />} user={user} />} />
          <Route path="/admin/events" element={<AdminProtectedRoute element={<AdminEvents />} user={user} />} />
          <Route path="/admin/reporting" element={<AdminProtectedRoute element={<Reporting />} user={user} />} />
          <Route path="/admin/review-queue" element={<AdminProtectedRoute element={<ReviewQueue />} user={user} />} />
          <Route path="/admin/order-review-queue" element={<AdminRedirect to="/admin/review-queue" user={user} />} />
          <Route path="/admin/refund-reconciliation" element={<AdminRedirect to="/admin/review-queue" user={user} />} />
          <Route path="/admin/audit-trail" element={<AdminProtectedRoute element={<AuditTrail />} user={user} />} />
          <Route path="/admin/audit-logs" element={<AdminRedirect to="/admin/audit-trail" user={user} />} />
          <Route path="/return-reward" element={<ProtectedRoute element={<ReturnReward />} user={user} />} />
        </Route>
        <Route path="/checkout" element={<Checkout />} />
        <Route path="/order-confirmation" element={<OrderConfirmation />} />
        <Route path="/order-confirmation/:id" element={<OrderConfirmation />} />
        <Route path="/order-incomplete" element={<OrderIncomplete />} />
        <Route path="/order-tracker/:id" element={<OrderTracker />} />
        <Route path="/order-options" element={<OrderOptions />} />
        <Route path="/native-login" element={<NativeLogin />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/oauth-consent" element={<OAuthConsent />} />
        <Route path="/account-setup" element={<AccountSetup />} />
        <Route path="/_preview/program-journey" element={import.meta.env.DEV ? <ProgramJourney previewMode /> : <Navigate to="/" replace />} />
        <Route path="/zone3-review-submitted" element={<Zone3ReviewSubmitted />} />
        {/* Redirect old/invalid routes to correct pages */}
        <Route path="/event" element={<Navigate to="/events" replace />} />
        <Route path="/event/*" element={<Navigate to="/events" replace />} />
        <Route path="/inavii_ig_media" element={<Navigate to="/" replace />} />
        <Route path="/inavii_ig_media/*" element={<Navigate to="/" replace />} />
        <Route path="*" element={<PageNotFound />} />
      </Routes>
      </Suspense>
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
