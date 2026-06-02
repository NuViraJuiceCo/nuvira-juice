import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';

import {
  Activity, ShoppingBag, Bell, HelpCircle, Settings, ChevronRight, LogOut, BookOpen, Sparkles, Calendar, Repeat2, Gift, Shirt, Handshake, PartyPopper, ClipboardList, Zap, ImagePlus, Leaf, Crown, Wallet, Star, Package, Truck, ShieldCheck, Store
} from 'lucide-react';
import CreditWallet from '@/components/account/CreditWallet';
import BrowserAppPrompt from '@/components/BrowserAppPrompt';
import ProfileAvatar from '@/components/account/ProfileAvatar';
import { motion } from 'framer-motion';

// Account menu items grouped by section
const accountMenuItems = [
  { icon: ShoppingBag, label: 'Order History', path: '/account/orders', desc: 'View past and active orders' },
  { icon: Repeat2, label: 'My Subscriptions', path: '/account/subscriptions', desc: 'View and manage your active ritual' },
];

const supportMenuItems = [
  { icon: Bell, label: 'Notification Settings', path: '/account/settings', desc: 'Enable push and choose alerts' },
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

const adminToolItems = [
  { icon: Settings, label: 'Operations', path: '/admin/operations', desc: 'Admin command center' },
  { icon: ClipboardList, label: 'Orders', path: '/admin/orders', desc: 'Customer, order, fulfillment, and timeline context' },
  { icon: Store, label: 'POS / Event Orders', path: '/admin/pos-orders', desc: 'Shopify POS event orders and source labels' },
  { icon: Calendar, label: 'Production Planning', path: '/admin/production-planning', desc: 'Product demand and procurement needs' },
  { icon: Package, label: 'Production Queue', path: '/admin/production-queue', desc: 'Controlled batch lifecycle actions' },
  { icon: Truck, label: 'Delivery Queue', path: '/admin/delivery-queue', desc: 'Driver assignment, Out For Delivery, Delivered' },
  { icon: ShieldCheck, label: 'Compliance Ops', path: '/admin/compliance-ops', desc: 'Logs, checklists, batch records, audit export' },
  { icon: Package, label: 'Inventory Status', path: '/admin/inventory-status', desc: 'Stock, supplier, reorder, and procurement view' },
  { icon: Activity, label: 'Sync Health', path: '/admin/sync-health', desc: 'Bridge errors, review issues, disabled tools' },
  { icon: Bell, label: 'Ops Alerts', path: '/admin/ops-alerts', desc: 'Sanitized operations inbox' },
  { icon: Zap, label: 'Shopify', path: '/admin/shopify', desc: 'POS/webhook visibility and gated exact-order tools' },
  { icon: Activity, label: 'Live Checkout Monitor', path: '/admin/live-monitor', desc: 'One-order checkout trace visibility' },
  { icon: ImagePlus, label: 'Product Images', path: '/admin/products', desc: 'Catalog photo management' },
];

function AdminToolRow({ item, index, isLast }) {
  const Icon = item.icon;
  return (
    <Link to={item.path}>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.74 + index * 0.01 }}
        className={`flex items-center gap-3.5 p-3.5 active:bg-secondary/40 transition-colors ${isLast ? '' : 'border-b border-border/40 dark:border-primary/15'}`}
      >
        <div className="w-9 h-9 rounded-lg bg-primary/15 dark:bg-primary/20 flex items-center justify-center shrink-0 border border-primary/20 dark:border-primary/25">
          <Icon className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">{item.label}</p>
          <p className="text-[9px] text-foreground/55 dark:text-muted-foreground/75">{item.desc}</p>
        </div>
        <ChevronRight className="w-4 h-4 text-muted-foreground/50 dark:text-muted-foreground/60" />
      </motion.div>
    </Link>
  );
}

