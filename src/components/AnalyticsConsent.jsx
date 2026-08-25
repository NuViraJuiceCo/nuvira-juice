import React from 'react';
import { useLocation } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { isNativeAppRuntime } from '@/lib/nativeRuntime';
import {
  ANALYTICS_CONSENT_EVENT,
  getAnalyticsConsent,
  setAnalyticsConsent,
  isTrackableAnalyticsPath,
  trackGooglePageView,
} from '@/lib/googleAnalytics';

export default function AnalyticsConsent() {
  const location = useLocation();
  const isNative = isNativeAppRuntime();
  const [showBanner, setShowBanner] = React.useState(() => !isNative && getAnalyticsConsent() === null);

  React.useEffect(() => {
    if (isNative || getAnalyticsConsent() !== 'granted') return;
    void trackGooglePageView(location.pathname, document.title);
  }, [isNative, location.pathname]);

  React.useEffect(() => {
    if (isNative) return undefined;
    const onConsent = (event) => {
      if (event.detail === 'reset') {
        setShowBanner(true);
        return;
      }
      setShowBanner(false);
      if (event.detail === 'granted') {
        void trackGooglePageView(window.location.pathname, document.title);
      }
    };
    window.addEventListener(ANALYTICS_CONSENT_EVENT, onConsent);
    return () => window.removeEventListener(ANALYTICS_CONSENT_EVENT, onConsent);
  }, [isNative]);

  if (isNative || !showBanner || !isTrackableAnalyticsPath(location.pathname) || location.pathname === '/checkout') return null;

  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-label="Analytics preferences"
      className="fixed inset-x-3 bottom-[calc(5.75rem+env(safe-area-inset-bottom))] z-[120] mx-auto max-w-xl rounded-2xl border border-primary/20 bg-card/95 p-4 shadow-2xl backdrop-blur-md md:bottom-5"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <ShieldCheck className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-foreground">Your privacy, your choice</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Optional Google Analytics helps us understand website visits and completed purchases. We never send your name, email, phone, street address, or payment details.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setAnalyticsConsent('denied')}
              className="h-10 rounded-xl border border-border bg-background px-4 text-xs font-semibold text-foreground"
            >
              Only necessary
            </button>
            <button
              type="button"
              onClick={() => setAnalyticsConsent('granted')}
              className="nuvira-gradient-button h-10 rounded-xl px-4 text-xs font-semibold"
            >
              Allow analytics
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
