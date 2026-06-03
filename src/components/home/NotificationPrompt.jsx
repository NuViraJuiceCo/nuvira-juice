import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, X } from 'lucide-react';
import {
  getEventPushPermission,
  getEventPushSupportStatus,
  subscribeToEventPushNotifications,
} from '@/lib/eventPushNotifications';

const STORAGE_KEY = 'nuvira_native_notif_prompt_dismissed_v1';

function getStoredDismissedState() {
  try {
    return window.localStorage?.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function storeDismissedState() {
  try {
    window.localStorage?.setItem(STORAGE_KEY, '1');
  } catch {
    // Notification prompting should never block the app shell from loading.
  }
}

export default function NotificationPrompt() {
  const [permission, setPermission] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const [show, setShow] = useState(false);
  const [isEnabling, setIsEnabling] = useState(false);

  useEffect(() => {
    let active = true;
    let timer = null;

    if (typeof window === 'undefined') return undefined;
    const isDismissed = getStoredDismissedState();
    setDismissed(isDismissed);

    async function loadPermission() {
      const support = getEventPushSupportStatus();
      if (!support.supported) return;

      const currentPermission = await getEventPushPermission().catch(() => 'unsupported');
      if (!active) return;

      setPermission(currentPermission);
      if (currentPermission === 'default' && !isDismissed) {
        timer = setTimeout(() => {
          if (active) setShow(true);
        }, 2000);
      }
    }

    loadPermission();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const handleDismiss = () => {
    storeDismissedState();
    setDismissed(true);
    setShow(false);
  };

  const handleEnable = async () => {
    setIsEnabling(true);
    try {
      const result = await subscribeToEventPushNotifications();
      const nextPermission = result.status || (result.success ? 'granted' : 'default');
      setPermission(nextPermission);
      if (result.success || nextPermission === 'granted') {
        setShow(false);
        storeDismissedState();
      } else if (nextPermission === 'denied') {
        setShow(false);
        storeDismissedState();
      }
    } catch {
      setShow(false);
    } finally {
      setIsEnabling(false);
    }
  };

  if (permission === 'granted' || !show) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        transition={{ duration: 0.3 }}
        className="nuvira-premium-card mx-4 mb-4 rounded-2xl p-4"
      >
        <div className="flex items-start gap-3">
          <div className="nuvira-icon-badge w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5">
            <Bell className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold mb-0.5">Stay In The Loop</p>
            <p className="text-xs text-muted-foreground leading-snug">
              Enable notifications to be the first to know about new drops, deliveries, and community events.
            </p>
            <div className="flex gap-2 mt-3">
              <button
                onClick={handleEnable}
                disabled={isEnabling}
                className="nuvira-gradient-button px-4 py-1.5 rounded-full text-xs font-semibold"
              >
                {isEnabling ? 'Enabling...' : 'Enable Notifications'}
              </button>
            </div>
          </div>
          <button
            onClick={handleDismiss}
            className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-muted transition-colors shrink-0"
            aria-label="Dismiss"
          >
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
