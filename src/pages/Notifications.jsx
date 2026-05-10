import React from 'react';
import { base44 } from '@/api/base44Client';
import { useNavigate, Link } from 'react-router-dom';
import PullToRefresh from '@/components/PullToRefresh';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { resolveCustomerIdentities } from '@/lib/identityResolver';
import { Bell, Package, Sparkles, Megaphone, ArrowLeft, Truck, Star, CreditCard, AlertCircle, Settings } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { motion } from 'framer-motion';

const subtypeIcons = {
  order_confirmation:           Package,
  production_reminder:          Sparkles,
  delivery_reminder:            Truck,
  out_for_delivery:             Truck,
  delivered:                    Package,
  subscription_renewal:         CreditCard,
  subscription_payment_success: CreditCard,
  subscription_payment_failed:  AlertCircle,
  promo:                        Megaphone,
  loyalty_credit:               Star,
  general:                      Bell,
};

const typeIcons = {
  order_update: Package,
  promotion: Megaphone,
  new_drop: Sparkles,
  general: Bell,
};

const subtypeColors = {
  order_confirmation:           'bg-primary/10 text-primary',
  production_reminder:          'bg-accent/15 text-accent',
  delivery_reminder:            'bg-primary/10 text-primary',
  out_for_delivery:             'bg-emerald-100 text-emerald-600',
  delivered:                    'bg-emerald-100 text-emerald-600',
  subscription_renewal:         'bg-blue-50 text-blue-600',
  subscription_payment_success: 'bg-blue-50 text-blue-600',
  subscription_payment_failed:  'bg-destructive/10 text-destructive',
  promo:                        'bg-accent/20 text-accent',
  loyalty_credit:               'bg-amber-50 text-amber-600',
  general:                      'bg-secondary text-muted-foreground',
};

const typeColors = {
  order_update: 'bg-primary/10 text-primary',
  promotion: 'bg-accent/20 text-accent',
  new_drop: 'bg-accent/20 text-accent',
  general: 'bg-secondary text-muted-foreground',
};

export default function Notifications() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: notifications = [], isLoading, refetch } = useQuery({
    queryKey: ['notifications', user?.email],
    queryFn: async () => {
      // Resolve all identity emails (handles Apple relay, alternate emails, etc.)
      const identities = await resolveCustomerIdentities(user);
      const seen = new Set();
      const all = [];
      for (const email of identities) {
        const batch = await base44.entities.Notification.filter(
          { customer_email: email },
          '-created_date',
          50
        );
        for (const n of batch) {
          if (!seen.has(n.id)) {
            seen.add(n.id);
            all.push(n);
          }
        }
      }
      // Sort merged results newest first
      return all.sort((a, b) => new Date(b.created_date) - new Date(a.created_date)).slice(0, 50);
    },
    enabled: !!user?.email,
  });

  const markRead = useMutation({
    mutationFn: (id) => base44.entities.Notification.update(id, { is_read: true }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const handleNotifTap = (notif) => {
    if (!notif.is_read) markRead.mutate(notif.id);
    if (notif.deep_link) navigate(notif.deep_link);
  };

  const unreadCount = notifications.filter(n => !n.is_read).length;

  return (
    <PullToRefresh onRefresh={refetch}>
    <div className="pb-4">
      <div className="flex items-center gap-3 px-4 pb-3" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
        <button onClick={() => navigate(-1)} className="w-9 h-9 bg-secondary rounded-full flex items-center justify-center shrink-0">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <h1 className="font-heading text-xl font-bold">Updates</h1>
          <p className="text-xs text-muted-foreground">{unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}</p>
        </div>
        <Link to="/account/settings" className="w-9 h-9 bg-secondary rounded-full flex items-center justify-center">
          <Settings className="w-4 h-4 text-muted-foreground" />
        </Link>
      </div>

      {isLoading ? (
        <div className="px-4 space-y-3">
          {[1,2,3].map(i => <div key={i} className="h-16 bg-secondary/50 rounded-xl animate-pulse" />)}
        </div>
      ) : notifications.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <Bell className="w-10 h-10 text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">No notifications yet</p>
          <p className="text-xs text-muted-foreground mt-1">We'll keep you updated on your orders</p>
        </div>
      ) : (
        <div className="px-4 space-y-2">
          {notifications.map((notif, i) => {
            const Icon = subtypeIcons[notif.notification_subtype] || typeIcons[notif.type] || Bell;
            const colorClass = subtypeColors[notif.notification_subtype] || typeColors[notif.type] || typeColors.general;

            return (
              <motion.div
                key={notif.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                onClick={() => handleNotifTap(notif)}
                className={`flex gap-3 p-3.5 rounded-xl border transition-all active:scale-[0.99] cursor-pointer ${
                  notif.is_read
                    ? 'bg-card border-border/30'
                    : 'bg-primary/[0.03] border-primary/15'
                } ${notif.deep_link ? 'active:bg-secondary/60' : ''}`}
              >
                <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${colorClass}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className={`text-sm font-medium leading-snug ${!notif.is_read ? 'text-foreground' : 'text-muted-foreground'}`}>
                      {notif.title}
                    </p>
                    {!notif.is_read && (
                      <div className="w-2 h-2 bg-primary rounded-full shrink-0 mt-1.5" />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{notif.message}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-[10px] text-muted-foreground/70">
                      {notif.created_date ? formatDistanceToNow(new Date(notif.created_date), { addSuffix: true }) : ''}
                    </p>
                    {notif.deep_link && (
                      <span className="text-[10px] text-primary font-medium">Tap to view →</span>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
    </PullToRefresh>
  );
}