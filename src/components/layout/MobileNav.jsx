import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Home, Search, ShoppingBag, User, Star, ShieldCheck, Sparkles } from 'lucide-react';
import { useCart } from '@/lib/cartContext';
import { useAuth } from '@/lib/AuthContext';
import { isAdminUser } from '@/lib/admin-access';
import { adminMobileNavItems, isAdminNavActive } from './adminNavItems';
import { motion } from 'framer-motion';
import { useActiveProgramJourney } from '@/lib/program-journey-state';

const navItems = [
  { path: '/', icon: Home, label: 'Home' },
  { path: '/shop', icon: Search, label: 'Shop' },
  { path: '/cart', icon: ShoppingBag, label: 'Cart' },
  { path: '/rewards', icon: Star, label: 'Rewards' },
  { path: '/account', icon: User, label: 'Account' },
];

const adminNavItem = { path: '/admin/operations', icon: ShieldCheck, label: 'Admin', adminOnly: true };

export default function MobileNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const { itemCount } = useCart();
  const { user } = useAuth();
  const adminMode = isAdminUser(user) && location.pathname.startsWith('/admin');
  const { journey: activeJourney } = useActiveProgramJourney(Boolean(user) && !adminMode);
  const journeyNavItem = activeJourney
    ? { path: `/account/programs/${encodeURIComponent(activeJourney.id)}`, icon: Sparkles, label: 'Journey', journey: true }
    : null;
  const customerNavItems = journeyNavItem
    ? navItems.map((item) => item.label === 'Rewards' ? journeyNavItem : item)
    : navItems;
  const visibleNavItems = adminMode ? adminMobileNavItems : (isAdminUser(user) ? [...customerNavItems, adminNavItem] : customerNavItems);

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-card/95 backdrop-blur-xl border-t border-nuvira shadow-[0_-10px_30px_rgba(6,42,32,0.08)]" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto px-2">
        {visibleNavItems.map(({ path, icon: Icon, label, journey }) => {
          const isActive = adminMode
            ? isAdminNavActive(location.pathname, { path, label })
            : location.pathname === path ||
              (path === '/shop' && location.pathname.startsWith('/shop')) ||
              (path === '/account' && location.pathname.startsWith('/account') && !location.pathname.startsWith('/account/programs')) ||
              (journey && location.pathname.startsWith('/account/programs')) ||
              (path === '/admin/operations' && location.pathname.startsWith('/admin')) ||
              (path === '/rewards' && location.pathname === '/rewards');
          const adminItem = adminMode || label === 'Admin';

          return (
            <button
              key={path}
              type="button"
              aria-label={label}
              onClick={() => {
                if (isActive) window.scrollTo({ top: 0, behavior: 'smooth' });
                else navigate(path);
              }}
              onContextMenu={(e) => e.preventDefault()}
              onDragStart={(e) => e.preventDefault()}
              draggable={false}
              className="flex flex-col items-center justify-center gap-0.5 flex-1 py-1 relative bg-transparent border-0 outline-none cursor-pointer active:scale-90 transition-transform duration-100"
              style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none', touchAction: 'manipulation' }}
            >
              <div className="relative">
                <Icon
                  className={`w-5 h-5 transition-colors ${
                    isActive
                      ? adminItem ? 'text-emerald-400' : 'text-primary'
                      : adminItem ? 'text-emerald-500' : 'text-muted-foreground'
                  }`}
                  strokeWidth={isActive ? 2.5 : 1.5}
                />
                {journey && (
                  <span aria-hidden="true" className="absolute -right-1 -top-1 h-2 w-2 rounded-full border border-card bg-amber-400" />
                )}
                {label === 'Cart' && itemCount > 0 && (
                  <span className="absolute -top-1.5 -right-2.5 bg-accent text-accent-foreground text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                    {itemCount}
                  </span>
                )}
              </div>
              <span className={`text-[10px] font-medium transition-colors ${
                isActive
                  ? adminItem ? 'text-emerald-400' : 'text-primary'
                  : adminItem ? 'text-emerald-500' : 'text-muted-foreground'
              }`}>
                {label}
              </span>
              {isActive && (
                <motion.div
                  layoutId="nav-indicator"
                  className={`absolute -top-px left-1/4 right-1/4 h-0.5 rounded-full ${adminItem ? 'bg-emerald-400' : 'bg-nuvira-gradient'}`}
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
