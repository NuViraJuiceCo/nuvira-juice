import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { base44 } from '@/api/base44Client';

const APP_STORE_URL = 'https://apps.apple.com/us/app/nuvira-juice-co/id6742692918';
const UNIVERSAL_LINK_BASE = 'https://www.nuvirajuice.com'; // Universal Links use the same domain
const DISMISSAL_KEY = 'nuvira_app_prompt_dismissed_until';
const DISMISS_DAYS = 10;

/**
 * Detects if running inside a native app wrapper.
 * Checks for:
 *  - window.__NUVIRA_NATIVE__ flag injected by the wrapper
 *  - navigator.standalone (PWA/added to home screen in full-screen mode)
 *  - A custom UA string injected by the wrapper
 */
function isNativeApp() {
  if (typeof window === 'undefined') return true;
  if (window.__NUVIRA_NATIVE__) return true;
  if (window.ReactNativeWebView) return true;
  if (navigator.standalone === true) return true; // Added to home screen full-screen
  if (/NuViraApp/.test(navigator.userAgent)) return true;
  return false;
}

function isIOS() {
  if (typeof window === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

function isDismissed() {
  try {
    const until = localStorage.getItem(DISMISSAL_KEY);
    if (!until) return false;
    return Date.now() < Number(until);
  } catch {
    return false;
  }
}

function dismiss() {
  try {
    const until = Date.now() + DISMISS_DAYS * 24 * 60 * 60 * 1000;
    localStorage.setItem(DISMISSAL_KEY, String(until));
  } catch {}
}

/**
 * BrowserAppPrompt — shows a subtle bottom banner on iOS Safari (browser only).
 * Does NOT show inside the native app or on non-iOS devices.
 * Dismissible for 10 days.
 *
 * Props:
 *   pageRoute — current route used for Universal Link app-argument (e.g. "/account/orders")
 */
export default function BrowserAppPrompt({ pageRoute = '' }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Only show on iOS Safari browser — never inside native wrapper
    if (isNativeApp()) return;
    if (!isIOS()) return;
    if (isDismissed()) return;

    // Small delay so it doesn't pop in on first paint
    const timer = setTimeout(() => setVisible(true), 1800);
    return () => clearTimeout(timer);
  }, []);

  const handleDismiss = () => {
    dismiss();
    setVisible(false);
    try {
      base44.analytics.track({ eventName: 'app_prompt_dismissed', properties: { page: pageRoute } });
    } catch {}
  };

  const handleOpen = () => {
    dismiss();
    setVisible(false);
    try {
      base44.analytics.track({ eventName: 'app_prompt_open_app_clicked', properties: { page: pageRoute } });
    } catch {}
    // Universal Link — if app installed, iOS opens it; otherwise falls back to website
    const target = pageRoute
      ? `${UNIVERSAL_LINK_BASE}${pageRoute}`
      : UNIVERSAL_LINK_BASE;
    window.location.href = target;
  };

  const handleDownload = () => {
    dismiss();
    setVisible(false);
    try {
      base44.analytics.track({ eventName: 'app_prompt_download_clicked', properties: { page: pageRoute } });
    } catch {}
    window.open(APP_STORE_URL, '_blank');
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 30 }}
          className="fixed bottom-0 left-0 right-0 z-50 px-4 pb-safe"
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
        >
          <div
            className="relative rounded-2xl overflow-hidden shadow-2xl border border-white/10"
            style={{ background: 'linear-gradient(135deg, #0B3D2E 0%, #0E5A43 100%)' }}
          >
            {/* Dismiss */}
            <button
              onClick={handleDismiss}
              className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center rounded-full"
              style={{ background: 'rgba(255,255,255,0.15)' }}
            >
              <X className="w-3.5 h-3.5 text-white" />
            </button>

            <div className="flex items-center gap-3 px-4 pt-4 pb-4 pr-12">
              {/* App icon */}
              <img
                src="https://media.base44.com/images/public/69d48d0c39891f7945481152/b04d63077_Asset18322x.png"
                alt="NuVira"
                className="w-12 h-12 rounded-2xl shrink-0 border border-white/20"
              />

              {/* Copy */}
              <div className="flex-1 min-w-0">
                <p className="text-white font-bold text-sm leading-tight">Get The Full NuVira Experience</p>
                <p className="text-white/65 text-[11px] mt-0.5 leading-snug">
                  Track deliveries, manage your ritual & unlock rewards.
                </p>
              </div>
            </div>

            {/* CTAs */}
            <div className="flex gap-2 px-4 pb-4">
              <button
                onClick={handleOpen}
                className="flex-1 py-2.5 rounded-xl text-xs font-bold text-white"
                style={{ background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.25)' }}
              >
                Open App
              </button>
              <button
                onClick={handleDownload}
                className="flex-1 py-2.5 rounded-xl text-xs font-bold"
                style={{ background: '#C9A24A', color: '#062A20' }}
              >
                Download App
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}