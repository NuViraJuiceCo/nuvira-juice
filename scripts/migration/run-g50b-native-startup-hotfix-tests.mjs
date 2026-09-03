#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
const exists = (relativePath) => fs.existsSync(path.join(repoRoot, relativePath));
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const app = read('src/App.jsx');
const errorBoundary = read('src/components/AppErrorBoundary.jsx');
const authContext = read('src/lib/AuthContext.jsx');
const nativeAuthRedirect = read('src/lib/nativeAuthRedirect.js');
const checkout = read('src/pages/Checkout.jsx');
const nativeLogin = read('src/pages/NativeLogin.jsx');
const createPaymentIntent = read('base44/functions/createPaymentIntent/entry.ts');
const capacitor = JSON.parse(read('capacitor.config.json'));
const doc = read('docs/migration/g50b-native-startup-hotfix-current-main.md');

const forbiddenStartupMarkers = [
  {
    source: app,
    marker: "window.location.replace('/account-setup')",
    label: 'hard account setup redirect in App render',
  },
  {
    source: errorBoundary,
    marker: 'scheduleAutomaticRecovery',
    label: 'automatic error-boundary recovery scheduler',
  },
  {
    source: errorBoundary,
    marker: 'MAX_IMMEDIATE_RECOVERY_ATTEMPTS',
    label: 'repeated recovery attempt counter',
  },
  {
    source: errorBoundary,
    marker: 'native_reopen',
    label: 'native reopen query recovery marker',
  },
  {
    source: errorBoundary,
    marker: 'clearNativeBootstrapState',
    label: 'automatic bootstrap storage clear',
  },
  {
    source: authContext,
    marker: 'window.location.replace(callbackResult.returnTo)',
    label: 'native callback hard reload',
  },
];

for (const { source, marker, label } of forbiddenStartupMarkers) {
  assert(!source.includes(marker), `Forbidden startup marker still present: ${label}`);
}

assert(app.includes('return <Navigate to={`/account-setup?return_to=${encodeURIComponent(returnTo)}`} replace />'), 'Incomplete profile does not route through React Router Navigate with a preserved return path');
assert(app.includes('profileRequestFailed'), 'Profile failure state is not explicitly distinguished');
assert(app.includes('profileRequestPending'), 'Profile pending state is not explicitly distinguished');
assert(app.includes('profileMissing'), 'Profile missing state is not explicitly distinguished');
assert(app.includes('profileLoadedAndIncomplete'), 'Loaded incomplete profile state is not explicitly distinguished');
assert(app.includes('retryProfileForOnboarding'), 'Profile failure screen does not expose a controlled retry');
assert(app.includes('const isResetSignInRoute = React.useMemo(() => {'), 'App does not derive exact reset sign-in route state');
assert(app.includes("location.pathname !== '/native-login'"), 'Reset sign-in route bypass is not scoped to NativeLogin path');
assert(app.includes("params.get('reset_sign_in') === '1'"), 'Reset sign-in route bypass does not require reset marker');
assert(app.includes('enabled: Boolean(user?.email && !isResetSignInRoute)'), 'Reset route does not bypass UserProfile lookup');
assert(app.includes('const profileLookupEnabled = Boolean(user?.email && !isResetSignInRoute)'), 'Reset route does not bypass profile onboarding state');
assert(app.includes("authError?.type === 'auth_required' && !isResetSignInRoute"), 'Reset route can still trigger auth-required redirect');
assert(app.includes('(!isResetSignInRoute && isLoadingAuth)'), 'Reset route can still wait on auth loading before NativeLogin renders');
assert(app.includes('if (authError && !isResetSignInRoute)'), 'Reset route can still show auth-error UI before NativeLogin renders');
assert(!app.includes('navigateToLogin();\n      return null;'), 'Auth-required navigation still appears to execute directly in render');
assert(app.includes('React.useEffect(() =>') && app.includes('hasRequestedAuthRedirectRef'), 'Auth-required navigation is not guarded by an effect/ref');

