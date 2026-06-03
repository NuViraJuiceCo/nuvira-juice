import React from 'react';

const LOGO_URL = 'https://media.base44.com/images/public/69d48d0c39891f7945481152/b04d63077_Asset18322x.png';
const RECOVERY_SESSION_KEY = 'nuvira_native_recovery_attempted_at_v1';
const RECOVERY_COOLDOWN_MS = 60 * 1000;
const RECOVERY_QUERY_PARAM = 'native_reopen';
const LEGACY_STORAGE_KEYS = [
  'splashShown',
  'base44_access_token',
  'token',
  'base44_clear_access_token',
  'base44_app_base_url',
  'base44_functions_version',
  'base44_from_url',
];

function safelyRemoveItem(storage, key) {
  try {
    storage?.removeItem(key);
  } catch {
    // Storage can be unavailable in restricted native webview contexts.
  }
}

function safelyRemoveBase44Keys(storage) {
  try {
    if (!storage) return;
    const keys = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith('base44_')) keys.push(key);
    }
    keys.forEach((key) => storage.removeItem(key));
  } catch {
    // Best effort only. The recovery URL also asks Base44 auth to clear tokens.
  }
}

function clearNativeBootstrapState({ preserveRecoveryFlag = false } = {}) {
  if (typeof window === 'undefined') return;

  for (const key of LEGACY_STORAGE_KEYS) {
    safelyRemoveItem(window.localStorage, key);
    if (key !== RECOVERY_SESSION_KEY || !preserveRecoveryFlag) {
      safelyRemoveItem(window.sessionStorage, key);
    }
  }

  safelyRemoveBase44Keys(window.localStorage);
  safelyRemoveBase44Keys(window.sessionStorage);

  if (!preserveRecoveryFlag) {
    safelyRemoveItem(window.sessionStorage, RECOVERY_SESSION_KEY);
  }
}

function getFreshHomePath() {
  const params = new URLSearchParams();
  params.set(RECOVERY_QUERY_PARAM, String(Date.now()));
  params.set('clear_access_token', 'true');
  return `/?${params.toString()}`;
}

function navigateToFreshHome() {
  const target = getFreshHomePath();
  try {
    window.location.replace(target);
    window.setTimeout(() => window.location.reload(), 180);
  } catch {
    window.location.href = target;
  }
}

export default class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.warn('[AppErrorBoundary] App render failed', error?.message || 'unknown_error');
    this.scheduleAutomaticRecovery();
  }

  wasRecentlyRecovered() {
    try {
      const reopenAttempt = new URLSearchParams(window.location.search).get(RECOVERY_QUERY_PARAM);
      if (reopenAttempt) return true;

      const recoveredAt = Number(window.sessionStorage?.getItem(RECOVERY_SESSION_KEY) || 0);
      return recoveredAt > 0 && Date.now() - recoveredAt < RECOVERY_COOLDOWN_MS;
    } catch {
      return false;
    }
  }

  markRecoveryAttempt() {
    try {
      window.sessionStorage?.setItem(RECOVERY_SESSION_KEY, String(Date.now()));
    } catch {
      // Recovery still proceeds if sessionStorage is unavailable.
    }
  }

  scheduleAutomaticRecovery() {
    if (typeof window === 'undefined' || this.wasRecentlyRecovered()) return;

    this.markRecoveryAttempt();
    window.setTimeout(() => {
      clearNativeBootstrapState({ preserveRecoveryFlag: true });
      navigateToFreshHome();
    }, 80);
  }

  handleReload = () => {
    clearNativeBootstrapState();

    this.setState({ hasError: false }, () => {
      navigateToFreshHome();
    });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-6">
        <div className="w-full max-w-sm text-center">
          <img src={LOGO_URL} alt="NuVira Juice Company" className="mx-auto mb-6 h-9 opacity-90" />
          <div className="nuvira-premium-card rounded-3xl p-5">
            <h1 className="font-heading text-2xl font-bold">Opening NuVira</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              We are resetting the app session and opening a fresh home screen.
            </p>
            <button
              type="button"
              onClick={this.handleReload}
              className="nuvira-gradient-button mt-5 h-11 w-full rounded-2xl text-sm font-semibold"
            >
              Open NuVira
            </button>
          </div>
        </div>
      </div>
    );
  }
}
