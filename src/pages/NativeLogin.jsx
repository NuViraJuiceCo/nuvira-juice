import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { AppLauncher } from '@capacitor/app-launcher';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  Apple,
  Eye,
  EyeOff,
  Lock,
  Mail,
  ShieldCheck,
  Sparkles,
  UserPlus,
} from 'lucide-react';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import {
  createEncryptedNativeAuthCallbackUrl,
  consumeNativeAuthCallbackUrl,
  getNativeBrowserProviderReturnUrl,
  getNativeProviderReturnUrl,
  getProviderLoginUrl,
  getStoredBase44Token,
  NATIVE_BROWSER_CALLBACK_MARKER,
  releaseNativeAuthViewport,
} from '@/lib/nativeAuthRedirect';
import { useAuth } from '@/lib/AuthContext';
import SEO from '@/components/SEO';
import {
  GUEST_LOYALTY_ACTIVATION_RETURN_ROUTE,
  readGuestLoyaltyActivationContext,
} from '@/lib/guestLoyaltyActivation';

const LOGO_URL = 'https://media.base44.com/images/public/69d48d0c39891f7945481152/b04d63077_Asset18322x.png';
const NativeWebAuth = registerPlugin('NativeWebAuth');
const IS_NATIVE_PLATFORM = Capacitor.isNativePlatform();
const HAS_NATIVE_WEB_AUTH = IS_NATIVE_PLATFORM && Capacitor.isPluginAvailable('NativeWebAuth');
const HAS_NATIVE_EXTERNAL_BROWSER = IS_NATIVE_PLATFORM && Capacitor.isPluginAvailable('AppLauncher');
const ENABLE_PROVIDER_BUTTONS = !IS_NATIVE_PLATFORM || HAS_NATIVE_WEB_AUTH || HAS_NATIVE_EXTERNAL_BROWSER;
const NATIVE_LOGIN_AUTH_TIMEOUT_MS = 10000;

function normalizeReturnRoute(value) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}

function errorMessage(error, fallback) {
  return error?.data?.message || error?.message || fallback;
}

function isEmailVerificationMessage(message) {
  if (!message) return false;
  const normalizedMessage = String(message).toLowerCase();
  return normalizedMessage.includes('verify')
    || normalizedMessage.includes('verification')
    || normalizedMessage.includes('otp')
    || normalizedMessage.includes('one-time')
    || normalizedMessage.includes('not confirmed')
    || normalizedMessage.includes('not verified');
}

