import React from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { Bell, Package, Sparkles, Megaphone, Check } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';

const typeIcons = {
  order_update: Package,
  promotion: Megaphone,
  new_drop: Sparkles,
  general: Bell,
};

const typeColors = {
  order_update: 'bg-primary/10 text-primary',
  promotion: 'bg-accent/20 text-accent',
  new_drop: 'bg-accent/20 text-accent',
  general: 'bg-secondary text-muted-foreground',
};

export default function Notifications() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: notifications = [], isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => base44.entities.Notification.filter(
      { customer_email: user?.email },
      '-created_date',
      50
    ),
    enabled: !!user?.email,
  });

  const markRead = useMutation({
    mutationFn: (id) => base44.entities.Notification.update(id, { is_read: true }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  return (
    <div className="pb-4">
      <div className="px-4 pt-4 pb-3">
        <h1 className="font-heading text-xl font-bold">Updates</h1>
        <p className="text-xs text-muted-foreground">Stay in the loop</p>
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
            const Icon = typeIcons[notif.type] || Bell;
            const colorClass = typeColors[notif.type] || typeColors.general;

            return (
              <motion.div
                key={notif.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                onClick={() => !notif.is_read && markRead.mutate(notif.id)}
                className={`flex gap-3 p-3.5 rounded-xl border transition-colors cursor-pointer ${
                  notif.is_read
                    ? 'bg-card border-border/30'
                    : 'bg-primary/3 border-primary/10'
                }`}
              >
                <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${colorClass}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className={`text-sm font-medium ${!notif.is_read ? 'text-foreground' : 'text-muted-foreground'}`}>
                      {notif.title}
                    </p>
                    {!notif.is_read && (
                      <div className="w-2 h-2 bg-primary rounded-full shrink-0 mt-1.5" />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{notif.message}</p>
                  <p className="text-[10px] text-muted-foreground/70 mt-1">
                    {notif.created_date ? formatDistanceToNow(new Date(notif.created_date), { addSuffix: true }) : ''}
                  </p>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}