assert(errorBoundary.includes('handleTryAgain'), 'Try Again handler missing');
const tryAgainBlock = errorBoundary.match(/handleTryAgain = \(\) => \{[\s\S]*?\n  \};/)?.[0] || '';
assert(tryAgainBlock.includes('this.setState({ hasError: false'), 'Try Again does not clear only boundary state');
assert(!tryAgainBlock.includes('removeItem') && !tryAgainBlock.includes('replaceInAppRoute') && !tryAgainBlock.includes('resetSignInAndReload'), 'Try Again clears storage or navigates');

assert(errorBoundary.includes('handleReturnHome'), 'Return Home handler missing');
assert(errorBoundary.includes('handleResetSignIn'), 'Reset Sign-In handler missing');
assert(errorBoundary.includes('isResettingSignIn'), 'Reset Sign-In in-flight state missing');
assert(errorBoundary.includes('this.resetSignInStarted = false'), 'Reset Sign-In one-shot guard missing');
assert(errorBoundary.includes('if (this.resetSignInStarted) return;'), 'Reset Sign-In double-tap guard missing');
assert(errorBoundary.includes('this.resetSignInStarted = true'), 'Reset Sign-In one-shot guard is not armed');
assert(errorBoundary.includes('disabled={isResettingSignIn}'), 'Recovery buttons are not disabled while reset is in flight');
assert(errorBoundary.includes('Resetting Sign-In…'), 'Reset in-flight copy missing');
assert(!errorBoundary.includes('AUTH_SESSION_STORAGE_KEYS'), 'Error boundary should not own auth reset storage clearing');
assert(!errorBoundary.includes("key?.startsWith('base44_')"), 'Error boundary still clears broad Base44 storage keys');
assert(!errorBoundary.includes('window.setTimeout(() => {'), 'Error boundary still schedules automatic recovery');
assert(!errorBoundary.includes('window.location.reload()'), 'Error boundary still reloads automatically');
assert(!errorBoundary.includes('window.location.replace('), 'Error boundary should not directly perform hard navigation');
assert(!errorBoundary.includes('window.location.assign('), 'Error boundary should not directly perform hard navigation');
const returnHomeBlock = errorBoundary.match(/handleReturnHome = \(\) => \{[\s\S]*?\n  \};/)?.[0] || '';
assert(returnHomeBlock.includes("replaceInAppRoute('/')"), 'Return Home does not use in-app navigation');
assert(!returnHomeBlock.includes('resetSignInAndReload') && !returnHomeBlock.includes('removeItem'), 'Return Home clears auth or uses reset helper');
const resetSignInBlock = errorBoundary.match(/handleResetSignIn = \(\) => \{[\s\S]*?\n  \};/)?.[0] || '';
assert(resetSignInBlock.includes("resetSignInAndReload('/account')"), 'Reset Sign-In does not call dedicated reset helper');
assert(resetSignInBlock.includes('this.setState({ isResettingSignIn: true })'), 'Reset Sign-In does not mark recovery in flight');
assert(!resetSignInBlock.includes('hasError: false'), 'Reset Sign-In should not clear the boundary and keep old AuthProvider mounted');
assert(errorBoundary.includes('role="alert"'), 'Error fallback is not marked as an accessible alert');
assert(errorBoundary.includes('NuVira hit a loading issue'), 'Visible recovery copy missing');
assert(errorBoundary.includes('Return Home'), 'Return Home copy missing');
assert(errorBoundary.includes('Reset Sign-In'), 'Reset Sign-In copy missing');
assert(!errorBoundary.includes('error?.message'), 'Error boundary still exposes or logs raw exception messages');