export default function Account() {
  const { user, logout, navigateToLogin } = useAuth();
  // staleTime: 2min — cached data shows instantly on back-navigation (stale-while-revalidate)
  // isLoading is only true on first load (no cached data yet), not on background refreshes
  const { data: dashData, isLoading: isDashLoading } = useQuery({
    queryKey: ['account-dashboard', user?.email],
    queryFn: async () => {
      const res = await base44.functions.invoke('getCustomerAccountDashboardData', {});
      return res.data || {};
    },
    enabled: !!user?.email,
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });

  const userProfile = dashData?.customer_profile || null;
  const orders = dashData?.orders || [];
  const subscriptions = dashData?.active_subscriptions || [];

  const handleLogout = () => {
    if (user) {
      logout();
    } else {
      navigateToLogin();
    }
  };

  return (
    <div className="pb-6">
      <BrowserAppPrompt pageRoute="/account" />
      {/* Premium Member Dashboard Header */}
      <div className="relative overflow-hidden px-5 pt-10 pb-8 mb-4" style={{ 
        paddingTop: 'max(2.5rem, env(safe-area-inset-top))',
        background: `
          radial-gradient(circle at 50% 0%, hsl(var(--primary) / 0.2) 0%, transparent 65%),
          radial-gradient(circle at 80% 20%, hsl(var(--accent) / 0.06) 0%, transparent 35%),
          linear-gradient(180deg, hsl(var(--primary) / 0.12) 0%, hsl(var(--background)) 100%)
        `
      }}>
        {/* Decorative accent line */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-20 h-0.5 bg-gradient-to-r from-transparent via-primary/30 to-transparent rounded-full" />
        
        {/* Main dashboard card */}
        <div className="relative rounded-3xl border border-border/50 dark:border-primary/30 p-5 shadow-lg bg-card/70 backdrop-blur-sm">
          <div className="flex items-start gap-4">
            {/* Avatar with profile photo upload */}
            <ProfileAvatar userProfile={userProfile} size="large" />

            {/* User Info - Better hierarchy */}
            <div className="flex-1 min-w-0 pt-0.5">
              <h1 className="font-heading text-lg font-bold text-foreground mb-1.5 leading-tight">
                {user?.first_name ? `Welcome, ${user.first_name}` : 'Welcome'}
              </h1>
              
              {/* Badges row */}
              <div className="flex flex-wrap gap-2 mb-2">
                {user && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-accent/25 dark:bg-accent/25 border border-accent/40 dark:border-accent/35 rounded-full">
                    <Crown className="w-3 h-3 text-orange-800 dark:text-white" />
                    <span className="text-[10px] font-bold text-orange-800 dark:text-white uppercase tracking-wide">Member</span>
                  </span>
                )}
                {!isDashLoading && subscriptions.length > 0 && subscriptions.some(s => s.status === 'active') && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-primary/20 dark:bg-primary/25 border border-primary/40 dark:border-primary/35 rounded-full">
                    <Star className="w-3 h-3 text-primary dark:text-white" />
                    <span className="text-[10px] font-bold text-primary dark:text-white uppercase tracking-wide">Active Ritual</span>
                  </span>
                )}
              </div>
              
              {/* Email - readable in both modes */}
              {user?.email && (
                <p className="text-xs text-foreground/60 dark:text-muted-foreground/90 truncate max-w-[240px]">{user.email}</p>
              )}
            </div>
          </div>

          {/* Divider and metadata - better grouping */}
          <div className="mt-4 pt-3.5 border-t border-border/50 dark:border-primary/25">
            <div className="space-y-2">
              {userProfile?.phone && (
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-primary/15 dark:bg-primary/20 flex items-center justify-center shrink-0 border border-primary/20 dark:border-primary/25">
                    <svg className="w-3.5 h-3.5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                    </svg>
                  </div>
                  <p className="text-xs font-medium text-foreground dark:text-foreground/90">{userProfile.phone}</p>
                </div>
              )}
              {userProfile?.address && (
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-primary/15 dark:bg-primary/20 flex items-center justify-center shrink-0 border border-primary/20 dark:border-primary/25">
                    <svg className="w-3.5 h-3.5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </div>
                  <p className="text-xs font-medium text-foreground dark:text-foreground/90 line-clamp-1">{userProfile.address}</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Account Snapshot Stats */}
        {user && (
          <motion.div 
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="grid grid-cols-3 gap-2 mt-3"
          >
            <div className="rounded-xl border border-border/60 dark:border-primary/25 p-3 text-center bg-card/80 dark:bg-card/40 backdrop-blur-sm">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <Package className="w-3.5 h-3.5 text-primary" />
                <p className="text-[9px] font-bold text-foreground/55 dark:text-muted-foreground/80 uppercase tracking-wider">Orders</p>
              </div>
              {isDashLoading ? (
                <div className="h-6 w-8 bg-muted rounded animate-pulse mx-auto" />
              ) : (
                <p className="font-heading text-lg font-bold text-foreground dark:text-white">{orders.length}</p>
              )}
            </div>
            <div className="rounded-xl border border-border/60 dark:border-primary/25 p-3 text-center bg-card/80 dark:bg-card/40 backdrop-blur-sm">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <Repeat2 className="w-3.5 h-3.5 text-accent" />
                <p className="text-[9px] font-bold text-foreground/55 dark:text-muted-foreground/80 uppercase tracking-wider">Ritual</p>
              </div>
              {isDashLoading ? (
                <div className="h-6 w-10 bg-muted rounded animate-pulse mx-auto" />
              ) : (
                <p className="font-heading text-lg font-bold text-foreground dark:text-white">{subscriptions.filter(s => s.status === 'active').length > 0 ? 'Active' : 'None'}</p>
              )}
            </div>
            <Link to="/rewards">
            <div className="rounded-xl border border-border/60 dark:border-primary/25 p-3 text-center bg-card/80 dark:bg-card/40 backdrop-blur-sm active:scale-95 transition-transform">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <Wallet className="w-3.5 h-3.5 text-primary" />
                <p className="text-[9px] font-bold text-foreground/55 dark:text-muted-foreground/80 uppercase tracking-wider">Rewards</p>
              </div>
              <p className="font-heading text-lg font-bold text-primary dark:text-white">View →</p>
            </div>
            </Link>
          </motion.div>
        )}
      </div>

      {/* NuVira Wallet / Credits Card - Refined contrast */}
      {user && <div className="mt-2"><CreditWallet dashData={dashData} /></div>}

      {/* Premium Quick Actions - Refined contrast */}
      <div className="px-5 mt-5 mb-6">
        <div className="grid grid-cols-2 gap-3">
          <Link to="/account/subscriptions">
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.15 }}
              className="group relative overflow-hidden rounded-2xl p-4 bg-gradient-to-br from-primary/20 via-primary/15 to-primary/10 dark:from-primary/25 dark:via-primary/18 dark:to-primary/12 border border-primary/25 dark:border-primary/30 active:scale-[0.97] transition-all shadow-sm hover:shadow-md" style={{ touchAction: 'pan-y' }}
            >
              <div className="relative">
                <div className="w-9 h-9 rounded-lg bg-primary/20 dark:bg-primary/25 flex items-center justify-center mb-2 border border-primary/20 dark:border-primary/30">
                  <Repeat2 className="w-4 h-4 text-primary dark:text-white" />
                </div>
                <p className="text-sm font-bold text-foreground dark:text-white mb-0.5">Weekly Ritual</p>
                <p className="text-[10px] text-foreground/55 dark:text-muted-foreground/80 leading-snug">Pause, skip, or manage</p>
                <span className="inline-block mt-2 text-[9px] font-bold text-primary dark:text-white bg-primary/15 dark:bg-primary/20 px-2 py-0.5 rounded-full border border-primary/30 dark:border-primary/25">Flexible</span>
              </div>
            </motion.div>
          </Link>

          <Link to="/referral">
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.18 }}
              className="group relative overflow-hidden rounded-2xl p-4 bg-gradient-to-br from-[#C9A24A]/15 via-[#C9A24A]/10 to-[#C9A24A]/8 dark:from-[#C9A24A]/20 dark:via-[#C9A24A]/15 dark:to-[#C9A24A]/10 border border-[#C9A24A]/20 dark:border-[#C9A24A]/30 active:scale-[0.97] transition-all shadow-sm hover:shadow-md" style={{ touchAction: 'pan-y' }}
            >
              <div className="relative">
                <div className="w-9 h-9 rounded-lg bg-[#C9A24A]/20 dark:bg-[#C9A24A]/25 flex items-center justify-center mb-2 border border-[#C9A24A]/20 dark:border-[#C9A24A]/30">
                  <Gift className="w-4 h-4 text-[#9A7B2F] dark:text-[#E7C873]" />
                </div>
                <p className="text-sm font-bold text-foreground dark:text-white mb-0.5">Refer & Earn</p>
                <p className="text-[10px] text-foreground/55 dark:text-muted-foreground/80 leading-snug">Give $5, get rewarded</p>
                <span className="inline-block mt-2 text-[9px] font-bold text-[#7A5F20] dark:text-[#E7C873] bg-[#C9A24A]/20 dark:bg-[#C9A24A]/20 px-2 py-0.5 rounded-full border border-[#C9A24A]/40 dark:border-[#C9A24A]/30">Perk</span>
              </div>
            </motion.div>
          </Link>
        </div>
      </div>

      {/* Member Actions - Core NuVira Experience */}
      <div className="px-5 mt-8 mb-8">
        <div className="flex items-center gap-2 mb-4">
          <Leaf className="w-4 h-4 text-primary" />
          <p className="text-sm font-bold text-foreground">Your Ritual</p>
        </div>
        <div className="space-y-2.5">
          {accountMenuItems.map(({ icon: Icon, label, path, desc }, i) => (
            <motion.div
              key={label}
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.25 + i * 0.05 }}
            >
              <Link to={path}>
                <div className="group relative overflow-hidden rounded-2xl bg-card dark:bg-card/60 border border-border/50 dark:border-primary/25 p-4 active:scale-[0.98] transition-all shadow-sm hover:shadow-md">
                  <div className="flex items-center gap-3.5">
                    <div className="w-11 h-11 rounded-xl bg-primary/15 dark:bg-primary/20 flex items-center justify-center shrink-0 border border-primary/20 dark:border-primary/30 group-hover:scale-105 transition-transform">
                      <Icon className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-foreground">{label}</p>
                      <p className="text-[10px] text-foreground/55 dark:text-muted-foreground/85">{desc}</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-foreground/35 dark:text-muted-foreground/60 group-hover:translate-x-0.5 transition-transform" />
                  </div>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Brand Discovery - Editorial Lifestyle Section */}
      <div className="px-5 mb-8">
        <div className="mb-4">
          <p className="text-xs font-bold text-foreground mb-1">Discover NuVira</p>
          <p className="text-[10px] text-foreground/55 dark:text-muted-foreground/85">Our story, philosophy & community</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {brandItems.slice(0, 2).map(({ icon: Icon, label, path, desc }, i) => (
            <motion.div
              key={label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35 + i * 0.05 }}
            >
              <Link to={path}>
                <div className="group relative overflow-hidden rounded-2xl bg-primary/12 dark:bg-primary/18 border border-primary/25 dark:border-primary/35 p-4 active:scale-[0.98] transition-all">
                  <div className="w-9 h-9 rounded-xl bg-primary/18 dark:bg-primary/25 flex items-center justify-center mb-2.5 group-hover:scale-110 transition-transform border border-primary/20 dark:border-primary/30">
                    <Icon className="w-4 h-4 text-primary" />
                  </div>
                  <p className="text-xs font-bold text-foreground mb-1">{label}</p>
                  <p className="text-[9px] text-foreground/55 dark:text-muted-foreground/85 leading-snug line-clamp-2">{desc}</p>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 mt-2">
          {brandItems.slice(2, 4).map(({ icon: Icon, label, path, desc }, i) => (
            <motion.div
              key={label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.45 + i * 0.05 }}
            >
              <Link to={path}>
                <div className="group relative overflow-hidden rounded-2xl bg-accent/12 dark:bg-accent/18 border border-accent/30 dark:border-accent/35 p-4 active:scale-[0.98] transition-all">
                  <div className="w-9 h-9 rounded-xl bg-accent/20 dark:bg-accent/25 flex items-center justify-center mb-2.5 group-hover:scale-110 transition-transform border border-accent/30 dark:border-accent/30">
                    <Icon className="w-4 h-4 text-orange-800 dark:text-white" />
                  </div>
                  <p className="text-xs font-bold text-foreground mb-1">{label}</p>
                  <p className="text-[9px] text-foreground/55 dark:text-muted-foreground/85 leading-snug line-clamp-2">{desc}</p>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
        {/* Book Event - Full Width */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.55 }}
          className="mt-2"
        >
          <Link to="/book-event">
            <div className="group relative overflow-hidden rounded-2xl bg-primary/15 dark:bg-primary/20 border border-primary/30 dark:border-primary/40 p-4 active:scale-[0.98] transition-all">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/25 dark:bg-primary/30 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform border border-primary/25 dark:border-primary/35">
                  <PartyPopper className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-foreground">Book Us for an Event</p>
                  <p className="text-[9px] text-foreground/55 dark:text-muted-foreground/85">Birthdays, showers & more</p>
                </div>
              </div>
            </div>
          </Link>
        </motion.div>
      </div>

      {/* Support & Settings - Utility Section (Quieter) */}
      <div className="px-5 mb-8">
        <p className="text-[10px] font-semibold text-foreground/50 dark:text-muted-foreground/80 uppercase tracking-wider mb-3">Support</p>
        <div className="rounded-2xl border border-border/50 dark:border-primary/20 overflow-hidden bg-card/40 dark:bg-card/30">
          {supportMenuItems.map(({ icon: Icon, label, path, desc }, i) => (
            <motion.div
              key={label}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6 + i * 0.04 }}
            >
              <Link to={path}>
                <div className={`flex items-center gap-3.5 p-3.5 active:bg-secondary/40 transition-colors ${i !== supportMenuItems.length - 1 ? 'border-b border-border/40 dark:border-primary/15' : ''}`}>
                  <div className="w-9 h-9 rounded-lg bg-muted/60 dark:bg-primary/15 flex items-center justify-center shrink-0 border border-border/30 dark:border-primary/20">
                    <Icon className="w-4 h-4 text-muted-foreground dark:text-muted-foreground/80" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{label}</p>
                    <p className="text-[9px] text-foreground/55 dark:text-muted-foreground/75">{desc}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-foreground/35 dark:text-muted-foreground/60" />
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Merch Teaser - Lifestyle */}
      <div className="px-5 mb-8">
        <Link to="/merch">
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.7 }}
            className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-accent/18 via-accent/12 to-accent/8 dark:from-accent/25 dark:via-accent/18 dark:to-accent/12 border border-accent/30 dark:border-accent/40 p-5 active:scale-[0.98] transition-all"
          >
            <div className="absolute top-0 right-0 w-20 h-20 bg-accent/15 dark:bg-accent/20 rounded-full blur-2xl" />
            <div className="relative flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-accent/25 dark:bg-accent/30 flex items-center justify-center shrink-0 border border-accent/30 dark:border-accent/40">
                  <Shirt className="w-5 h-5 text-accent-foreground dark:text-white" />
                </div>
                <div>
                  <p className="text-sm font-bold text-foreground mb-0.5">NuVira Merch</p>
                  <p className="text-[10px] text-foreground/55 dark:text-muted-foreground/85">Gear for the wellness lifestyle</p>
                </div>
              </div>
              <span className="text-[9px] font-bold bg-accent/25 dark:bg-accent/30 text-accent-foreground dark:text-white px-3 py-1 rounded-full border border-accent/30 dark:border-accent/40">Coming Soon</span>
            </div>
          </motion.div>
        </Link>
      </div>

      {/* Admin Tools - Utility Section */}
      {user?.role === 'admin' && (
        <div className="px-5 mb-8">
          <div className="rounded-2xl border border-border/50 dark:border-primary/20 overflow-hidden bg-card/40 dark:bg-card/25">
            <div className="px-4 py-2.5 border-b border-border/50 dark:border-primary/20">
              <p className="text-[10px] font-semibold text-foreground/50 dark:text-muted-foreground/75 uppercase tracking-wider">Admin Tools</p>
            </div>
            {adminToolItems.map((item, index) => (
              <AdminToolRow
                key={item.path}
                item={item}
                index={index}
                isLast={index === adminToolItems.length - 1}
              />
            ))}
          </div>
        </div>
      )}

      {/* Sign Out - Clean & Simple */}
      <div className="px-5 mt-4 mb-8">
        <button
          onClick={handleLogout}
          className="w-full flex items-center justify-center gap-2 text-sm font-medium py-3 rounded-xl border border-border/50 dark:border-primary/25 bg-transparent hover:bg-secondary/30 dark:hover:bg-primary/10 transition-all active:scale-[0.98]"
        >
          <LogOut className="w-4 h-4 text-muted-foreground dark:text-muted-foreground/80" />
          {user ? 'Sign Out' : 'Sign In'}
        </button>
      </div>

      {/* Brand Footer - Minimal & Elegant */}
      <div className="text-center px-5 mt-10 pb-8">
        <img
          src="https://media.base44.com/images/public/69d48d0c39891f7945481152/b04d63077_Asset18322x.png"
          alt="NuVira Juice Company"
          className="h-4 mx-auto mb-2 opacity-80 dark:opacity-75"
        />
        <p className="text-[9px] text-muted-foreground dark:text-muted-foreground/80">Real. Living. Nutrition.</p>
        <div className="flex items-center justify-center gap-3 mt-2">
          <Link to="/legal" className="text-[9px] text-muted-foreground dark:text-muted-foreground/75 hover:text-primary transition-colors">Legal</Link>
          <span className="text-[9px] text-muted-foreground/40 dark:text-muted-foreground/30">·</span>
          <p className="text-[9px] text-muted-foreground dark:text-muted-foreground/75">© {new Date().getFullYear()} NuVira</p>
        </div>
      </div>
    </div>
  );
}
