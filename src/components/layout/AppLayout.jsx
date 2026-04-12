import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import Home from '@/pages/Home';
import Shop from '@/pages/Shop';
import Cart from '@/pages/Cart';

const TAB_PATHS = ['/', '/shop', '/cart'];
import MobileNav from './MobileNav';
import SideNav from './SideNav';

export default function AppLayout() {
  const location = useLocation();
  const isTabRoute = TAB_PATHS.includes(location.pathname);
  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar — tablet & desktop */}
      <SideNav />

      {/* Main content */}
      <div className="flex-1 min-w-0">
        <main className="pb-24 md:pb-8 max-w-2xl md:max-w-none mx-auto overflow-hidden">
          {/* Always-mounted tab panels — preserves scroll & state */}
          <div style={{ display: location.pathname === '/' ? 'block' : 'none' }}><Home /></div>
          <div style={{ display: location.pathname === '/shop' ? 'block' : 'none' }}><Shop /></div>
          <div style={{ display: location.pathname === '/cart' ? 'block' : 'none' }}><Cart /></div>

          {/* Non-tab routes with slide transition */}
          {!isTabRoute && (
            <AnimatePresence>
              <motion.div
                key={location.pathname}
                initial={{ x: 24, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: -24, opacity: 0 }}
                transition={{ duration: 0.2, ease: 'easeInOut' }}
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