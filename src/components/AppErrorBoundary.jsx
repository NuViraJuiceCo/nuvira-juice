import React from 'react';

const LOGO_URL = 'https://media.base44.com/images/public/69d48d0c39891f7945481152/b04d63077_Asset18322x.png';
const AUTH_SESSION_STORAGE_KEYS = [
  'base44_access_token',
  'token',
  'base44_clear_access_token',
  'base44_from_url',
];

function safeDispatchPopState() {
  try {
    window.dispatchEvent(new PopStateEvent('popstate'));
  } catch {
    try {
      window.dispatchEvent(new Event('popstate'));
    } catch {
      // Event dispatch is best effort only.
    }
  }
}

function replaceInAppRoute(route) {
  if (typeof window === 'undefined') return;
  try {
    window.history.replaceState({}, document.title, route);
    safeDispatchPopState();
  } catch {
    window.location.assign(route);
  }
}

function removeStorageItem(storage, key) {
  try {
    storage?.removeItem(key);
  } catch {
    // Storage can be unavailable in restricted native webview contexts.
  }
}

function resetAuthSessionStorage() {
  if (typeof window === 'undefined') return;
  for (const key of AUTH_SESSION_STORAGE_KEYS) {
    removeStorageItem(window.localStorage, key);
    removeStorageItem(window.sessionStorage, key);
  }
}

export default class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, errorClassification: null };
  }

  static getDerivedStateFromError() {
    return { hasError: true, errorClassification: 'render_error' };
  }

  componentDidCatch() {
    console.warn('[AppErrorBoundary] App render failed', 'render_error');
  }

  handleTryAgain = () => {
    this.setState({ hasError: false, errorClassification: null });
  };

  handleRestartApp = () => {
    replaceInAppRoute('/');
    this.setState({ hasError: false, errorClassification: null });
  };

  handleResetSignIn = () => {
    resetAuthSessionStorage();
    replaceInAppRoute('/native-login?return_to=%2Faccount&reset_sign_in=1');
    this.setState({ hasError: false, errorClassification: null });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-6" role="alert" aria-live="assertive">
        <div className="w-full max-w-sm text-center">
          <img src={LOGO_URL} alt="NuVira Juice Company" className="mx-auto mb-6 h-9 opacity-90" />
          <div className="nuvira-premium-card rounded-3xl p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">App recovery</p>
            <h1 className="font-heading mt-2 text-2xl font-bold">NuVira hit a loading issue</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              The app stopped loading safely. It will not keep refreshing or reset your sign-in unless you choose that option.
            </p>
            <div className="mt-5 space-y-3">
              <button
                type="button"
                onClick={this.handleTryAgain}
                className="nuvira-gradient-button h-11 w-full rounded-2xl text-sm font-semibold"
              >
                Try Again
              </button>
              <button
                type="button"
                onClick={this.handleRestartApp}
                className="h-11 w-full rounded-2xl border border-border bg-card text-sm font-semibold text-foreground"
              >
                Restart App
              </button>
              <button
                type="button"
                onClick={this.handleResetSignIn}
                className="h-11 w-full rounded-2xl border border-amber-300 bg-amber-50 text-sm font-semibold text-amber-900"
              >
                Reset Sign-In
              </button>
            </div>
            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
              If this keeps happening, contact NuVira support and mention app recovery.
            </p>
          </div>
        </div>
      </div>
    );
  }
}
