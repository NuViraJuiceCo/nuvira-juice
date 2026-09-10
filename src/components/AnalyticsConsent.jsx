import React from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { isNativeAppRuntime } from '@/lib/nativeRuntime';
import {
  ANALYTICS_CONSENT_EVENT,
  ANALYTICS_CONSENT_STORAGE_KEY,
  GOOGLE_ADS_CONSENT_EVENT,
  GOOGLE_ADS_CONSENT_STORAGE_KEY,
  getGoogleAdsMeasurementConsent,
  setGoogleAdsMeasurementConsent,
  syncGoogleMeasurementConsent,
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
import { trackSnapPageView } from '@/lib/snapPixel';

export default function AnalyticsConsent() {
  const location = useLocation();
  const isNative = isNativeAppRuntime();
  const [showBanner, setShowBanner] = React.useState(() => (
    !isNative && (getAnalyticsConsent() === null || getMarketingConsent() === null || getGoogleAdsMeasurementConsent() === null)
  ));
  const [analyticsAllowed, setAnalyticsAllowed] = React.useState(() => getAnalyticsConsent() === 'granted');
  const [marketingAllowed, setMarketingAllowed] = React.useState(() => getMarketingConsent() === 'granted');
  const [googleAdsAllowed, setGoogleAdsAllowed] = React.useState(() => getGoogleAdsMeasurementConsent() === 'granted');

  React.useEffect(() => {
    if (isNative || getAnalyticsConsent() !== 'granted') return;
    void trackGooglePageView(location.pathname, document.title);
  }, [isNative, location.pathname]);

  React.useEffect(() => {
    if (isNative || getMarketingConsent() !== 'granted') return;
    void trackMetaPageView(location.pathname);
    void trackSnapPageView(location.pathname);
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
        void trackSnapPageView(window.location.pathname);
      }
    };
    window.addEventListener(MARKETING_CONSENT_EVENT, onConsent);
    return () => window.removeEventListener(MARKETING_CONSENT_EVENT, onConsent);
  }, [isNative]);

  React.useEffect(() => {
    if (isNative) return undefined;
    const onConsent = (event) => {
      setGoogleAdsAllowed(event.detail === 'granted');
      if (event.detail === 'reset') setShowBanner(true);
    };
    window.addEventListener(GOOGLE_ADS_CONSENT_EVENT, onConsent);
    return () => window.removeEventListener(GOOGLE_ADS_CONSENT_EVENT, onConsent);
  }, [isNative]);

  React.useEffect(() => {
    if (isNative) return undefined;
    const onStorage = (event) => {
      if (event.key !== null && ![ANALYTICS_CONSENT_STORAGE_KEY, GOOGLE_ADS_CONSENT_STORAGE_KEY].includes(event.key)) return;
      // Cross-tab withdrawal updates the tag immediately without creating another page view.
      syncGoogleMeasurementConsent();
      setAnalyticsAllowed(getAnalyticsConsent() === 'granted');
      setGoogleAdsAllowed(getGoogleAdsMeasurementConsent() === 'granted');
      setShowBanner(getAnalyticsConsent() === null || getMarketingConsent() === null || getGoogleAdsMeasurementConsent() === null);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [isNative]);

  const saveChoices = () => {
    // Capture the new explicit purpose before analytics can emit its consented page view.
    setGoogleAdsMeasurementConsent(googleAdsAllowed ? 'granted' : 'denied');
    setAnalyticsConsent(analyticsAllowed ? 'granted' : 'denied');
    setMarketingConsent(marketingAllowed ? 'granted' : 'denied');
    setShowBanner(false);
  };

  const useNecessaryOnly = () => {
    setAnalyticsAllowed(false);
    setMarketingAllowed(false);
    setGoogleAdsAllowed(false);
    setGoogleAdsMeasurementConsent('denied');
    setAnalyticsConsent('denied');
    setMarketingConsent('denied');
    setShowBanner(false);
  };

  if (isNative || !showBanner || !isTrackableAnalyticsPath(location.pathname) || location.pathname === '/checkout') return null;

  const banner = (
    <aside
      role="dialog"
      aria-modal="false"
      aria-label="Measurement preferences"
      className="fixed inset-x-3 bottom-[calc(5.75rem+env(safe-area-inset-bottom))] z-[120] mx-auto flex max-h-[calc(100dvh-7rem-env(safe-area-inset-bottom))] max-w-xl flex-col overflow-hidden rounded-2xl border border-primary/20 bg-card shadow-2xl md:bottom-5 md:max-h-[calc(100dvh-2.5rem)]"
    >
      <div className="min-h-0 overflow-y-auto overscroll-contain p-3 sm:p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <ShieldCheck className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-foreground">Your privacy, your choice</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground sm:text-xs">
            Optional website measurement never includes raw name, contact, street address, or payment details.
          </p>
        </div>
      </div>
          <div className="mt-3 grid gap-2">
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-border/60 bg-background/55 p-2">
              <Checkbox
                checked={analyticsAllowed}
                onCheckedChange={(checked) => setAnalyticsAllowed(checked === true)}
                aria-label="Allow Google Analytics"
                className="relative h-11 w-11 border-0 bg-transparent shadow-none after:absolute after:left-1/2 after:top-1/2 after:h-4 after:w-4 after:-translate-x-1/2 after:-translate-y-1/2 after:rounded-sm after:border after:border-primary data-[state=checked]:bg-transparent data-[state=checked]:after:bg-primary [&>span]:relative [&>span]:z-10"
              />
              <span className="min-w-0">
                <span className="block text-xs font-semibold leading-tight text-foreground">Website analytics</span>
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">Visits, shopping steps, and completed purchases.</span>
              </span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-border/60 bg-background/55 p-2">
              <Checkbox
                checked={marketingAllowed}
                onCheckedChange={(checked) => setMarketingAllowed(checked === true)}
                aria-label="Allow advertising measurement"
                className="relative h-11 w-11 border-0 bg-transparent shadow-none after:absolute after:left-1/2 after:top-1/2 after:h-4 after:w-4 after:-translate-x-1/2 after:-translate-y-1/2 after:rounded-sm after:border after:border-primary data-[state=checked]:bg-transparent data-[state=checked]:after:bg-primary [&>span]:relative [&>span]:z-10"
              />
              <span className="min-w-0">
                <span className="block text-xs font-semibold leading-tight text-foreground">Ad insights</span>
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">Meta and Snapchat ad results and purchase matching.</span>
              </span>
            </label>
          </div>
          <label className="mt-2 flex cursor-pointer items-center gap-2 rounded-xl border border-border/60 bg-background/55 p-2">
            <Checkbox
              checked={googleAdsAllowed}
              onCheckedChange={(checked) => setGoogleAdsAllowed(checked === true)}
              aria-label="Allow Google ad measurement"
              className="relative h-11 w-11 border-0 bg-transparent shadow-none after:absolute after:left-1/2 after:top-1/2 after:h-4 after:w-4 after:-translate-x-1/2 after:-translate-y-1/2 after:rounded-sm after:border after:border-primary data-[state=checked]:bg-transparent data-[state=checked]:after:bg-primary [&>span]:relative [&>span]:z-10"
            />
            <span className="min-w-0">
              <span className="block text-xs font-semibold text-foreground">Google ad measurement</span>
              <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">Measure Google ad clicks and shopping activity using advertising cookies and identifiers. Requires Website analytics. No personalized ads.</span>
            </span>
          </label>
      </div>
          <div className="grid shrink-0 grid-cols-2 gap-2 border-t border-border bg-card p-3 sm:px-4">
            <button
              type="button"
              onClick={useNecessaryOnly}
              className="h-11 whitespace-nowrap rounded-xl border border-border bg-background px-4 text-xs font-semibold text-foreground"
            >
              No thanks
            </button>
            <button
              type="button"
              onClick={saveChoices}
              className="nuvira-gradient-button h-11 whitespace-nowrap rounded-xl px-4 text-xs font-semibold"
            >
              Save
            </button>
          </div>
    </aside>
  );

  // Match the product purchase bar's portal so app stacking contexts cannot cover consent.
  return typeof document !== 'undefined' ? createPortal(banner, document.body) : banner;
}
