import React from 'react';
import { Outlet } from 'react-router-dom';
import MobileNav from './MobileNav';
import SideNav from './SideNav';

export default function AppLayout() {
  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar — tablet & desktop */}
      <SideNav />

      {/* Main content */}
      <div className="flex-1 min-w-0">
        <main className="pb-24 md:pb-8 max-w-2xl md:max-w-none mx-auto">
          <Outlet />
        </main>
      </div>

      {/* Bottom nav — mobile only */}
      <MobileNav />
    </div>
  );
}