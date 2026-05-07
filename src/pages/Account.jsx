import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import {
  User, ShoppingBag, Bell, HelpCircle, Settings, ChevronRight, LogOut, BookOpen, Sparkles, Calendar, Repeat2, Gift, Shirt, Handshake, PartyPopper, ClipboardList, Zap, ImagePlus, Leaf, Truck, Crown
} from 'lucide-react';
import CreditWallet from '@/components/account/CreditWallet';
import { motion } from 'framer-motion';

// Account menu items grouped by section
const accountMenuItems = [
  { icon: ShoppingBag, label: 'Order History', path: '/account/orders', desc: 'View past and active orders' },
  { icon: Repeat2, label: 'My Subscriptions', path: '/account/subscriptions', desc: 'Pause, skip, or manage your ritual' },
];

const supportMenuItems = [
  { icon: Bell, label: 'Notifications', path: '/notifications', desc: 'Delivery updates and offers' },
  { icon: HelpCircle, label: 'Help & Support', path: '/support', desc: 'FAQ, delivery help, and contact' },
  { icon: Settings, label: 'Settings', path: '/account/settings', desc: 'Preferences and account details' },
];

const brandItems = [
  { icon: BookOpen, label: 'Our Story', path: '/our-story', desc: 'The NuVira origin & mission' },
  { icon: Sparkles, label: 'Why NuVira', path: '/why-nuvira', desc: 'Philosophy behind every bottle' },
  { icon: Calendar, label: 'Events & Community', path: '/events', desc: 'STL pop-ups, drops & more' },
  { icon: Handshake, label: 'Partner With Us', path: '/partner', desc: 'Gyms, studios, offices & more' },
  { icon: PartyPopper, label: 'Book Us for an Event', path: '/book-event', desc: 'Birthdays, showers & more' },
];