export default function NativeLogin() {
  const navigate = useNavigate();
  const { checkAppState, isAuthenticated, user } = useAuth();
  const [searchParams] = useSearchParams();
  const returnTo = useMemo(
    () => normalizeReturnRoute(searchParams.get('return_to')),
    [searchParams]
  );
  const guestActivationContext = useMemo(() => readGuestLoyaltyActivationContext(), []);
  const isRewardsActivation = returnTo === GUEST_LOYALTY_ACTIVATION_RETURN_ROUTE;
  const isSignInReset = searchParams.get('reset_sign_in') === '1';
  const isNativeBrowserCallback = searchParams.get(NATIVE_BROWSER_CALLBACK_MARKER) === '1';

  const [mode, setMode] = useState(isRewardsActivation ? 'register' : 'login');
  const [email, setEmail] = useState(isRewardsActivation ? guestActivationContext?.customer_email || '' : '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [providerOpening, setProviderOpening] = useState('');
  const providerLaunchRef = useRef(false);
  const [statusText, setStatusText] = useState(() => (
    isSignInReset ? 'Sign-in was reset. Please sign in again.' : ''
  ));
  const [formError, setFormError] = useState('');

  const normalizedEmail = email.trim().toLowerCase();
  const isRegistering = mode === 'register';
  const isVerifying = mode === 'verify';

  const switchToVerifyMode = (message = 'Enter the verification code from your email.') => {
    setMode('verify');
    setOtpCode('');
    setStatusText(message);
    setFormError('');
  };

  const completeLogin = async () => {
    const currentUser = await checkAppState({ authTimeoutMs: NATIVE_LOGIN_AUTH_TIMEOUT_MS });
    if (!currentUser?.email) {
      throw new Error('Sign in succeeded, but the account could not be loaded.');
    }
    releaseNativeAuthViewport();
    navigate(returnTo, { replace: true });
  };

  useEffect(() => {
    if (isSignInReset) return;
    if (isAuthenticated && user?.email && !isNativeBrowserCallback) {
      releaseNativeAuthViewport();
      navigate(returnTo, { replace: true });
    }
  }, [isAuthenticated, isNativeBrowserCallback, isSignInReset, navigate, returnTo, user?.email]);

  useEffect(() => {
    if (IS_NATIVE_PLATFORM || !isNativeBrowserCallback) return;

    const accessToken = getStoredBase44Token();
    if (!accessToken) {
      setFormError('Sign-in returned without an authenticated NuVira session. Please try again.');
      return;
    }

    let cancelled = false;
    const returnToApp = async () => {
      try {
        const callbackUrl = await createEncryptedNativeAuthCallbackUrl(window.location.href, accessToken);
        if (!cancelled) window.location.replace(callbackUrl);
      } catch {
        if (!cancelled) {
          setFormError('Sign-in could not return securely to the NuVira app. Please try again.');
        }
      }
    };
    returnToApp();
    return () => {
      cancelled = true;
    };
  }, [isNativeBrowserCallback, returnTo]);

  const handleProviderLogin = async (provider) => {
    setStatusText('');
    setFormError('');

    if (!ENABLE_PROVIDER_BUTTONS) {
      const message = 'Update the NuVira app to use Apple or Google sign-in. Email sign-in remains available.';
      setStatusText(message);
      toast.info(message);
      return;
    }

    if (providerLaunchRef.current) return;
    providerLaunchRef.current = true;
    setProviderOpening(provider);

    try {
      if (IS_NATIVE_PLATFORM) {
        const callbackUrl = await getNativeBrowserProviderReturnUrl(returnTo);
        const providerUrl = getProviderLoginUrl(provider, callbackUrl);

        if (HAS_NATIVE_WEB_AUTH) {
          const result = await NativeWebAuth.authenticate({
            url: providerUrl,
            callbackScheme: 'nuvira',
          });
          const callbackResult = await consumeNativeAuthCallbackUrl(result?.callbackUrl || '');
          if (!callbackResult?.accessToken) {
            throw new Error('Secure sign-in returned without a valid NuVira session.');
          }
          const currentUser = await checkAppState({ authTimeoutMs: NATIVE_LOGIN_AUTH_TIMEOUT_MS });
          if (!currentUser?.email) {
            throw new Error('Sign in succeeded, but the account could not be loaded.');
          }
          releaseNativeAuthViewport();
          navigate(callbackResult.returnTo || returnTo, { replace: true });
          return;
        }

        const result = await AppLauncher.openUrl({ url: providerUrl });
        if (!result?.completed) throw new Error('Unable to open secure sign-in in your browser.');
        return;
      }

      base44.auth.loginWithProvider(provider, getNativeProviderReturnUrl(returnTo));
    } catch (error) {
      if (error?.code === 'AUTH_CANCELED') {
        setStatusText('Sign-in canceled.');
        return;
      }
      const message = errorMessage(error, `Unable to start ${provider} sign-in.`);
      console.warn('[NativeLogin] Provider sign-in failed', 'provider_window_unavailable');
      setFormError(message);
      toast.error(message);
    } finally {
      providerLaunchRef.current = false;
      setProviderOpening('');
    }
  };

  const handleLogin = async () => {
    const result = await base44.auth.loginViaEmailPassword(normalizedEmail, password);
    if (!result?.access_token) {
      throw new Error('Sign in did not return an access token.');
    }
    await completeLogin();
  };

  const handleRegister = async () => {
    if (password.length < 8) {
      throw new Error('Use at least 8 characters for your password.');
    }
    if (password !== confirmPassword) {
      throw new Error('Passwords do not match.');
    }

    await base44.auth.register({
      email: normalizedEmail,
      password,
    });

    try {
      await handleLogin();
      return;
    } catch {
      setMode('verify');
      setStatusText('Check your email for the verification code, then enter it here.');
    }
  };

  const handleVerify = async () => {
    if (!otpCode.trim()) {
      throw new Error('Enter the verification code from your email.');
    }
    const result = await base44.auth.verifyOtp({
      email: normalizedEmail,
      otpCode: otpCode.trim(),
    });
    if (result?.access_token) {
      base44.auth.setToken(result.access_token);
    }
    await handleLogin();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setStatusText('');
    setFormError('');

    if (!normalizedEmail || !password) {
      setFormError('Enter your email and password.');
      toast.error('Enter your email and password.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (isVerifying) {
        await handleVerify();
      } else if (isRegistering) {
        await handleRegister();
      } else {
        await handleLogin();
      }
    } catch (error) {
      const message = errorMessage(error, 'Unable to sign in.');
      console.warn('[NativeLogin] Sign in failed', message);
      if (!isRegistering && !isVerifying && isEmailVerificationMessage(message)) {
        switchToVerifyMode('Enter the verification code sent to your email, then sign in.');
        toast.info('Enter the verification code sent to your email.');
        return;
      }
      setFormError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResendOtp = async () => {
    if (!normalizedEmail) {
      toast.error('Enter your email first.');
      return;
    }
    setIsSubmitting(true);
    setFormError('');
    try {
      await base44.auth.resendOtp(normalizedEmail);
      setStatusText('A new verification code was sent to your email.');
    } catch (error) {
      const message = errorMessage(error, 'Unable to resend verification code.');
      setFormError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePasswordReset = async () => {
    if (!normalizedEmail) {
      toast.error('Enter your email first.');
      return;
    }
    setIsSubmitting(true);
    setFormError('');
    try {
      await base44.auth.resetPasswordRequest(normalizedEmail);
      setStatusText('Password reset instructions were sent to your email.');
    } catch (error) {
      const message = errorMessage(error, 'Unable to send password reset email.');
      setFormError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="min-h-screen bg-background px-5 py-6"
      style={{
        paddingTop: 'max(1.5rem, env(safe-area-inset-top))',
        background: 'radial-gradient(circle at 50% 0%, hsl(var(--primary) / 0.18), transparent 38%), hsl(var(--background))',
      }}
    >
      <SEO title="Sign In" noindex={true} />
      <button
        type="button"
        onClick={() => navigate('/', { replace: true })}
        className="mb-5 flex h-10 w-10 items-center justify-center rounded-full border border-border/60 bg-card/80 text-foreground shadow-sm"
        aria-label="Back to home"
      >
        <ArrowLeft className="h-4 w-4" />
      </button>

      <div className="mx-auto max-w-sm">
        <div className="mb-6 text-center">
          <img src={LOGO_URL} alt="NuVira Juice Company" className="mx-auto mb-5 h-8 opacity-90" />
          <div className="nuvira-icon-badge nuvira-brand-ring mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl shadow-sm">
            {isRegistering ? <UserPlus className="h-6 w-6" /> : isVerifying ? <ShieldCheck className="h-6 w-6" /> : <Sparkles className="h-6 w-6" />}
          </div>
          <h1 className="font-heading text-3xl font-bold tracking-tight">
            {isRewardsActivation && isRegistering
              ? 'Activate Your Points'
              : isRegistering ? 'Create Account' : isVerifying ? 'Verify Email' : 'Sign In'}
          </h1>
          <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">
            {isRewardsActivation && isRegistering
              ? guestActivationContext?.purchase_points > 0
                ? `Use your checkout email to access ${Number(guestActivationContext.purchase_points).toLocaleString()} purchase points, rewards, and order tracking.`
                : 'Use your checkout email to access your purchase points, rewards, and order tracking.'
              : isRegistering
                ? 'Create your NuVira account to order faster, earn rewards, and keep delivery details ready.'
              : isVerifying
                ? 'Enter the code sent to your email to finish securing your account.'
                : 'Access ordering, rewards, event check-in, and account details.'}
          </p>
          {isRewardsActivation && (
            <p className="mx-auto mt-3 max-w-xs rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-[11px] font-medium leading-relaxed text-primary">
              Your purchase is already recorded. Use the same email {guestActivationContext?.customer_email ? 'shown below' : 'you used at checkout'} so your order and points connect to one profile.
            </p>
          )}
        </div>

        <div className="mb-4 grid grid-cols-3 rounded-2xl border border-border/60 bg-card/70 p-1 shadow-sm">
          {[
            { key: 'login', label: 'Sign In' },
            { key: 'register', label: 'Join' },
            { key: 'verify', label: 'Verify' },
          ].map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => {
                setMode(item.key);
                setFormError('');
                setStatusText('');
              }}
              className={`h-10 rounded-xl text-xs font-semibold transition-colors ${
                mode === item.key
                  ? 'nuvira-gradient-button shadow-sm'
                  : 'text-muted-foreground'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="nuvira-premium-card mb-4 rounded-3xl border p-4 backdrop-blur">
          <div className="mb-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => handleProviderLogin('apple')}
              disabled={isSubmitting || Boolean(providerOpening)}
              className={`flex h-12 items-center justify-center gap-2 rounded-2xl border text-sm font-semibold transition-colors ${
                ENABLE_PROVIDER_BUTTONS
                  ? 'border-border bg-background text-foreground active:scale-[0.99]'
                  : 'border-border/60 bg-muted/35 text-muted-foreground'
              }`}
            >
              <Apple className="h-4 w-4" />
              {providerOpening === 'apple' ? 'Opening...' : 'Apple'}
            </button>
            <button
              type="button"
              onClick={() => handleProviderLogin('google')}
              disabled={isSubmitting || Boolean(providerOpening)}
              className={`flex h-12 items-center justify-center gap-2 rounded-2xl border text-sm font-semibold transition-colors ${
                ENABLE_PROVIDER_BUTTONS
                  ? 'border-border bg-background text-foreground active:scale-[0.99]'
                  : 'border-border/60 bg-muted/35 text-muted-foreground'
              }`}
            >
              <span className="flex h-4 w-4 items-center justify-center rounded-full border border-current text-[10px] font-bold">G</span>
              {providerOpening === 'google' ? 'Opening...' : 'Google'}
            </button>
          </div>

          {!ENABLE_PROVIDER_BUTTONS && (
            <p className="mb-4 rounded-2xl border border-nuvira bg-nuvira-gradient-soft px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
              Apple and Google sign-in require the latest NuVira app. Email sign-in remains available.
            </p>
          )}

          <div className="mb-4 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Email</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Email</span>
            <span className="flex h-12 items-center gap-3 rounded-xl border border-border bg-card px-3">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoCapitalize="none"
                autoComplete="email"
                className="min-w-0 flex-1 bg-transparent text-base outline-none md:text-sm"
                placeholder="you@example.com"
              />
            </span>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Password</span>
            <span className="flex h-12 items-center gap-3 rounded-xl border border-border bg-card px-3">
              <Lock className="h-4 w-4 text-muted-foreground" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={isRegistering ? 'new-password' : 'current-password'}
                className="min-w-0 flex-1 bg-transparent text-base outline-none md:text-sm"
                placeholder="Password"
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </span>
          </label>

          {isRegistering && (
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Confirm Password</span>
              <span className="flex h-12 items-center gap-3 rounded-xl border border-border bg-card px-3">
                <Lock className="h-4 w-4 text-muted-foreground" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  autoComplete="new-password"
                  className="min-w-0 flex-1 bg-transparent text-base outline-none md:text-sm"
                  placeholder="Confirm password"
                />
              </span>
            </label>
          )}

          {isVerifying && (
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Verification Code</span>
              <input
                type="text"
                inputMode="numeric"
                value={otpCode}
                onChange={(event) => setOtpCode(event.target.value)}
                autoComplete="one-time-code"
                className="h-12 w-full rounded-xl border border-border bg-card px-3 text-center text-lg font-semibold tracking-[0.25em] outline-none"
                placeholder="000000"
              />
            </label>
          )}

          {statusText && (
            <p className="rounded-xl border border-nuvira bg-nuvira-gradient-soft px-3 py-2 text-xs leading-relaxed text-primary">
              {statusText}
            </p>
          )}

          {formError && (
            <div className="flex gap-2 rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs leading-relaxed text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
              <p>{formError}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="nuvira-gradient-button h-12 w-full rounded-2xl text-sm font-semibold disabled:opacity-60"
          >
            {isSubmitting
              ? 'Please wait...'
              : isRegistering
                ? isRewardsActivation ? 'Activate My Points' : 'Create Account'
                : isVerifying
                  ? 'Verify and Sign In'
                  : 'Sign In'}
          </button>
          </form>
        </div>

        <div className="mt-5 flex flex-col items-center gap-3 text-xs">
          {!isVerifying && (
            <>
              <button
                type="button"
                onClick={() => {
                  setMode(isRegistering ? 'login' : 'register');
                  setFormError('');
                  setStatusText('');
                }}
                className="font-semibold text-primary"
              >
                {isRegistering ? 'Already have an account? Sign in' : 'New to NuVira? Create an account'}
              </button>
              <button
                type="button"
                onClick={() => switchToVerifyMode()}
                className="text-muted-foreground underline underline-offset-4"
              >
                I have a verification code
              </button>
            </>
          )}
          {isVerifying ? (
            <button type="button" onClick={handleResendOtp} className="font-semibold text-primary">
              Resend verification code
            </button>
          ) : (
            <button type="button" onClick={handlePasswordReset} className="text-muted-foreground underline underline-offset-4">
              Forgot password?
            </button>
          )}
        </div>

        <div className="nuvira-premium-card mt-8 rounded-2xl border p-3 text-center">
          <p className="text-[11px] font-semibold text-foreground">Secure NuVira account access</p>
          <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
            Your orders, rewards, event check-ins, and admin tools stay inside the app session.
          </p>
        </div>
      </div>
    </div>
  );
}
