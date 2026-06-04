import React from 'react';

const LOGO_URL = 'https://media.base44.com/images/public/69d48d0c39891f7945481152/b04d63077_Asset18322x.png';
const RECOVERY_SESSION_KEY = 'nuvira_native_recovery_attempted_at_v1';
const RECOVERY_COUNT_KEY = 'nuvira_native_recovery_attempt_count_v1';
const MAX_IMMEDIATE_RECOVERY_ATTEMPTS = 3;
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
    safelyRemoveItem(window.sessionStorage, RECOVERY_COUNT_KEY);
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

  getRecoveryAttemptCount() {
    try {
      return Number(window.sessionStorage?.getItem(RECOVERY_COUNT_KEY) || 0);
    } catch {
      return 0;
    }
  }

  markRecoveryAttempt() {
    try {
      const nextCount = this.getRecoveryAttemptCount() + 1;
      window.sessionStorage?.setItem(RECOVERY_SESSION_KEY, String(Date.now()));
      window.sessionStorage?.setItem(RECOVERY_COUNT_KEY, String(nextCount));
      return nextCount;
    } catch {
      // Recovery still proceeds if sessionStorage is unavailable.
      return 1;
    }
  }

  scheduleAutomaticRecovery() {
    if (typeof window === 'undefined') return;

    const attemptCount = this.markRecoveryAttempt();
    window.setTimeout(() => {
      clearNativeBootstrapState({
        preserveRecoveryFlag: attemptCount < MAX_IMMEDIATE_RECOVERY_ATTEMPTS,
      });
      navigateToFreshHome();
    }, 0);
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-6" aria-label="Loading NuVira">
        <img src={LOGO_URL} alt="NuVira Juice Company" className="h-10 opacity-85" />
      </div>
    );
  }
}
