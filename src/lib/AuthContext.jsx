import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
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
} from '@/lib/nativeAuthRedirect';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);
  const [isLoadingPublicSettings, setIsLoadingPublicSettings] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [appPublicSettings, setAppPublicSettings] = useState(null); // Contains only { id, public_settings }

  const checkUserAuth = useCallback(async () => {
    try {
      consumeBase44AuthFromUrl();
      setIsLoadingAuth(true);
      setAuthError(null);
      const currentUser = await base44.auth.me();
      setUser(currentUser);
      setIsAuthenticated(true);
      setAuthChecked(true);
      setIsLoadingAuth(false);
      return currentUser;
    } catch (error) {
      // For public apps, 401 is expected when user isn't logged in — don't treat as error.
      setUser(null);
      setIsAuthenticated(false);
      setAuthChecked(true);
      setIsLoadingAuth(false);
      return null;
    }
  }, []);

  const checkAppState = useCallback(async () => {
    try {
      setIsLoadingPublicSettings(true);
      setAuthError(null);
      consumeBase44AuthFromUrl();
      
      // Skip app public settings check entirely for public apps
      // The app is already running, so it's accessible
      setAppPublicSettings({ id: appParams.appId, public_settings: {} });
      
      // Always ask Base44 for the current user. Some app/browser auth returns
      // establish an HTTP-only session without a token visible in localStorage.
      const currentUser = await checkUserAuth();
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
    if (!Capacitor.isNativePlatform?.()) return undefined;

    let listenerHandle = null;
    let isMounted = true;

    CapacitorApp.addListener('appUrlOpen', async (event) => {
      const callbackResult = consumeNativeAuthCallbackUrl(event?.url);
      if (!callbackResult) return;

      try {
        const currentUser = await checkAppState();
        if (currentUser?.email) {
          window.location.replace(callbackResult.returnTo);
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
    const currentUser = await base44.auth.me();
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