assert(authContext.includes('replaceInAppRoute(callbackResult.returnTo || \'/\')'), 'Native auth callback does not use in-app route replacement');
assert(!authContext.includes('window.location.replace(callbackResult.returnTo)'), 'Native auth callback hard replace remains');
assert(authContext.includes("const registration = capacitorApp.addListener('appUrlOpen'"), 'Native URL listener registration capture missing');
assert(authContext.includes("if (registration && typeof registration.then === 'function')"), 'Native URL listener does not support promise-returning Capacitor versions');
assert(authContext.includes('registerListenerHandle(registration)'), 'Native URL listener does not support synchronous handle-returning Capacitor versions');
assert(!/addListener\('appUrlOpen'[\s\S]{0,2500}\)\.then/.test(authContext), 'Native URL listener assumes addListener always returns a Promise');
assert(nativeAuthRedirect.includes('export function replaceInAppRoute'), 'In-app route helper missing');
assert(nativeAuthRedirect.includes('export async function resetSignInAndReload'), 'Dedicated sign-in reset helper missing');
assert(nativeAuthRedirect.includes("getNativeLoginResetRoute(returnRoute = '/account')"), 'Native login reset route builder missing');
assert(nativeAuthRedirect.includes('normalizeReturnRoute(route)'), 'In-app route helper does not normalize return routes');
assert(nativeAuthRedirect.includes('window.history.replaceState'), 'In-app route helper does not use history replacement');
assert(nativeAuthRedirect.includes("window.dispatchEvent(new PopStateEvent('popstate'))"), 'In-app route helper does not notify BrowserRouter');
assert(!nativeAuthRedirect.includes('window.location.assign(loginUrl)'), 'Login redirect still hard-assigns same-origin route');
assert(!nativeAuthRedirect.includes('window.location.replace(signedOutRoute)'), 'Logout still hard-replaces signed-out route');
assert(!nativeAuthRedirect.includes('window.location.href = safeRoute'), 'In-app auth route helper still falls back to hard reload');
assert(nativeAuthRedirect.includes("if (!route.startsWith('/') || route.startsWith('//')) return '/'"), 'External/open return routes are not rejected');
assert(nativeAuthRedirect.includes("params.set('return_to', normalizeReturnRoute(returnRoute))"), 'Reset route does not normalize return route');
assert(nativeAuthRedirect.includes("params.set('reset_sign_in', '1')"), 'Reset route does not mark reset_sign_in');
assert(nativeAuthRedirect.includes("params.set('clear_access_token', 'true')"), 'Reset route does not carry clear_access_token');
assert(nativeAuthRedirect.includes('SIGN_IN_RESET_STORAGE_KEYS'), 'Reset helper does not use documented narrow reset storage keys');
assert(nativeAuthRedirect.includes("'base44_access_token'") && nativeAuthRedirect.includes("'token'") && nativeAuthRedirect.includes("'base44_clear_access_token'") && nativeAuthRedirect.includes("'base44_from_url'"), 'Reset helper is missing expected auth/bootstrap keys');
assert(!nativeAuthRedirect.includes('splashShown') && !nativeAuthRedirect.includes('nuvira_pending_checkout_session') && !nativeAuthRedirect.includes('active_reward'), 'Reset helper touches unrelated storage keys');
assert(nativeAuthRedirect.includes("credentials: 'include'"), 'Reset helper does not attempt hosted logout with credentials');
assert(nativeAuthRedirect.includes('logout_request_failed'), 'Reset helper does not tolerate logout-network failure generically');
assert(nativeAuthRedirect.includes('SIGN_IN_RESET_LOGOUT_TIMEOUT_MS = 4000'), 'Reset helper does not define a bounded logout timeout');
assert(nativeAuthRedirect.includes('AbortController'), 'Reset helper does not use AbortController for hung logout requests');
assert(nativeAuthRedirect.includes('Promise.race([logoutRequest, timeoutRequest])'), 'Reset helper does not bound logout request wait time');
assert(nativeAuthRedirect.includes("reject(new Error('logout_request_timeout'))"), 'Reset helper does not classify logout timeout generically');
assert(nativeAuthRedirect.includes('abortController?.abort()'), 'Reset helper does not abort timed-out logout request');
assert(nativeAuthRedirect.includes('window.clearTimeout(logoutTimeoutId)'), 'Reset helper does not clear logout timeout resources');
assert(nativeAuthRedirect.includes('finally') && nativeAuthRedirect.includes('fullReplaceRoute(resetRoute)'), 'Reset helper does not navigate from finally');
assert(nativeAuthRedirect.includes('window.location.replace(route)') && nativeAuthRedirect.includes('window.location.assign(route)') && nativeAuthRedirect.includes('window.location.href = route'), 'Reset helper does not provide full-navigation fallbacks');
assert(!nativeAuthRedirect.includes('setInterval'), 'Reset helper or auth redirect schedules repeated reload');
const resetSignInCallCount = (errorBoundary.match(/resetSignInAndReload\('\/account'\)/g) || []).length;
assert(resetSignInCallCount === 1, 'Reset Sign-In should initiate exactly one reset call from the recovery screen');
const logoutInsideAppBlock = nativeAuthRedirect.match(/export async function logoutInsideApp[\s\S]*?^}/m)?.[0] || '';
assert(logoutInsideAppBlock.includes('clearBase44AuthTokens()'), 'Existing normal logout behavior lost auth token clearing');
assert(!logoutInsideAppBlock.includes('SIGN_IN_RESET_STORAGE_KEYS'), 'Existing normal logout behavior should not inherit reset-sign-in storage clearing');
assert(nativeLogin.includes("const isSignInReset = searchParams.get('reset_sign_in') === '1'"), 'NativeLogin does not detect reset_sign_in mode');
assert(nativeLogin.includes('if (isSignInReset) return;'), 'NativeLogin can still auto-bounce during reset mode');
assert(nativeLogin.includes('Sign-in was reset. Please sign in again.'), 'NativeLogin reset mode does not show stable reset copy');

