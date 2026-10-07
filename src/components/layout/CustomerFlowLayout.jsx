import React from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import useDesktopStorefront from '@/hooks/useDesktopStorefront';
import DesktopHeader from '@/components/desktop/DesktopHeader';
import CartPreviewHost from '@/components/cart/CartPreviewHost';
import SEO from '@/components/SEO';
import '@/styles/browser-audit.css';

export default function CustomerFlowLayout() {
  const browser = useDesktopStorefront();
  const { pathname } = useLocation();
  if (!browser) return <Outlet />;
  return <div data-desktop-brand="true" data-desktop-storefront="true" className="nv-customer-flow">
    <SEO title={pathname === '/account-setup' ? 'Complete Your Account' : pathname === '/order-options' ? 'Your Order Options' : 'Your NuVira Order'} noindex />
    <DesktopHeader />
    <main className="nv-flow-main"><Outlet /></main>
    <footer className="nv-flow-footer"><Link to="/support">Contact & Support</Link><Link to="/account/orders">Your Orders</Link><Link to="/legal">Privacy & Terms</Link></footer>
    <CartPreviewHost />
  </div>;
}
