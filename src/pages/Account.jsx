import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { base44 } from '@/api/base44Client';
import {
  User, ShoppingBag, Bell, HelpCircle, Settings, ChevronRight, LogOut, Leaf, Heart, BookOpen, Sparkles, Calendar
} from 'lucide-react';
import { motion } from 'framer-motion';

const menuItems = [
  { icon: ShoppingBag, label: 'Order History', path: '/account/orders', desc: 'View past & active orders' },
  { icon: Bell, label: 'Notifications', path: '/notifications', desc: 'Updates & promotions' },
  { icon: HelpCircle, label: 'Help & Support', path: '/support', desc: 'FAQ & contact us' },
  { icon: Settings, label: 'Settings', path: '/account/settings', desc: 'Preferences & info' },
];

const brandItems = [
  { icon: BookOpen, label: 'Our Story', path: '/our-story', desc: 'The NuVira origin & mission' },
  { icon: Sparkles, label: 'Why NuVira', path: '/why-nuvira', desc: 'Philosophy behind every bottle' },
  { icon: Calendar, label: 'Events & Community', path: '/events', desc: 'STL pop-ups, drops & more' },
];

export default function Account() {
  const { user } = useAuth();

  const handleLogout = () => {
    base44.auth.logout('/');
  };

  return (
    <div className="pb-4">
      {/* Profile Header */}
      <div className="bg-gradient-to-b from-primary/10 to-transparent px-4 pt-6 pb-6">
        <div className="flex items-center gap-3.5">
          <div className="w-14 h-14 bg-primary/15 rounded-full flex items-center justify-center">
            <User className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="font-heading text-xl font-bold">{user?.full_name || 'Guest'}</h1>
            <p className="text-xs text-muted-foreground">{user?.email}</p>
          </div>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="px-4 -mt-1 mb-4">
        <div className="flex gap-3">
          <div className="flex-1 bg-secondary/60 rounded-xl p-3 text-center">
            <Heart className="w-4 h-4 text-primary mx-auto mb-1" />
            <p className="text-xs font-medium">Loyalty</p>
            <p className="text-[10px] text-muted-foreground">Coming soon</p>
          </div>
          <div className="flex-1 bg-secondary/60 rounded-xl p-3 text-center">
            <Leaf className="w-4 h-4 text-primary mx-auto mb-1" />
            <p className="text-xs font-medium">Subscribe</p>
            <p className="text-[10px] text-muted-foreground">Coming soon</p>
          </div>
        </div>
      </div>

      {/* Menu */}
      <div className="px-4 space-y-1.5">
        {menuItems.map(({ icon: Icon, label, path, desc }, i) => (
          <motion.div
            key={label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
          >
            <Link to={path}>
              <div className="flex items-center gap-3 p-3.5 bg-card rounded-xl border border-border/50 active:bg-secondary transition-colors">
                <div className="w-9 h-9 bg-primary/8 rounded-lg flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium">{label}</p>
                  <p className="text-[10px] text-muted-foreground">{desc}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </div>
            </Link>
          </motion.div>
        ))}
      </div>

      {/* Brand Section */}
      <div className="px-4 mt-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-1">Brand</p>
        <div className="space-y-1.5">
          {brandItems.map(({ icon: Icon, label, path, desc }, i) => (
            <motion.div
              key={label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 + i * 0.05 }}
            >
              <Link to={path}>
                <div className="flex items-center gap-3 p-3.5 bg-card rounded-xl border border-border/50 active:bg-secondary transition-colors">
                  <div className="w-9 h-9 bg-primary/8 rounded-lg flex items-center justify-center shrink-0">
                    <Icon className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{label}</p>
                    <p className="text-[10px] text-muted-foreground">{desc}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Logout */}
      <div className="px-4 mt-6">
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-destructive transition-colors px-3"
        >
          <LogOut className="w-4 h-4" />
          Log out
        </button>
      </div>

      {/* Brand Footer */}
      <div className="text-center mt-8">
        <img
          src="https://media.base44.com/images/public/69d48d0c39891f7945481152/b04d63077_Asset18322x.png"
          alt="NuVira Juice Company"
          className="h-6 mx-auto mb-1"
        />
        <p className="text-[10px] text-muted-foreground">Real. Living. Nutrition.</p>
      </div>
    </div>
  );
}