export default function Account() {
  const { user } = useAuth();
  const { data: userProfile } = useQuery({
    queryKey: ['user-profile', user?.email],
    queryFn: async () => {
      const profiles = await base44.entities.UserProfile.filter({ customer_email: user?.email });
      return profiles[0] || null;
    },
    enabled: !!user?.email,
  });

  const handleLogout = () => {
    if (user) {
      base44.auth.logout();
    } else {
      base44.auth.redirectToLogin(window.location.pathname);
    }
  };

  return (
    <div className="pb-6">
      {/* Premium Profile Header */}
      <div className="relative overflow-hidden px-5 pt-8 pb-8 mb-4" style={{ paddingTop: 'max(2rem, env(safe-area-inset-top))', background: 'linear-gradient(180deg, hsl(var(--primary) / 0.12) 0%, hsl(var(--background)) 100%)' }}>
        <div className="flex items-center gap-4">
          {/* Avatar with premium border */}
          <div className="relative">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center border-2 border-primary/30 shadow-lg">
              <User className="w-7 h-7 text-primary" />
            </div>
            {user && (
              <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-accent rounded-full border-2 border-background flex items-center justify-center">
                <Crown className="w-3 h-3 text-accent-foreground" />
              </div>
            )}
          </div>

          {/* User Info */}
          <div className="flex-1 min-w-0">
            <h1 className="font-heading text-lg font-bold text-foreground mb-0.5">
              {user?.first_name ? `${user.first_name} ${user.last_name || ''}`.trim() : 'Guest'}
            </h1>
            {user?.email && (
              <p className="text-xs text-muted-foreground truncate">{user.email}</p>
            )}
            {userProfile?.phone && (
              <p className="text-xs text-muted-foreground">{userProfile.phone}</p>
            )}
            {userProfile?.address && (
              <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{userProfile.address}</p>
            )}
          </div>
        </div>

        {/* Member status chip */}
        {user && (
          <div className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 border border-primary/20 rounded-full">
            <Crown className="w-3 h-3 text-primary" />
            <span className="text-[10px] font-semibold text-primary">NuVira Member</span>
          </div>
        )}
      </div>

      {/* NuVira Credits Card - Premium Refinement */}
      {user && <CreditWallet />}

      {/* Quick Actions - Subscribe & Refer */}
      <div className="px-5 mb-5">
        <div className="grid grid-cols-2 gap-3">
          <Link to="/subscribe">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
              className="relative overflow-hidden rounded-2xl p-4 bg-gradient-to-br from-primary/15 to-primary/10 border border-primary/20 active:scale-[0.98] transition-all shadow-sm"
            >
              <div className="w-9 h-9 rounded-xl bg-primary/20 flex items-center justify-center mb-2">
                <Repeat2 className="w-4 h-4 text-primary" />
              </div>
              <p className="text-sm font-semibold text-foreground mb-0.5">Subscribe</p>
              <p className="text-[10px] text-muted-foreground">Build your weekly ritual</p>
            </motion.div>
          </Link>

          <Link to="/referral">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08 }}
              className="relative overflow-hidden rounded-2xl p-4 bg-gradient-to-br from-accent/15 to-accent/10 border border-accent/20 active:scale-[0.98] transition-all shadow-sm"
            >
              <div className="w-9 h-9 rounded-xl bg-accent/20 flex items-center justify-center mb-2">
                <Gift className="w-4 h-4 text-accent-foreground" />
              </div>
              <p className="text-sm font-semibold text-foreground mb-0.5">Refer & Earn</p>
              <p className="text-[10px] text-muted-foreground">Give $5, get rewarded</p>
            </motion.div>
          </Link>
        </div>
      </div>

      {/* Account Section */}
      <div className="px-5 mb-5">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2.5 ml-1">Your NuVira</p>
        <div className="space-y-2">
          {accountMenuItems.map(({ icon: Icon, label, path, desc }, i) => (
            <motion.div
              key={label}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 + i * 0.04 }}
            >
              <Link to={path}>
                <div className="flex items-center gap-3.5 p-3.5 bg-card rounded-xl border border-border/40 active:bg-secondary/60 transition-all shadow-sm">
                  <div className="w-10 h-10 rounded-xl bg-primary/8 flex items-center justify-center shrink-0">
                    <Icon className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground">{label}</p>
                    <p className="text-[10px] text-muted-foreground">{desc}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground/60" />
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Support Section */}
      <div className="px-5 mb-5">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2.5 ml-1">Support</p>
        <div className="space-y-2">
          {supportMenuItems.map(({ icon: Icon, label, path, desc }, i) => (
            <motion.div
              key={label}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.22 + i * 0.04 }}
            >
              <Link to={path}>
                <div className="flex items-center gap-3.5 p-3.5 bg-card rounded-xl border border-border/40 active:bg-secondary/60 transition-all shadow-sm">
                  <div className="w-10 h-10 rounded-xl bg-primary/8 flex items-center justify-center shrink-0">
                    <Icon className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground">{label}</p>
                    <p className="text-[10px] text-muted-foreground">{desc}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground/60" />
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Brand Section */}
      <div className="px-5 mb-5">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2.5 ml-1">Brand</p>
        <div className="space-y-2">
          {brandItems.map(({ icon: Icon, label, path, desc }, i) => (
            <motion.div
              key={label}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.35 + i * 0.04 }}
            >
              <Link to={path}>
                <div className="flex items-center gap-3.5 p-3.5 bg-card rounded-xl border border-border/40 active:bg-secondary/60 transition-all shadow-sm">
                  <div className="w-10 h-10 rounded-xl bg-primary/8 flex items-center justify-center shrink-0">
                    <Icon className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground">{label}</p>
                    <p className="text-[10px] text-muted-foreground">{desc}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground/60" />
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Merch */}
      <div className="px-5 mb-5">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2.5 ml-1">Merch</p>
        <Link to="/merch">
          <motion.div
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.55 }}
            className="flex items-center justify-between p-3.5 bg-card rounded-xl border border-border/40 active:bg-secondary/60 transition-all shadow-sm"
          >
            <div className="flex items-center gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-primary/8 flex items-center justify-center shrink-0">
                <Shirt className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">NuVira Merch</p>
                <p className="text-[10px] text-muted-foreground">Gear for the wellness lifestyle</p>
              </div>
            </div>
            <span className="text-[9px] font-bold bg-muted/60 text-muted-foreground px-2.5 py-1 rounded-full">Coming Soon</span>
          </motion.div>
        </Link>
      </div>

      {/* Driver Section */}
      {(user?.role === 'driver' || user?.role === 'admin') && (
        <div className="px-5 mb-5">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2.5 ml-1">Driver</p>
          <Link to="/driver">
            <motion.div
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.6 }}
              className="flex items-center gap-3.5 p-3.5 bg-primary/5 rounded-xl border border-primary/20 active:bg-primary/10 transition-all"
            >
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <Truck className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">Driver Portal</p>
                <p className="text-[10px] text-muted-foreground">Route planner & bag returns</p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground/60" />
            </motion.div>
          </Link>
        </div>
      )}

      {/* Admin Section */}
      {user?.role === 'admin' && (
        <div className="px-5 mb-5">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2.5 ml-1">Admin</p>
          <div className="space-y-2">
            <Link to="/admin/orders">
              <motion.div
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.65 }}
                className="flex items-center gap-3.5 p-3.5 bg-primary/5 rounded-xl border border-primary/20 active:bg-primary/10 transition-all"
              >
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <ClipboardList className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">Order Management</p>
                  <p className="text-[10px] text-muted-foreground">Update order statuses</p>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground/60" />
              </motion.div>
            </Link>

            <Link to="/admin/shopify">
              <motion.div
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.68 }}
                className="flex items-center gap-3.5 p-3.5 bg-primary/5 rounded-xl border border-primary/20 active:bg-primary/10 transition-all"
              >
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <Zap className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">Shopify Integration</p>
                  <p className="text-[10px] text-muted-foreground">Orders, sync, webhooks, reports</p>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground/60" />
              </motion.div>
            </Link>

            <Link to="/admin/products">
              <motion.div
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.71 }}
                className="flex items-center gap-3.5 p-3.5 bg-primary/5 rounded-xl border border-primary/20 active:bg-primary/10 transition-all"
              >
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <ImagePlus className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">Product Images</p>
                  <p className="text-[10px] text-muted-foreground">Upload & manage product photos</p>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground/60" />
              </motion.div>
            </Link>
          </div>
        </div>
      )}

      {/* Logout Button */}
      <div className="px-5 mt-8 mb-6">
        <button
          onClick={handleLogout}
          className="w-full flex items-center justify-center gap-2.5 text-sm font-semibold py-3.5 rounded-xl border border-border/60 bg-card hover:bg-secondary/60 transition-all active:scale-[0.98]"
        >
          <LogOut className="w-4 h-4 text-muted-foreground" />
          {user ? 'Sign Out' : 'Sign In'}
        </button>
      </div>

      {/* Brand Footer */}
      <div className="text-center px-5 mt-8">
        <img
          src="https://media.base44.com/images/public/69d48d0c39891f7945481152/b04d63077_Asset18322x.png"
          alt="NuVira Juice Company"
          className="h-5 mx-auto mb-1.5 opacity-90"
        />
        <p className="text-[10px] text-muted-foreground font-medium">Real. Living. Nutrition.</p>
        <Link to="/legal" className="text-[10px] text-primary/80 hover:text-primary underline mt-1.5 inline-block transition-colors">Legal & Compliance</Link>
        <p className="text-[10px] text-muted-foreground mt-1">© {new Date().getFullYear()} NuVira Juice Company · Wentzville, MO</p>
      </div>
    </div>
  );
}