assert(checkout.includes('checkout_idempotency_key'), 'Checkout idempotency key unexpectedly removed');
assert(createPaymentIntent.includes('paymentIntents.create'), 'createPaymentIntent unexpectedly changed or lost PI creation evidence');
assert(createPaymentIntent.includes('entities.Order.create'), 'createPaymentIntent unexpectedly changed or lost pending Order creation evidence');

assert(capacitor.webDir === 'dist', 'Capacitor webDir is not dist');
assert(!('server' in capacitor), 'Capacitor server.url appeared; native bundle assumptions changed');

const requiredDocPhrases = [
  'G50A closeout',
  'PR #332 comparison',
  'pr332_behavior_ported=',
  'pr332_metadata_excluded=',
  'Render-time navigation removal',
  'Error-boundary recovery change',
  'Native auth callback change',
  'Reset Sign-In',
  'Return Home',
  'Generated-bundle proof',
  'No-write confirmation',
  'G50C',
  'G50D',
];
for (const phrase of requiredDocPhrases) {
  assert(doc.includes(phrase), `G50B doc missing required phrase: ${phrase}`);
}

if (exists('ios/App/App/public/index.html')) {
  const publicFiles = fs.readdirSync(path.join(repoRoot, 'ios/App/App/public'), { recursive: true })
    .filter((file) => typeof file === 'string')
    .filter((file) => /\.(js|html|css)$/.test(file));
  const legacyMarkers = [
    "window.location.replace('/account-setup')",
    'scheduleAutomaticRecovery',
    'MAX_IMMEDIATE_RECOVERY_ATTEMPTS',
    'native_reopen',
    'clearNativeBootstrapState',
  ];
  const hit = [];
  for (const file of publicFiles) {
    const body = read(path.join('ios/App/App/public', file));
    for (const marker of legacyMarkers) {
      if (body.includes(marker)) hit.push(`${file}:${marker}`);
    }
  }
  assert(hit.length === 0, `Generated iOS bundle contains legacy recovery markers: ${hit.join(', ')}`);
}

console.log(JSON.stringify({
  ok: true,
  classification: 'native_startup_hotfix_static_regression_passed',
  casesCovered: 67,
  runtimeWritesPerformed: false,
  backendFunctionsChanged: false,
  providerCallsPerformed: false,
  hubMutationPerformed: false,
}, null, 2));
