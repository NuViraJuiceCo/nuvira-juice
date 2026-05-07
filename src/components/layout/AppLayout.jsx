import React, { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import Home from '@/pages/Home';
import ProfileSetup from '@/components/onboarding/ProfileSetup';
import Shop from '@/pages/Shop';
import Cart from '@/pages/Cart';

const TAB_PATHS = ['/', '/shop', '/cart'];
import MobileNav from './MobileNav';
import OnboardingQuiz from '@/components/onboarding/OnboardingQuiz';
import SideNav from './SideNav';

export default function AppLayout() {
  const location = useLocation();
  const isTabRoute = TAB_PATHS.includes(location.pathname);
  const [profileDone, setProfileDone] = useState(false);
  const [quizDone, setQuizDone] = useState(false);
  const [showQuiz, setShowQuiz] = useState(false);
  return (
    <div className="bg-background flex" style={{ minHeight: '100dvh' }}>
      {!profileDone && <ProfileSetup onComplete={(isNew) => { setProfileDone(true); if (isNew) setShowQuiz(true); }} />}
      {profileDone && showQuiz && !quizDone && <OnboardingQuiz onComplete={() => { setQuizDone(true); setShowQuiz(false); }} />}
      {/* Sidebar — tablet & desktop */}
      <SideNav />

      {/* Main content — single natural scroll container, no overflow-hidden */}
      <div className="flex-1 min-w-0 md:ml-60">
        <main className="pb-24 md:pb-8 max-w-2xl md:max-w-none mx-auto">
          {/* Always-mounted tab panels — display toggled to preserve scroll & state */}
          <div style={{ display: location.pathname === '/' ? 'block' : 'none' }}><Home /></div>
          <div style={{ display: location.pathname === '/shop' ? 'block' : 'none' }}><Shop /></div>
          <div style={{ display: location.pathname === '/cart' ? 'block' : 'none' }}><Cart /></div>

          {/* Non-tab routes — fade+lift transition (no x-axis reflow) */}
          {!isTabRoute && (
            <AnimatePresence mode="wait">
              <motion.div
                key={location.pathname}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18, ease: [0.25, 0.1, 0.25, 1] }}
                style={{ willChange: 'opacity, transform' }}
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