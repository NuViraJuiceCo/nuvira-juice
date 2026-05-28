import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { appParams } from '@/lib/app-params';
import { clearAllRewardsOnLogout } from '@/lib/rewardManager';
import {
  consumeBase44AuthFromUrl,
  hasBase44AuthParamsInUrl,
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

  const logout = (shouldRedirect = true) => {
    const userEmail = user?.email;
    setUser(null);
    setIsAuthenticated(false);
    
    // Clear any stored rewards for this user
    if (userEmail) {
      clearAllRewardsOnLogout(userEmail);
    }
    
    if (shouldRedirect) {
      // Use the SDK's logout method which handles token cleanup and redirect
      base44.auth.logout(window.location.href);
    } else {
      // Just remove the token without redirect
      base44.auth.logout();
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
