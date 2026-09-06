import React, { createContext, useState, useContext, useEffect, useCallback, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { base44 } from '@/api/base44Client';
import { appParams } from '@/lib/app-params';
import { createAuthSessionBoundary } from '@/lib/authQuerySession';
import { currentAuthOperation, isCurrentAuthOperation } from '@/lib/authOperation';
import { clearAllRewardsOnLogout } from '@/lib/rewardManager';
import {
  clearBase44AuthTokens,
  consumeBase44AuthFromUrl,
  consumeNativeAuthCallbackUrl,
  hasBase44AuthParamsInUrl,
  logoutInsideApp,
  redirectToLogin,
  replaceInAppRoute,
} from '@/lib/nativeAuthRedirect';
import {
  captureGoogleProviderAuthEvent,
  completeGoogleProviderAuthEvent,
  discardGoogleProviderAuthEvent,
} from '@/lib/googleAnalytics';
import {
  consumeMetaRegistrationEvent,
  trackMetaCompleteRegistration,
} from '@/lib/metaPixel';
import {
  consumeSnapRegistrationEvent,
  trackSnapSignUp,
} from '@/lib/snapPixel';

const AuthContext = createContext();
const AUTH_BOOTSTRAP_TIMEOUT_MS = 4500;
const AUTH_EXPLICIT_TIMEOUT_MS = 10000;

export const AUTH_BOOTSTRAP_STATES = {
  loading: 'loading',
  authenticated: 'authenticated',
  unauthenticated: 'unauthenticated',
  timeout: 'timeout',
  error: 'error',
};

function createAuthTimeoutError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

async function readCurrentUserWithTimeout(timeoutMs = AUTH_BOOTSTRAP_TIMEOUT_MS) {
  if (!timeoutMs || timeoutMs <= 0) {
    return base44.auth.me();
  }

  let timeoutId;
  try {
    return await Promise.race([
      base44.auth.me(),
      new Promise((_, reject) => {
        timeoutId = globalThis.setTimeout(() => {
          reject(createAuthTimeoutError('auth_bootstrap_timeout'));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      globalThis.clearTimeout(timeoutId);
    }
  }
}

function isExpectedUnauthenticatedError(error) {
  const status = error?.status || error?.response?.status;
  if (status === 401 || status === 403) return true;

  const message = String(error?.message || error || '').toLowerCase();
  return (
    message.includes('unauthorized') ||
    message.includes('not authenticated') ||
    message.includes('authentication required') ||
    message.includes('401') ||
    message.includes('403')
  );
}

function getSafeReturnPath() {
  if (typeof window === 'undefined') return '/';
  return `${window.location.pathname || '/'}${window.location.search || ''}${window.location.hash || ''}`;
}

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);
  const [bootstrapState, setBootstrapState] = useState(AUTH_BOOTSTRAP_STATES.loading);
  const [isLoadingPublicSettings, setIsLoadingPublicSettings] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [appPublicSettings, setAppPublicSettings] = useState(null); // Contains only { id, public_settings }
  const handledNativeAuthCallbacksRef = useRef(new Set());
  const [sessionBoundary] = useState(createAuthSessionBoundary);
  const [querySession, setQuerySession] = useState(sessionBoundary.getSession);
  const appStateRequestRef = useRef(0);

  const publishAuthUser = useCallback((currentUser, options = {}) => {
    setQuerySession(sessionBoundary.transition(currentUser, options));
    setUser(currentUser);
    setIsAuthenticated(Boolean(currentUser));
  }, [sessionBoundary]);

  const isCurrentAuthRead = useCallback((request, operation) => {
    if (!sessionBoundary.isCurrentRequest(request)) return false;
    if (isCurrentAuthOperation(operation)) return true;
    // A newer sign-in may be waiting on its provider and not have started me()
    // yet. Retire only this read's loading state, keeping the confirmed user.
    setIsLoadingAuth(false);
    setAuthChecked(true);
    setBootstrapState(sessionBoundary.getSession().identity
      ? AUTH_BOOTSTRAP_STATES.authenticated : AUTH_BOOTSTRAP_STATES.unauthenticated);
    return false;
  }, [sessionBoundary]);

  const checkUserAuth = useCallback(async ({ timeoutMs = AUTH_BOOTSTRAP_TIMEOUT_MS } = {}) => {
    const request = sessionBoundary.beginRequest();
    let operation = currentAuthOperation();
    const pendingProviderAuthEvent = captureGoogleProviderAuthEvent();
    try {
      consumeBase44AuthFromUrl();
      operation = currentAuthOperation();
      setIsLoadingAuth(true);
      setAuthError(null);
      setBootstrapState(AUTH_BOOTSTRAP_STATES.loading);
      const currentUser = await readCurrentUserWithTimeout(timeoutMs);
      if (!isCurrentAuthRead(request, operation)) return null;
      publishAuthUser(currentUser);
      setAuthChecked(true);
      setIsLoadingAuth(false);
      setBootstrapState(currentUser ? AUTH_BOOTSTRAP_STATES.authenticated : AUTH_BOOTSTRAP_STATES.unauthenticated);
      if (currentUser) {
        const providerEventCompleted = completeGoogleProviderAuthEvent(pendingProviderAuthEvent);
        if (providerEventCompleted && pendingProviderAuthEvent?.eventName === 'sign_up') {
          void trackMetaCompleteRegistration(pendingProviderAuthEvent.method);
          void trackSnapSignUp(pendingProviderAuthEvent.method, pendingProviderAuthEvent.token);
        }
        void consumeMetaRegistrationEvent();
        void consumeSnapRegistrationEvent();
      }
      return currentUser;
    } catch (error) {
      if (!isCurrentAuthRead(request, operation)) return null;
      discardGoogleProviderAuthEvent(pendingProviderAuthEvent);
      if (error?.code === 'auth_bootstrap_timeout') {
        console.warn('[AuthContext] Auth bootstrap timed out; continuing as public session.');
        setAuthError({
          type: 'bootstrap_timeout',
          message: 'NuVira could not confirm your sign-in before the app startup timeout.',
        });
        setBootstrapState(AUTH_BOOTSTRAP_STATES.timeout);
      } else if (isExpectedUnauthenticatedError(error)) {
        setAuthError(null);
        setBootstrapState(AUTH_BOOTSTRAP_STATES.unauthenticated);
      } else {
        console.warn('[AuthContext] Auth bootstrap failed', error?.message || 'unknown_error');
        setAuthError({
          type: 'bootstrap_error',
          message: 'NuVira could not verify your sign-in state.',
        });
        setBootstrapState(AUTH_BOOTSTRAP_STATES.error);
      }
      // For public apps, 401 is expected when user isn't logged in — don't treat as error.
      publishAuthUser(null);
      setAuthChecked(true);
      setIsLoadingAuth(false);
      return null;
    }
  }, [isCurrentAuthRead, publishAuthUser, sessionBoundary]);

  const checkAppState = useCallback(async ({ authTimeoutMs = AUTH_BOOTSTRAP_TIMEOUT_MS } = {}) => {
    const request = ++appStateRequestRef.current;
    try {
      setIsLoadingPublicSettings(true);
      setAuthError(null);
      
      // Skip app public settings check entirely for public apps
      // The app is already running, so it's accessible
      setAppPublicSettings({ id: appParams.appId, public_settings: {} });
      
      // Always ask Base44 for the current user. Some app/browser auth returns
      // establish an HTTP-only session without a token visible in localStorage.
      const currentUser = await checkUserAuth({ timeoutMs: authTimeoutMs });
      if (request !== appStateRequestRef.current) return null;
      setIsLoadingPublicSettings(false);
      return currentUser;
    } catch (error) {
      if (request !== appStateRequestRef.current) return null;
      console.error('Unexpected error:', error);
      setIsLoadingPublicSettings(false);
      setIsLoadingAuth(false);
      setAuthChecked(true);
      setBootstrapState(AUTH_BOOTSTRAP_STATES.error);
      setAuthError({
        type: 'bootstrap_error',
        message: 'NuVira could not finish startup.',
      });
      return null;
    }
  }, [checkUserAuth]);

  useEffect(() => {
    checkAppState();
  }, [checkAppState]);

  useEffect(() => {
    const capacitorApp = Capacitor.Plugins?.App;
    if (!Capacitor.isNativePlatform?.() || !capacitorApp?.addListener) return undefined;

    let listenerHandle = null;
    let isMounted = true;

    const registerListenerHandle = (handle) => {
      if (!handle?.remove) return;
      if (!isMounted) {
        handle.remove();
        return;
      }
      listenerHandle = handle;
    };

    const handleRegistrationError = (error) => {
      console.warn('[AuthContext] Native URL listener unavailable', error?.message || 'unknown_error');
    };

    try {
      const registration = capacitorApp.addListener('appUrlOpen', async (event) => {
        const callbackUrl = String(event?.url || '');
        if (!callbackUrl || handledNativeAuthCallbacksRef.current.has(callbackUrl)) return;

        handledNativeAuthCallbacksRef.current.add(callbackUrl);
        const operation = currentAuthOperation();
        const callbackResult = await consumeNativeAuthCallbackUrl(callbackUrl);
        if (!isCurrentAuthOperation(operation)) {
          handledNativeAuthCallbacksRef.current.delete(callbackUrl);
          return;
        }
        if (!callbackResult?.accessToken) {
          handledNativeAuthCallbacksRef.current.delete(callbackUrl);
          return;
        }

        try {
          if (Capacitor.isPluginAvailable('Browser')) {
            await Browser.close().catch(() => {});
          }
          if (!isCurrentAuthOperation(operation)) return;
          const currentUser = await checkAppState({ authTimeoutMs: AUTH_EXPLICIT_TIMEOUT_MS });
          if (!isCurrentAuthOperation(operation)) return;
          if (currentUser?.email) {
            replaceInAppRoute(callbackResult.returnTo || '/');
          }
        } catch (error) {
          console.warn('[AuthContext] Native auth callback failed', error?.message || 'unknown_error');
        }
      });

      if (registration && typeof registration.then === 'function') {
        registration.then(registerListenerHandle).catch(handleRegistrationError);
      } else {
        registerListenerHandle(registration);
      }
    } catch (error) {
      handleRegistrationError(error);
    }

    return () => {
      isMounted = false;
      listenerHandle?.remove();
    };
  }, [checkAppState]);

  useEffect(() => {
    const handlePossibleAuthReturn = () => {
      if (hasBase44AuthParamsInUrl()) {
        checkAppState();
      }
    };

    window.addEventListener('focus', handlePossibleAuthReturn);
    window.addEventListener('pageshow', handlePossibleAuthReturn);
    document.addEventListener('visibilitychange', handlePossibleAuthReturn);

    return () => {
      window.removeEventListener('focus', handlePossibleAuthReturn);
      window.removeEventListener('pageshow', handlePossibleAuthReturn);
      document.removeEventListener('visibilitychange', handlePossibleAuthReturn);
    };
  }, [checkAppState]);

  const needsOnboarding = () => {
    if (!user?.email) return false;
    // Check if user has completed profile setup
    const hasBasicInfo = user?.first_name && user?.last_name;
    return !hasBasicInfo;
  };

  const logout = async (shouldRedirect = true) => {
    const userEmail = user?.email;
    sessionBoundary.invalidateRequests();
    appStateRequestRef.current++;
    publishAuthUser(null, { force: true });
    setIsLoadingAuth(false);
    setIsLoadingPublicSettings(false);
    setAuthChecked(true);
    setAuthError(null);
    setBootstrapState(AUTH_BOOTSTRAP_STATES.unauthenticated);
    
    // Clear any stored rewards for this user
    if (userEmail) {
      clearAllRewardsOnLogout(userEmail);
    }
    
    if (shouldRedirect) {
      await logoutInsideApp('/account');
    } else {
      clearBase44AuthTokens();
    }
  };

  const navigateToLogin = (returnRoute = getSafeReturnPath()) => {
    redirectToLogin(returnRoute);
  };

  const refreshUser = async () => {
    const request = sessionBoundary.beginRequest();
    const operation = currentAuthOperation();
    try {
      setAuthError(null);
      const currentUser = await readCurrentUserWithTimeout(AUTH_EXPLICIT_TIMEOUT_MS);
      if (!isCurrentAuthRead(request, operation)) return null;
      publishAuthUser(currentUser);
      setAuthChecked(true);
      setIsLoadingAuth(false);
      setBootstrapState(currentUser ? AUTH_BOOTSTRAP_STATES.authenticated : AUTH_BOOTSTRAP_STATES.unauthenticated);
      return currentUser;
    } catch (error) {
      if (!isCurrentAuthRead(request, operation)) return null;
      if (isExpectedUnauthenticatedError(error)) publishAuthUser(null);
      setAuthChecked(true);
      setIsLoadingAuth(false);
      setBootstrapState(error?.code === 'auth_bootstrap_timeout' ? AUTH_BOOTSTRAP_STATES.timeout : AUTH_BOOTSTRAP_STATES.error);
      setAuthError({
        type: error?.code === 'auth_bootstrap_timeout' ? 'bootstrap_timeout' : 'bootstrap_error',
        message: 'NuVira could not refresh your sign-in state.',
      });
      throw error;
    }
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      sessionQueryClient: querySession.client,
      authSessionEpoch: querySession.epoch,
      isAuthenticated, 
      isLoadingAuth,
      authChecked,
      bootstrapState,
      isLoadingPublicSettings,
      authError,
      appPublicSettings,
      logout,
      navigateToLogin,
      checkAppState,
      checkUserAuth,
      refreshUser,
      needsOnboarding
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
