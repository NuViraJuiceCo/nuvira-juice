import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Home, Search, ShoppingBag, User, Star } from 'lucide-react';
import { useCart } from '@/lib/cartContext';
import { motion } from 'framer-motion';

const navItems = [
  { path: '/', icon: Home, label: 'Home' },
  { path: '/shop', icon: Search, label: 'Menu' },
  { path: '/cart', icon: ShoppingBag, label: 'Cart' },
  { path: '/rewards', icon: Star, label: 'Rewards' },
  { path: '/account', icon: User, label: 'Account' },
];

export default function MobileNav() {
  const location = useLocation();
  const { itemCount } = useCart();

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-card/95 backdrop-blur-xl border-t border-border" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto px-2">
        {navItems.map(({ path, icon: Icon, label }) => {
          const isActive = location.pathname === path || 
            (path === '/shop' && location.pathname.startsWith('/shop')) ||
            (path === '/account' && location.pathname.startsWith('/account')) ||
            (path === '/rewards' && location.pathname === '/rewards');

          return (
            <Link
              key={path}
              to={path}
              onClick={() => { if (isActive) window.scrollTo({ top: 0, behavior: 'smooth' }); }}
              className="flex flex-col items-center justify-center gap-0.5 flex-1 py-1 relative"
            >
              <div className="relative">
                <Icon
                  className={`w-5 h-5 transition-colors ${
                    isActive ? 'text-primary' : 'text-muted-foreground'
                  }`}
                  strokeWidth={isActive ? 2.5 : 1.5}
                />
                {label === 'Cart' && itemCount > 0 && (
                  <span className="absolute -top-1.5 -right-2.5 bg-accent text-accent-foreground text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                    {itemCount}
                  </span>
                )}
              </div>
              <span className={`text-[10px] font-medium transition-colors ${
                isActive ? 'text-primary' : 'text-muted-foreground'
              }`}>
                {label}
              </span>
              {isActive && (
                <motion.div
                  layoutId="nav-indicator"
                  className="absolute -top-px left-1/4 right-1/4 h-0.5 bg-primary rounded-full"
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}