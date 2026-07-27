import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import Home from '@/pages/Home';
import Shop from '@/pages/Shop';
import Cart from '@/pages/Cart';

const TAB_PATHS = ['/', '/shop', '/cart'];
import MobileNav from './MobileNav';
import SideNav from './SideNav';

function tabPanelProps(active) {
  return {
    style: { display: active ? 'block' : 'none' },
    'aria-hidden': active ? undefined : true,
    inert: active ? undefined : '',
  };
}

export default function AppLayout() {
  const location = useLocation();
  const isTabRoute = TAB_PATHS.includes(location.pathname);
  const homeActive = location.pathname === '/';
  const shopActive = location.pathname === '/shop';
  const cartActive = location.pathname === '/cart';
  const adminShell = location.pathname.startsWith('/admin');
  const mainClassName = adminShell
    ? 'pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-0 max-w-none mx-auto overflow-x-hidden w-full'
    : 'pb-24 md:pb-8 max-w-2xl md:max-w-none mx-auto overflow-x-hidden w-full';
  return (
    <div
      className="bg-background flex"
      data-admin-shell={adminShell ? 'true' : undefined}
      style={{ minHeight: '100dvh' }}
    >
      {/* Sidebar — tablet & desktop */}
      <SideNav />

      {/* Main content — single natural scroll container, no overflow-hidden */}
      <div className="flex-1 min-w-0 md:ml-60 overflow-x-hidden w-full">
        <main className={mainClassName}>
          {/* Always-mounted tab panels — display toggled to preserve scroll & state */}
          <div {...tabPanelProps(homeActive)}><Home seoActive={homeActive} /></div>
          <div {...tabPanelProps(shopActive)}><Shop seoActive={shopActive} /></div>
          <div {...tabPanelProps(cartActive)}><Cart seoActive={cartActive} /></div>

          {/* Non-tab routes — fade+lift transition (no x-axis reflow) */}
          {!isTabRoute && (
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
                <Outlet />
              </motion.div>
            </AnimatePresence>
          )}
        </main>
      </div>

      {/* Bottom nav — mobile only */}
      <MobileNav />
    </div>
  );
}
