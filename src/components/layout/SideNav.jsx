import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Home, Search, ShoppingBag, User, Star } from 'lucide-react';
import { useCart } from '@/lib/cartContext';

const LOGO_URL = "https://media.base44.com/images/public/69d48d0c39891f7945481152/b04d63077_Asset18322x.png";

const navItems = [
  { path: '/', icon: Home, label: 'Home' },
  { path: '/shop', icon: Search, label: 'Shop' },
  { path: '/cart', icon: ShoppingBag, label: 'Cart' },
  { path: '/rewards', icon: Star, label: 'Rewards' },
  { path: '/account', icon: User, label: 'Account' },
];

export default function SideNav() {
  const location = useLocation();
  const { itemCount } = useCart();

  return (
    <aside className="hidden md:flex flex-col w-60 shrink-0 bg-card border-r border-border min-h-screen sticky top-0 h-screen">
      {/* Logo */}
      <Link to="/" className="px-6 border-b border-border block" style={{ paddingTop: 'max(1.5rem, env(safe-area-inset-top))', paddingBottom: '1.5rem' }}>
        <img src={LOGO_URL} alt="NuVira Juice Co. — Cold-Pressed Juice Delivery" className="h-8" />
        <p className="text-[10px] text-muted-foreground mt-1">Real. Living. Nutrition.</p>
      </Link>

      {/* Nav Items */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map(({ path, icon: Icon, label }) => {
          const isActive =
            location.pathname === path ||
            (path === '/shop' && location.pathname.startsWith('/shop')) ||
            (path === '/account' && location.pathname.startsWith('/account'));

          return (
            <Link
              key={path}
              to={path}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors relative ${
                isActive
                  ? 'bg-primary text-primary-foreground'
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

      {/* Footer */}
      <div className="px-6 py-4 border-t border-border space-y-1">
        <div className="flex gap-3 mb-2">
          <Link to="/our-story" className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">About Us</Link>
          <Link to="/contact" className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">Contact</Link>
          <Link to="/support" className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">FAQ</Link>
        </div>
        <p className="text-[10px] text-muted-foreground">© {new Date().getFullYear()} NuVira Juice Co.</p>
        <p className="text-[10px] text-muted-foreground">Wentzville, MO</p>
      </div>
    </aside>
  );
}