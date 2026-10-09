import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowUpRight, Bell, Menu, ShoppingBag, UserRound } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { useCart } from '@/lib/cartContext';
import { isAdminUser } from '@/lib/admin-access';
import { BRAND_IMAGES } from '@/lib/brandImages';
import { isPublicNavigationPreloadRoute, preloadPublicNavigation } from '@/lib/startupPages';
import { isMemberNavigationPreloadRoute, preloadMemberNavigation } from '@/lib/memberNavigationPreload';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

const navigation = [
  { to: '/shop', label: 'Shop Juices', matches: path => path === '/shop' || path.startsWith('/product/') },
  { to: '/#programs', label: 'Programs', matches: path => path.startsWith('/program/') },
  { to: '/rewards', label: 'Rewards', matches: path => path === '/rewards' },
  { to: '/about', label: 'Our Story', matches: path => path === '/about' || path === '/why-nuvira' },
  { to: '/juice-catering-st-louis', label: 'Events & Catering', matches: path => path === '/juice-catering-st-louis' || path === '/events' },
];

function navigationIntent(to, isAuthenticated = false) {
  const publicRoute = isPublicNavigationPreloadRoute(to);
  if (!publicRoute && !(isAuthenticated && isMemberNavigationPreloadRoute(to))) return {};
  const preload = () => {
    if (publicRoute) void preloadPublicNavigation(to, { isNative: false, isAdmin: false });
    else void preloadMemberNavigation(to, { isNative: false, isAdmin: false, isAuthenticated });
  };
  return { onMouseEnter: preload, onFocus: preload };
}

export default function DesktopHeader() {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const { itemCount, openCartPreview } = useCart();
  return (
    <header className="nv-brand-header" data-home={pathname === '/'}>
      <div className="nv-brand-announcement">
        <div className="nv-brand-announcement-inner nv-brand-width">
          <p>Freshly pressed in Wentzville. Delivered across greater St. Louis.</p>
          <Link to="/delivery.html">Delivery Details <ArrowUpRight size={13} aria-hidden="true" /></Link>
        </div>
      </div>
      <div className="nv-brand-navigation">
        <Link to="/" {...navigationIntent('/')} aria-label="NuVira Juice Company home" className="nv-brand-logo">
          <img src={BRAND_IMAGES.wordmark} width="104" height="40" alt="NuVira Juice Company" />
        </Link>
        <nav aria-label="Main navigation">
          {navigation.map(({ to, label, matches }) => <Link key={to} to={to} {...navigationIntent(to, Boolean(user?.email))} aria-current={matches(pathname) ? 'page' : undefined}>{label}</Link>)}
        </nav>
        <div className="nv-brand-utilities">
          <DropdownMenu>
            <DropdownMenuTrigger className="nv-brand-icon nv-brand-compact-menu" aria-label="Website navigation" title="Menu"><Menu size={21} aria-hidden="true" /></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="nv-brand-account-menu">
              {navigation.map(({ to, label }) => <DropdownMenuItem asChild key={to}><Link to={to}>{label}</Link></DropdownMenuItem>)}
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild><Link to="/delivery.html">Delivery Details</Link></DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger {...navigationIntent('/account', Boolean(user?.email))} className="nv-brand-icon" aria-label={user ? 'Your account menu' : 'Account menu'} title="Account">
              <UserRound size={21} aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="nv-brand-account-menu">
              <DropdownMenuItem asChild><Link to="/account" {...navigationIntent('/account', Boolean(user?.email))}>{user ? 'My Account' : 'Sign In / Create Account'}</Link></DropdownMenuItem>
              <DropdownMenuItem asChild><Link to="/account/orders">Orders</Link></DropdownMenuItem>
              <DropdownMenuItem asChild><Link to="/account/programs">My Program</Link></DropdownMenuItem>
              <DropdownMenuItem asChild><Link to="/rewards" {...navigationIntent('/rewards', Boolean(user?.email))}>Rewards</Link></DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild><Link to="/support" {...navigationIntent('/support')}>Help & Support</Link></DropdownMenuItem>
              {isAdminUser(user) && <DropdownMenuItem asChild><Link to="/admin/operations">Admin Operations</Link></DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
          {user && <Link to="/notifications" className="nv-brand-icon" aria-label="View notifications" title="Updates"><Bell size={20} aria-hidden="true" /></Link>}
          <button type="button" onClick={event => openCartPreview('', event.currentTarget)} className="nv-brand-bag" aria-haspopup="dialog" aria-label={`View bag, ${itemCount} ${itemCount === 1 ? 'item' : 'items'}`}>
            <ShoppingBag size={21} aria-hidden="true" /><span>Bag</span><span className="nv-brand-bag-count">{itemCount}</span>
          </button>
        </div>
      </div>
    </header>
  );
}
