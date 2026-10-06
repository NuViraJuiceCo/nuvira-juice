import React, { Suspense } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import MobileNav from './MobileNav';
import SideNav from './SideNav';
import { isNativeAppRuntime } from '@/lib/nativeRuntime';
import { canRenderPublicStorefront } from '@/lib/publicStorefrontStartup';
import { startedWithAuthReturn } from '@/lib/app-params';
import PublicRouteLoading from './PublicRouteLoading';

export default function AppLayout() {
  const location = useLocation();
  const adminShell = location.pathname.startsWith('/admin');
  const publicWebsiteRoute = canRenderPublicStorefront({
    pathname: location.pathname,
    search: location.search,
    hash: location.hash,
    isNative: isNativeAppRuntime(),
    startedWithAuthReturn,
  });
  const mainClassName = adminShell
    ? 'pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-0 max-w-none mx-auto overflow-x-hidden w-full'
    : 'pb-24 md:pb-8 max-w-2xl md:max-w-none mx-auto overflow-x-hidden w-full';
  return (
    <div
      className="bg-background flex"
      data-admin-shell={adminShell ? 'true' : undefined}
      data-desktop-storefront={!adminShell && !isNativeAppRuntime() ? 'true' : undefined}
      style={{ minHeight: '100dvh' }}
    >
      {/* Sidebar — tablet & desktop */}
      <SideNav />

      {/* Main content — single natural scroll container, no overflow-hidden */}
      <div className="flex-1 min-w-0 md:ml-60 overflow-x-hidden w-full">
        <main className={mainClassName} data-storefront-page={location.pathname}>
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -3 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              style={{ willChange: 'opacity, transform' }}
              data-page-transition="true"
            >
              {publicWebsiteRoute ? (
                <Suspense fallback={<PublicRouteLoading />}>
                  <Outlet />
                </Suspense>
              ) : <Outlet />}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* Bottom nav — mobile only */}
      <MobileNav />
    </div>
  );
}
