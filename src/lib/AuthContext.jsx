import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { base44 } from '@/api/base44Client';
import { appParams } from '@/lib/app-params';
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

const AuthContext = createContext();
const AUTH_BOOTSTRAP_TIMEOUT_MS = 4500;
const AUTH_EXPLICIT_TIMEOUT_MS = 10000;

function timeoutAfter(ms, code) {
  return new Promise((_, reject) => {
    globalThis.setTimeout(() => {
      const error = new Error(code);
      error.code = code;
      reject(error);
    }, ms);
  });
}

async function readCurrentUserWithTimeout(timeoutMs = AUTH_BOOTSTRAP_TIMEOUT_MS) {
  if (!timeoutMs || timeoutMs <= 0) {
    return base44.auth.me();
  }

  return Promise.race([
    base44.auth.me(),
    timeoutAfter(timeoutMs, 'auth_bootstrap_timeout'),
  ]);
}

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);
  const [isLoadingPublicSettings, setIsLoadingPublicSettings] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [appPublicSettings, setAppPublicSettings] = useState(null); // Contains only { id, public_settings }

  const checkUserAuth = useCallback(async ({ timeoutMs = AUTH_BOOTSTRAP_TIMEOUT_MS } = {}) => {
    try {
      consumeBase44AuthFromUrl();
      setIsLoadingAuth(true);
      setAuthError(null);
      const currentUser = await readCurrentUserWithTimeout(timeoutMs);
      setUser(currentUser);
      setIsAuthenticated(true);
      setAuthChecked(true);
      setIsLoadingAuth(false);
      return currentUser;
    } catch (error) {
      if (error?.code === 'auth_bootstrap_timeout') {
        console.warn('[AuthContext] Auth bootstrap timed out; continuing as public session.');
      }
      // For public apps, 401 is expected when user isn't logged in — don't treat as error.
      setUser(null);
      setIsAuthenticated(false);
      setAuthChecked(true);
      setIsLoadingAuth(false);
      return null;
    }
  }, []);

  const checkAppState = useCallback(async ({ authTimeoutMs = AUTH_BOOTSTRAP_TIMEOUT_MS } = {}) => {
    try {
      setIsLoadingPublicSettings(true);
      setAuthError(null);
      consumeBase44AuthFromUrl();
      
      // Skip app public settings check entirely for public apps
      // The app is already running, so it's accessible
      setAppPublicSettings({ id: appParams.appId, public_settings: {} });
      
      // Always ask Base44 for the current user. Some app/browser auth returns
      // establish an HTTP-only session without a token visible in localStorage.
      const currentUser = await checkUserAuth({ timeoutMs: authTimeoutMs });
      setIsLoadingPublicSettings(false);
      return currentUser;
    } catch (error) {
      console.error('Unexpected error:', error);
      setIsLoadingPublicSettings(false);
      setIsLoadingAuth(false);
      setAuthChecked(true);
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

    capacitorApp.addListener('appUrlOpen', async (event) => {
      const callbackResult = consumeNativeAuthCallbackUrl(event?.url);
      if (!callbackResult) return;

      try {
        const currentUser = await checkAppState({ authTimeoutMs: AUTH_EXPLICIT_TIMEOUT_MS });
        if (currentUser?.email) {
          replaceInAppRoute(callbackResult.returnTo || '/');
        }
      } catch (error) {
        console.warn('[AuthContext] Native auth callback failed', error?.message || 'unknown_error');
      }
    }).then((handle) => {
      if (!isMounted) {
        handle.remove();
        return;
      }
      listenerHandle = handle;
    }).catch((error) => {
      console.warn('[AuthContext] Native URL listener unavailable', error?.message || 'unknown_error');
    });

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
    setUser(null);
    setIsAuthenticated(false);
    
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

  const navigateToLogin = () => {
    redirectToLogin(`${window.location.pathname}${window.location.search || ''}${window.location.hash || ''}`);
  };

  const refreshUser = async () => {
    const currentUser = await readCurrentUserWithTimeout(AUTH_EXPLICIT_TIMEOUT_MS);
    setUser(currentUser);
    setIsAuthenticated(Boolean(currentUser));
    setAuthChecked(true);
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      isAuthenticated, 
      isLoadingAuth,
      authChecked,
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
