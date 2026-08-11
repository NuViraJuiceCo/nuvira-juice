import React, { useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Link, useNavigate } from 'react-router-dom';
import PullToRefresh from '@/components/PullToRefresh';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import {
  AlertCircle,
  ArrowLeft,
  Bell,
  CheckCheck,
  CreditCard,
  Megaphone,
  Package,
  RefreshCw,
  Settings,
  Sparkles,
  Star,
  Trash2,
  Truck,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';

const subtypeIcons = {
  order_confirmation: Package,
  production_reminder: Sparkles,
  delivery_reminder: Truck,
  out_for_delivery: Truck,
  delivered: Package,
  subscription_renewal: CreditCard,
  subscription_payment_success: CreditCard,
  subscription_payment_failed: AlertCircle,
  promo: Megaphone,
  loyalty_credit: Star,
  general: Bell,
};

const typeIcons = {
  order_update: Package,
  promotion: Megaphone,
  new_drop: Sparkles,
  general: Bell,
};

const subtypeColors = {
  order_confirmation: 'bg-primary/10 text-primary',
  production_reminder: 'bg-accent/15 text-accent',
  delivery_reminder: 'bg-primary/10 text-primary',
  out_for_delivery: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  delivered: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  subscription_renewal: 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  subscription_payment_success: 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  subscription_payment_failed: 'bg-destructive/10 text-destructive',
  promo: 'bg-accent/20 text-accent',
  loyalty_credit: 'bg-cyan-50 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300',
  general: 'bg-secondary text-muted-foreground',
};

const typeColors = {
  order_update: 'bg-primary/10 text-primary',
  promotion: 'bg-accent/20 text-accent',
  new_drop: 'bg-accent/20 text-accent',
  general: 'bg-secondary text-muted-foreground',
};

function optimisticNotifications(current = [], request) {
  if (request.action === 'mark_read') {
    return current.map((notification) => (
      notification.id === request.notification_id ? { ...notification, is_read: true } : notification
    ));
  }
  if (request.action === 'mark_all_read') {
    return current.map((notification) => ({ ...notification, is_read: true }));
  }
  if (request.action === 'dismiss') {
    return current.filter((notification) => notification.id !== request.notification_id);
  }
  if (request.action === 'dismiss_read') {
    return current.filter((notification) => notification.is_read !== true);
  }
  return current;
}

function NotificationRow({ notification, index, onOpen, onDismiss, isPending }) {
  const Icon = subtypeIcons[notification.notification_subtype] || typeIcons[notification.type] || Bell;
  const colorClass = subtypeColors[notification.notification_subtype] || typeColors[notification.type] || typeColors.general;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -80, height: 0, marginBottom: 0 }}
      transition={{ delay: index * 0.025, duration: 0.2 }}
      className="relative overflow-hidden rounded-xl"
    >
      <div className="absolute inset-y-0 right-0 flex w-24 items-center justify-end rounded-xl bg-destructive px-5 text-destructive-foreground" aria-hidden="true">
        <Trash2 className="h-5 w-5" />
      </div>

      <motion.div
        drag="x"
        dragConstraints={{ left: -96, right: 0 }}
        dragElastic={0.08}
        dragMomentum={false}
        dragSnapToOrigin
        onDragEnd={(_, info) => {
          if (info.offset.x <= -64 || info.velocity.x <= -500) onDismiss(notification);
        }}
        className={`relative flex min-h-[72px] items-stretch rounded-xl border transition-colors ${
          notification.is_read
            ? 'border-border/45 bg-card'
            : 'border-primary/25 bg-card shadow-[inset_3px_0_0_hsl(var(--primary)/0.75)]'
        }`}
        style={{ touchAction: 'pan-y' }}
      >
        <button
          type="button"
          onClick={() => onOpen(notification)}
          className={`flex min-w-0 flex-1 gap-3 p-3.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset ${notification.deep_link ? 'active:bg-secondary/60' : ''}`}
        >
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${colorClass}`}>
            <Icon className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-start justify-between gap-2">
              <span className={`text-sm font-semibold leading-snug ${notification.is_read ? 'text-foreground/70 dark:text-foreground/75' : 'text-foreground'}`}>
                {notification.title}
              </span>
              {!notification.is_read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />}
            </span>
            <span className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{notification.message}</span>
            <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="text-[10px] text-muted-foreground/75">
                {notification.created_date ? formatDistanceToNow(new Date(notification.created_date), { addSuffix: true }) : ''}
              </span>
              {notification.deep_link && <span className="text-[10px] font-semibold text-primary">View update</span>}
            </span>
          </span>
        </button>

        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onDismiss(notification);
          }}
          disabled={isPending}
          className="flex w-11 shrink-0 items-center justify-center border-l border-border/35 text-muted-foreground/60 transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset disabled:opacity-40"
          aria-label={`Clear ${notification.title || 'update'}`}
          title="Clear update"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </motion.div>
    </motion.div>
  );
}

export default function Notifications() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [view, setView] = useState('all');
  const queryKey = ['notifications', user?.email];

  const {
    data: notifications = [],
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useQuery({
    queryKey,
    queryFn: async () => {
      const response = await base44.functions.invoke('getCustomerNotifications', { action: 'list' });
      return response.data?.notifications || [];
    },
    enabled: Boolean(user?.email),
    staleTime: 60 * 1000,
  });

  const updateNotifications = useMutation({
    mutationFn: (request) => base44.functions.invoke('getCustomerNotifications', request),
    onMutate: async (request) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData(queryKey) || [];
      queryClient.setQueryData(queryKey, optimisticNotifications(previous, request));
      return { previous };
    },
    onError: (_error, _request, context) => {
      queryClient.setQueryData(queryKey, context?.previous || []);
      toast.error('That update could not be changed. Please try again.');
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });

  const unreadCount = notifications.filter((notification) => !notification.is_read).length;
  const readCount = notifications.length - unreadCount;
  const visibleNotifications = useMemo(
    () => (view === 'unread' ? notifications.filter((notification) => !notification.is_read) : notifications),
    [notifications, view]
  );

  const handleNotificationOpen = (notification) => {
    if (!notification.is_read) {
      updateNotifications.mutate({ action: 'mark_read', notification_id: notification.id });
    }
    if (notification.deep_link) navigate(notification.deep_link);
  };

  const handleDismiss = (notification) => {
    if (updateNotifications.isPending) return;
    updateNotifications.mutate({ action: 'dismiss', notification_id: notification.id });
  };

  return (
    <PullToRefresh onRefresh={refetch}>
      <div className="mx-auto w-full max-w-3xl pb-[calc(env(safe-area-inset-bottom)+6rem)]">
        <header className="px-4 pb-3" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              aria-label="Go back"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="min-w-0 flex-1" aria-live="polite">
              <h1 className="font-heading text-xl font-bold">Updates</h1>
              <p className="text-xs text-foreground/55">{unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}</p>
            </div>
            <button
              type="button"
              onClick={() => refetch()}
              disabled={isFetching}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
              aria-label="Refresh updates"
              title="Refresh updates"
            >
              <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            </button>
            <Link
              to="/account/settings"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              aria-label="Notification settings"
              title="Notification settings"
            >
              <Settings className="h-4 w-4" />
            </Link>
          </div>

          {notifications.length > 0 && (
            <div className="mt-4 flex items-center justify-between gap-2">
              <div className="grid grid-cols-2 rounded-lg bg-secondary/70 p-1" role="tablist" aria-label="Update filters">
                {['all', 'unread'].map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="tab"
                    aria-selected={view === option}
                    onClick={() => setView(option)}
                    className={`min-h-9 rounded-md px-3 text-xs font-bold capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                      view === option ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
                    }`}
                  >
                    {option}{option === 'unread' && unreadCount > 0 ? ` ${unreadCount}` : ''}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => updateNotifications.mutate({ action: 'mark_all_read' })}
                  disabled={unreadCount === 0 || updateNotifications.isPending}
                  className="flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-bold text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40"
                  title="Mark all updates read"
                >
                  <CheckCheck className="h-4 w-4" />
                  <span className="hidden sm:inline">Mark all read</span>
                </button>
                <button
                  type="button"
                  onClick={() => updateNotifications.mutate({ action: 'dismiss_read' })}
                  disabled={readCount === 0 || updateNotifications.isPending}
                  className="flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-bold text-foreground transition-colors hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40"
                  title="Clear read updates"
                >
                  <Trash2 className="h-4 w-4" />
                  <span className="hidden sm:inline">Clear read</span>
                </button>
              </div>
            </div>
          )}
        </header>

        {isLoading ? (
          <div className="grid gap-2 px-4">
            {[1, 2, 3].map((item) => <div key={item} className="h-[72px] animate-pulse rounded-xl bg-secondary/50" />)}
          </div>
        ) : isError ? (
          <div className="mx-4 flex flex-col items-center justify-center rounded-2xl border border-destructive/20 bg-card px-5 py-12 text-center">
            <AlertCircle className="mb-3 h-9 w-9 text-destructive" />
            <p className="text-sm font-bold text-foreground">Updates could not load</p>
            <p className="mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">Your notifications are still safe. Try loading them again.</p>
            <button
              type="button"
              onClick={() => refetch()}
              className="mt-4 flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground"
            >
              <RefreshCw className="h-4 w-4" />
              Try Again
            </button>
          </div>
        ) : visibleNotifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-5 py-20 text-center">
            {view === 'unread' ? <CheckCheck className="mb-3 h-10 w-10 text-primary" /> : <Bell className="mb-3 h-10 w-10 text-muted-foreground" />}
            <p className="text-sm font-bold text-foreground">{view === 'unread' ? 'No unread updates' : 'No updates yet'}</p>
            <p className="mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">
              {view === 'unread' ? 'Everything in your Updates center has been read.' : "We'll keep order, delivery, program, and reward updates here."}
            </p>
          </div>
        ) : (
          <div className="grid gap-2 px-4">
            <AnimatePresence initial={false}>
              {visibleNotifications.map((notification, index) => (
                <NotificationRow
                  key={notification.id}
                  notification={notification}
                  index={index}
                  onOpen={handleNotificationOpen}
                  onDismiss={handleDismiss}
                  isPending={updateNotifications.isPending}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </PullToRefresh>
  );
}
