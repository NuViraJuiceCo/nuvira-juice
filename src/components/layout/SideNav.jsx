import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft, Home, Search, ShoppingBag, User, Star, ShieldCheck, Sparkles } from 'lucide-react';
import { useCart } from '@/lib/cartContext';
import { useAuth } from '@/lib/AuthContext';
import { isAdminUser } from '@/lib/admin-access';
import { isNativeAppRuntime } from '@/lib/nativeRuntime';
import { adminNavGroups, isAdminNavActive } from './adminNavItems';
import { useActiveProgramJourney } from '@/lib/program-journey-state';
import { BRAND_IMAGES } from '@/lib/brandImages';

const navItems = [
  { path: '/', icon: Home, label: 'Home' },
  { path: '/shop', icon: Search, label: 'Shop' },
  { path: '/cart', icon: ShoppingBag, label: 'Cart' },
  { path: '/rewards', icon: Star, label: 'Rewards' },
  { path: '/account', icon: User, label: 'Account' },
];

const adminNavItem = { path: '/admin/operations', icon: ShieldCheck, label: 'Admin', adminOnly: true };

export default function SideNav() {
  const location = useLocation();
  const { itemCount } = useCart();
  const { user } = useAuth();
  const adminMode = isAdminUser(user) && location.pathname.startsWith('/admin');
  const { journey: activeJourney } = useActiveProgramJourney(Boolean(user) && !adminMode);
  const journeyNavItem = activeJourney
    ? { path: `/account/programs/${encodeURIComponent(activeJourney.id)}`, icon: Sparkles, label: 'My Journey', journey: true }
    : null;
  const customerNavItems = journeyNavItem ? [navItems[0], journeyNavItem, ...navItems.slice(1)] : navItems;
  const visibleNavItems = isAdminUser(user) ? [...customerNavItems, adminNavItem] : customerNavItems;
  const showWebsiteFooter = !isNativeAppRuntime();

  return (
    <aside className="hidden md:flex flex-col w-60 shrink-0 bg-card border-r border-nuvira min-h-screen fixed left-0 top-0 h-screen overflow-y-auto shadow-sm">
      {/* Logo */}
      <Link to="/" className="px-6 border-b border-border block" style={{ paddingTop: 'max(1.5rem, env(safe-area-inset-top))', paddingBottom: '1.5rem' }}>
        <img src={BRAND_IMAGES.wordmark} alt="NuVira Juice Co. — Cold-Pressed Juice Delivery" className="h-8 w-auto" width="82" height="32" />
        <p className="text-[10px] text-muted-foreground mt-1">Real. Living. Nutrition.</p>
      </Link>

      {/* Nav Items */}
      {adminMode ? (
        <nav className="flex-1 px-3 py-4 space-y-5">
          <Link
            to="/"
            className="flex items-center gap-2 rounded-xl border border-border bg-secondary/50 px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Customer app
          </Link>
          {adminNavGroups.map(group => (
            <div key={group.label} className="space-y-1">
              <p className="px-3 text-[10px] font-black uppercase tracking-wider text-muted-foreground">{group.label}</p>
              {group.items.map(({ path, icon: Icon, label }) => {
                const isActive = isAdminNavActive(location.pathname, { path, label });
                return (
                  <Link
                    key={path}
                    to={path}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${
                      isActive
                        ? 'bg-emerald-500 text-white shadow-sm shadow-emerald-950/20'
                        : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                    }`}
                  >
                    <Icon className="h-4.5 w-4.5" strokeWidth={isActive ? 2.5 : 1.8} />
                    <span>{label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
      ) : (
        <nav className="flex-1 px-3 py-4 space-y-1">
          {visibleNavItems.map(({ path, icon: Icon, label, journey }) => {
            const isActive =
              location.pathname === path ||
              (path === '/shop' && location.pathname.startsWith('/shop')) ||
              (path === '/account' && location.pathname.startsWith('/account') && !location.pathname.startsWith('/account/programs')) ||
              (journey && location.pathname.startsWith('/account/programs')) ||
              (path === '/admin/operations' && location.pathname.startsWith('/admin'));

            return (
              <Link
                key={path}
                to={path}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors relative ${
                  isActive
                    ? label === 'Admin'
                      ? 'bg-emerald-500 text-white shadow-sm shadow-emerald-950/20'
                      : 'bg-nuvira-gradient text-white shadow-sm shadow-emerald-950/15'
                    : label === 'Admin'
                      ? 'text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-950/40'
                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                }`}
              >
                <div className="relative">
                  <Icon className="w-4.5 h-4.5" strokeWidth={isActive ? 2.5 : 1.8} />
                  {label === 'Cart' && itemCount > 0 && (
                    <span className="absolute -top-1.5 -right-2 bg-accent text-accent-foreground text-[9px] font-bold w-3.5 h-3.5 rounded-full flex items-center justify-center">
                      {itemCount}
                    </span>
                  )}
                </div>
                <span className="text-sm font-medium">{label}</span>
              </Link>
            );
          })}
        </nav>
      )}

      {/* Footer */}
      {showWebsiteFooter && (
        <div className="px-6 py-4 border-t border-border space-y-1">
          <div className="flex flex-wrap gap-x-3 mb-2">
            <Link to="/about" className="inline-flex min-h-11 items-center justify-center min-w-11 text-[10px] text-muted-foreground transition-colors hover:text-foreground">About</Link>
            <Link to="/contact" className="inline-flex min-h-11 items-center justify-center min-w-11 text-[10px] text-muted-foreground transition-colors hover:text-foreground">Contact</Link>
            <Link to="/support" className="inline-flex min-h-11 items-center justify-center min-w-11 text-[10px] text-muted-foreground transition-colors hover:text-foreground">FAQ</Link>
            <Link to="/delivery" className="inline-flex min-h-11 items-center justify-center min-w-11 text-[10px] text-muted-foreground transition-colors hover:text-foreground">Delivery</Link>
            <Link to="/returns" className="inline-flex min-h-11 items-center justify-center min-w-11 text-[10px] text-muted-foreground transition-colors hover:text-foreground">Returns</Link>
          </div>
          <p className="text-[10px] text-muted-foreground">© {new Date().getFullYear()} NuVira Juice Co.</p>
          <p className="text-[10px] text-muted-foreground">Wentzville, MO</p>
        </div>
      )}
    </aside>
  );
}
