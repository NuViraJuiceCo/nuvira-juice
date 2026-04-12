import React from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import { CartProvider } from '@/lib/cartContext';
import AppLayout from '@/components/layout/AppLayout';
import SplashScreen from '@/components/SplashScreen';
import Home from '@/pages/Home';
import Shop from '@/pages/Shop';
import ProductDetail from '@/pages/ProductDetail';
import Cart from '@/pages/Cart';
import Checkout from '@/pages/Checkout';
import OrderConfirmation from '@/pages/OrderConfirmation';
import OrderTracker from '@/pages/OrderTracker';
import Account from '@/pages/Account';
import OrderHistory from '@/pages/OrderHistory';
import Notifications from '@/pages/Notifications';
import Support from '@/pages/Support';
import AccountSettings from '@/pages/AccountSettings';
import SubscriptionManagement from '@/pages/SubscriptionManagement';
import OurStory from '@/pages/OurStory';
import WhyNuVira from '@/pages/WhyNuVira';
import Events from '@/pages/Events';
import Merch from '@/pages/Merch';
import Subscribe from '@/pages/Subscribe';
import Referral from '@/pages/Referral';
import Rewards from '@/pages/Rewards';
import Legal from '@/pages/Legal';
import Connect from '@/pages/Connect';
import Partner from '@/pages/Partner';
import BookEvent from '@/pages/BookEvent';
import ScrollToTop from '@/components/ScrollToTop';

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();
  const [showSplash, setShowSplash] = React.useState(() => !sessionStorage.getItem('splashShown'));

  const handleSplashDone = () => {
    sessionStorage.setItem('splashShown', '1');
    setShowSplash(false);
  };

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
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
      // Redirect to login automatically
      navigateToLogin();
      return null;
    }
  }

  // Render the main app
  return (
    <CartProvider>
      <ScrollToTop />
      {showSplash && <SplashScreen onDone={handleSplashDone} />}
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/shop" element={<Shop />} />
          <Route path="/shop/:id" element={<ProductDetail />} />
          <Route path="/cart" element={<Cart />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/account" element={<Account />} />
          <Route path="/account/orders" element={<OrderHistory />} />
          <Route path="/account/settings" element={<AccountSettings />} />
          <Route path="/account/subscriptions" element={<SubscriptionManagement />} />
          <Route path="/support" element={<Support />} />
          <Route path="/our-story" element={<OurStory />} />
          <Route path="/why-nuvira" element={<WhyNuVira />} />
          <Route path="/events" element={<Events />} />
          <Route path="/merch" element={<Merch />} />
          <Route path="/subscribe" element={<Subscribe />} />
          <Route path="/referral" element={<Referral />} />
          <Route path="/rewards" element={<Rewards />} />
          <Route path="/legal" element={<Legal />} />
          <Route path="/connect" element={<Connect />} />
          <Route path="/partner" element={<Partner />} />
          <Route path="/book-event" element={<BookEvent />} />
        </Route>
        <Route path="/checkout" element={<Checkout />} />
        <Route path="/order-confirmation/:id" element={<OrderConfirmation />} />
        <Route path="/order-tracker/:id" element={<OrderTracker />} />
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