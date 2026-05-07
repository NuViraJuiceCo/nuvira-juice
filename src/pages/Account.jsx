import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import {
  User, ShoppingBag, Bell, HelpCircle, Settings, ChevronRight, LogOut, BookOpen, Sparkles, Calendar, Repeat2, Gift, Shirt, Handshake, PartyPopper, ClipboardList, Zap, ImagePlus, Leaf, Truck, Crown, Wallet, Star, Package
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

  // Fetch orders for snapshot stats
  const { data: orders = [] } = useQuery({
    queryKey: ['my-orders-count'],
    queryFn: () => base44.entities.Order.filter({ customer_email: user?.email }, 'created_date', 100),
    enabled: !!user?.email,
  });

  // Fetch subscriptions for snapshot stats
  const { data: subscriptions = [] } = useQuery({
    queryKey: ['my-subscriptions-count'],
    queryFn: () => base44.entities.Subscription.filter({ customer_email: user?.email }),
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
      {/* Premium Member Dashboard Header - WOW Factor */}
      <div className="relative overflow-hidden px-5 pt-10 pb-10 mb-6" style={{ 
        paddingTop: 'max(2.5rem, env(safe-area-inset-top))',
        background: `
          radial-gradient(circle at 50% 0%, hsl(var(--primary) / 0.25) 0%, transparent 70%),
          radial-gradient(circle at 80% 20%, hsl(var(--accent) / 0.08) 0%, transparent 40%),
          linear-gradient(180deg, hsl(var(--primary) / 0.15) 0%, hsl(var(--background)) 100%)
        `
      }}>
        {/* Decorative gold accent line */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-24 h-0.5 bg-gradient-to-r from-transparent via-accent/40 to-transparent rounded-full" />
        
        {/* Main dashboard card */}
        <div className="relative bg-card/60 backdrop-blur-sm rounded-3xl border border-primary/20 p-5 shadow-xl" style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.02) 100%)' }}>
          <div className="flex items-center gap-4 mb-4">
            {/* Avatar with premium treatment */}
            <div className="relative">
              <div className="w-18 h-18 rounded-full bg-gradient-to-br from-primary/30 via-primary/15 to-accent/20 flex items-center justify-center border-2 border-accent/30 shadow-2xl">
                <User className="w-8 h-8 text-primary" />
              </div>
              {user && (
                <div className="absolute -bottom-1.5 -right-1.5 w-6 h-6 bg-gradient-to-br from-accent to-accent/80 rounded-full border-2 border-card flex items-center justify-center shadow-lg">
                  <Crown className="w-3.5 h-3.5 text-accent-foreground" />
                </div>
              )}
            </div>

            {/* User Info */}
            <div className="flex-1 min-w-0">
              <h1 className="font-heading text-xl font-bold text-foreground mb-1">
                {user?.first_name ? `Welcome, ${user.first_name}` : 'Welcome'}
              </h1>
              <div className="flex flex-wrap gap-2 mb-2">
                {user && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-accent/15 border border-accent/25 rounded-full">
                    <Crown className="w-3 h-3 text-accent" />
                    <span className="text-[9px] font-bold text-accent-foreground uppercase tracking-wide">Member</span>
                  </span>
                )}
                {subscriptions.length > 0 && subscriptions.some(s => s.status === 'active') && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-primary/15 border border-primary/25 rounded-full">
                    <Star className="w-3 h-3 text-primary" />
                    <span className="text-[9px] font-bold text-primary uppercase tracking-wide">Active Ritual</span>
                  </span>
                )}
              </div>
              {user?.email && (
                <p className="text-xs text-muted-foreground truncate">{user.email}</p>
              )}
            </div>
          </div>

          {/* Compact metadata rows */}
          <div className="space-y-2 pt-3 border-t border-border/40">
            {userProfile?.phone && (
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-primary/8 flex items-center justify-center shrink-0">
                  <svg className="w-3.5 h-3.5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                  </svg>
                </div>
                <p className="text-xs text-foreground/80">{userProfile.phone}</p>
              </div>
            )}
            {userProfile?.address && (
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-primary/8 flex items-center justify-center shrink-0">
                  <svg className="w-3.5 h-3.5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
                <p className="text-xs text-foreground/80 line-clamp-1">{userProfile.address}</p>
              </div>
            )}
          </div>
        </div>

        {/* Account Snapshot Stats */}
        {user && (
          <motion.div 
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="grid grid-cols-3 gap-2 mt-4"
          >
            <div className="bg-card/50 backdrop-blur-sm rounded-xl border border-border/30 p-3 text-center">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <Package className="w-3.5 h-3.5 text-primary" />
                <p className="text-[9px] font-semibold text-muted-foreground uppercase">Orders</p>
              </div>
              <p className="font-heading text-lg font-bold text-foreground">{orders.length}</p>
            </div>
            <div className="bg-card/50 backdrop-blur-sm rounded-xl border border-border/30 p-3 text-center">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <Repeat2 className="w-3.5 h-3.5 text-accent" />
                <p className="text-[9px] font-semibold text-muted-foreground uppercase">Ritual</p>
              </div>
              <p className="font-heading text-lg font-bold text-foreground">{subscriptions.filter(s => s.status === 'active').length > 0 ? 'Active' : 'None'}</p>
            </div>
            <div className="bg-card/50 backdrop-blur-sm rounded-xl border border-border/30 p-3 text-center">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <Wallet className="w-3.5 h-3.5 text-primary" />
                <p className="text-[9px] font-semibold text-muted-foreground uppercase">Credits</p>
              </div>
              <p className="font-heading text-lg font-bold text-foreground">View</p>
            </div>
          </motion.div>
        )}
      </div>

      {/* NuVira Wallet / Credits Card - Elevated Design */}
      {user && <CreditWallet />}

      {/* Premium Quick Actions - Ritual & Referral */}
      <div className="px-5 mb-6">
        <div className="grid grid-cols-2 gap-3">
          <Link to="/account/subscriptions">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.15 }}
              className="group relative overflow-hidden rounded-2xl p-4 bg-gradient-to-br from-primary/20 via-primary/15 to-primary/10 border border-primary/30 active:scale-[0.97] transition-all shadow-md hover:shadow-lg"
            >
              {/* Subtle glow effect */}
              <div className="absolute inset-0 bg-gradient-to-br from-primary/0 to-primary/10 opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/30 to-primary/20 flex items-center justify-center mb-2.5 border border-primary/20">
                  <Repeat2 className="w-5 h-5 text-primary" />
                </div>
                <p className="text-sm font-bold text-foreground mb-0.5">Weekly Ritual</p>
                <p className="text-[10px] text-muted-foreground leading-snug">Pause, skip, or subscribe</p>
                <span className="inline-block mt-2 text-[9px] font-bold text-primary bg-primary/15 px-2 py-0.5 rounded-full">Flexible</span>
              </div>
            </motion.div>
          </Link>

          <Link to="/referral">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.18 }}
              className="group relative overflow-hidden rounded-2xl p-4 bg-gradient-to-br from-accent/20 via-accent/15 to-accent/10 border border-accent/30 active:scale-[0.97] transition-all shadow-md hover:shadow-lg"
            >
              {/* Subtle glow effect */}
              <div className="absolute inset-0 bg-gradient-to-br from-accent/0 to-accent/10 opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent/30 to-accent/20 flex items-center justify-center mb-2.5 border border-accent/20">
                  <Gift className="w-5 h-5 text-accent-foreground" />
                </div>
                <p className="text-sm font-bold text-foreground mb-0.5">Refer & Earn</p>
                <p className="text-[10px] text-muted-foreground leading-snug">Give $5, get rewarded</p>
                <span className="inline-block mt-2 text-[9px] font-bold text-accent-foreground bg-accent/15 px-2 py-0.5 rounded-full">Perk</span>
              </div>
            </motion.div>
          </Link>
        </div>
      </div>

      {/* Account Menu - Refined Sections */}
      <div className="px-5 mb-6">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-3 ml-1">Your NuVira</p>
        <div className="space-y-2">
          {accountMenuItems.map(({ icon: Icon, label, path, desc }, i) => (
            <motion.div
              key={label}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 + i * 0.04 }}
            >
              <Link to={path}>
                <div className="flex items-center gap-3.5 p-3.5 bg-card rounded-2xl border border-border/30 active:bg-secondary/50 transition-all shadow-sm hover:shadow-md">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center shrink-0 border border-primary/15">
                    <Icon className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground">{label}</p>
                    <p className="text-[10px] text-muted-foreground">{desc}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground/50" />
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Support Menu */}
      <div className="px-5 mb-6">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-3 ml-1">Support</p>
        <div className="space-y-2">
          {supportMenuItems.map(({ icon: Icon, label, path, desc }, i) => (
            <motion.div
              key={label}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 + i * 0.04 }}
            >
              <Link to={path}>
                <div className="flex items-center gap-3.5 p-3.5 bg-card rounded-2xl border border-border/30 active:bg-secondary/50 transition-all shadow-sm hover:shadow-md">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center shrink-0 border border-primary/15">
                    <Icon className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground">{label}</p>
                    <p className="text-[10px] text-muted-foreground">{desc}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground/50" />
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Brand Menu */}
      <div className="px-5 mb-6">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-3 ml-1">Brand</p>
        <div className="space-y-2">
          {brandItems.map(({ icon: Icon, label, path, desc }, i) => (
            <motion.div
              key={label}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.42 + i * 0.04 }}
            >
              <Link to={path}>
                <div className="flex items-center gap-3.5 p-3.5 bg-card rounded-2xl border border-border/30 active:bg-secondary/50 transition-all shadow-sm hover:shadow-md">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center shrink-0 border border-primary/15">
                    <Icon className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground">{label}</p>
                    <p className="text-[10px] text-muted-foreground">{desc}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground/50" />
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Merch */}
      <div className="px-5 mb-6">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-3 ml-1">Merch</p>
        <Link to="/merch">
          <motion.div
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.6 }}
            className="flex items-center justify-between p-3.5 bg-card rounded-2xl border border-border/30 active:bg-secondary/50 transition-all shadow-sm hover:shadow-md"
          >
            <div className="flex items-center gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center shrink-0 border border-primary/15">
                <Shirt className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">NuVira Merch</p>
                <p className="text-[10px] text-muted-foreground">Gear for the wellness lifestyle</p>
              </div>
            </div>
            <span className="text-[9px] font-bold bg-accent/15 text-accent-foreground px-2.5 py-1 rounded-full">Coming Soon</span>
          </motion.div>
        </Link>
      </div>

      {/* Driver Section */}
      {(user?.role === 'driver' || user?.role === 'admin') && (
        <div className="px-5 mb-6">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-3 ml-1">Driver</p>
          <Link to="/driver">
            <motion.div
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.65 }}
              className="flex items-center gap-3.5 p-3.5 bg-primary/5 rounded-2xl border border-primary/20 active:bg-primary/10 transition-all"
            >
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 border border-primary/15">
                <Truck className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">Driver Portal</p>
                <p className="text-[10px] text-muted-foreground">Route planner & bag returns</p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground/50" />
            </motion.div>
          </Link>
        </div>
      )}

      {/* Admin Section */}
      {user?.role === 'admin' && (
        <div className="px-5 mb-6">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-3 ml-1">Admin</p>
          <div className="space-y-2">
            <Link to="/admin/orders">
              <motion.div
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.7 }}
                className="flex items-center gap-3.5 p-3.5 bg-primary/5 rounded-2xl border border-primary/20 active:bg-primary/10 transition-all"
              >
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 border border-primary/15">
                  <ClipboardList className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">Order Management</p>
                  <p className="text-[10px] text-muted-foreground">Update order statuses</p>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground/50" />
              </motion.div>
            </Link>

            <Link to="/admin/shopify">
              <motion.div
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.73 }}
                className="flex items-center gap-3.5 p-3.5 bg-primary/5 rounded-2xl border border-primary/20 active:bg-primary/10 transition-all"
              >
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 border border-primary/15">
                  <Zap className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">Shopify Integration</p>
                  <p className="text-[10px] text-muted-foreground">Orders, sync, webhooks, reports</p>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground/50" />
              </motion.div>
            </Link>

            <Link to="/admin/products">
              <motion.div
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.76 }}
                className="flex items-center gap-3.5 p-3.5 bg-primary/5 rounded-2xl border border-primary/20 active:bg-primary/10 transition-all"
              >
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 border border-primary/15">
                  <ImagePlus className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">Product Images</p>
                  <p className="text-[10px] text-muted-foreground">Upload & manage product photos</p>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground/50" />
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