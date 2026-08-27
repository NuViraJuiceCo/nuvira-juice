import React from 'react';
import { useLocation } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { isNativeAppRuntime } from '@/lib/nativeRuntime';
import {
  ANALYTICS_CONSENT_EVENT,
  getAnalyticsConsent,
  setAnalyticsConsent,
  isTrackableAnalyticsPath,
  trackGooglePageView,
} from '@/lib/googleAnalytics';
import {
  MARKETING_CONSENT_EVENT,
  getMarketingConsent,
  setMarketingConsent,
  trackMetaPageView,
} from '@/lib/metaPixel';

export default function AnalyticsConsent() {
  const location = useLocation();
  const isNative = isNativeAppRuntime();
  const [showBanner, setShowBanner] = React.useState(() => (
    !isNative && (getAnalyticsConsent() === null || getMarketingConsent() === null)
  ));
  const [analyticsAllowed, setAnalyticsAllowed] = React.useState(() => getAnalyticsConsent() === 'granted');
  const [marketingAllowed, setMarketingAllowed] = React.useState(() => getMarketingConsent() === 'granted');

  React.useEffect(() => {
    if (isNative || getAnalyticsConsent() !== 'granted') return;
    void trackGooglePageView(location.pathname, document.title);
  }, [isNative, location.pathname]);

  React.useEffect(() => {
    if (isNative || getMarketingConsent() !== 'granted') return;
    void trackMetaPageView(location.pathname);
  }, [isNative, location.pathname]);

  React.useEffect(() => {
    if (isNative) return undefined;
    const onConsent = (event) => {
      if (event.detail === 'reset') {
        setAnalyticsAllowed(false);
        setShowBanner(true);
        return;
      }
      setAnalyticsAllowed(event.detail === 'granted');
      setShowBanner(false);
      if (event.detail === 'granted') {
        void trackGooglePageView(window.location.pathname, document.title);
      }
    };
    window.addEventListener(ANALYTICS_CONSENT_EVENT, onConsent);
    return () => window.removeEventListener(ANALYTICS_CONSENT_EVENT, onConsent);
  }, [isNative]);

  React.useEffect(() => {
    if (isNative) return undefined;
    const onConsent = (event) => {
      if (event.detail === 'reset') {
        setMarketingAllowed(false);
        setShowBanner(true);
        return;
      }
      setMarketingAllowed(event.detail === 'granted');
      setShowBanner(false);
      if (event.detail === 'granted') {
        void trackMetaPageView(window.location.pathname);
      }
    };
    window.addEventListener(MARKETING_CONSENT_EVENT, onConsent);
    return () => window.removeEventListener(MARKETING_CONSENT_EVENT, onConsent);
  }, [isNative]);

  const saveChoices = () => {
    setAnalyticsConsent(analyticsAllowed ? 'granted' : 'denied');
    setMarketingConsent(marketingAllowed ? 'granted' : 'denied');
    setShowBanner(false);
  };

  const useNecessaryOnly = () => {
    setAnalyticsAllowed(false);
    setMarketingAllowed(false);
    setAnalyticsConsent('denied');
    setMarketingConsent('denied');
    setShowBanner(false);
  };

  if (isNative || !showBanner || !isTrackableAnalyticsPath(location.pathname) || location.pathname === '/checkout') return null;

  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-label="Measurement preferences"
      className="fixed inset-x-3 bottom-[calc(5.75rem+env(safe-area-inset-bottom))] z-[120] mx-auto max-h-[calc(100dvh-7rem-env(safe-area-inset-bottom))] max-w-xl overflow-y-auto rounded-2xl border border-primary/20 bg-card/95 p-3 shadow-2xl backdrop-blur-md sm:p-4 md:bottom-5 md:max-h-none"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <ShieldCheck className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-foreground">Your privacy, your choice</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground sm:text-xs">
            Optional website measurement never includes your contact, address, or payment details.
          </p>
          <div className="mt-2.5 grid grid-cols-2 gap-2 sm:mt-3">
            <label className="cursor-pointer rounded-xl border border-border/60 bg-background/55 p-2.5">
              <Checkbox
                checked={analyticsAllowed}
                onCheckedChange={(checked) => setAnalyticsAllowed(checked === true)}
                aria-label="Allow Google Analytics"
              />
              <span className="mt-2 block text-xs font-semibold leading-tight text-foreground">Website analytics</span>
              <span className="mt-1.5 block text-[10.5px] leading-relaxed text-muted-foreground">Visits, shopping steps, and completed purchases.</span>
            </label>
            <label className="cursor-pointer rounded-xl border border-border/60 bg-background/55 p-2.5">
              <Checkbox
                checked={marketingAllowed}
                onCheckedChange={(checked) => setMarketingAllowed(checked === true)}
                aria-label="Allow Meta marketing measurement"
              />
              <span className="mt-2 block text-xs font-semibold leading-tight text-foreground">Ad insights</span>
              <span className="mt-1.5 block text-[10.5px] leading-relaxed text-muted-foreground">Ad results and shopping or inquiry actions.</span>
            </label>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:justify-end">
            <button
              type="button"
              onClick={useNecessaryOnly}
              className="h-10 rounded-xl border border-border bg-background px-4 text-xs font-semibold text-foreground"
            >
              No thanks
            </button>
            <button
              type="button"
              onClick={saveChoices}
              className="nuvira-gradient-button h-10 rounded-xl px-4 text-xs font-semibold"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
