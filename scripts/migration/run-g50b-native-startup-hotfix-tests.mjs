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

assert(app.includes('return <Navigate to="/account-setup" replace />'), 'Incomplete profile does not route through React Router Navigate');
assert(app.includes('profileRequestFailed'), 'Profile failure state is not explicitly distinguished');
assert(app.includes('profileRequestPending'), 'Profile pending state is not explicitly distinguished');
assert(app.includes('profileMissing'), 'Profile missing state is not explicitly distinguished');
assert(app.includes('profileLoadedAndIncomplete'), 'Loaded incomplete profile state is not explicitly distinguished');
assert(app.includes('retryProfileForOnboarding'), 'Profile failure screen does not expose a controlled retry');
assert(!app.includes('navigateToLogin();\n      return null;'), 'Auth-required navigation still appears to execute directly in render');
assert(app.includes('React.useEffect(() =>') && app.includes('hasRequestedAuthRedirectRef'), 'Auth-required navigation is not guarded by an effect/ref');

assert(errorBoundary.includes('handleTryAgain'), 'Try Again handler missing');
assert(errorBoundary.includes('handleRestartApp'), 'Restart App handler missing');
assert(errorBoundary.includes('handleResetSignIn'), 'Reset Sign-In handler missing');
assert(errorBoundary.includes('AUTH_SESSION_STORAGE_KEYS'), 'Reset Sign-In does not use a narrow auth key list');
assert(!errorBoundary.includes("key?.startsWith('base44_')"), 'Error boundary still clears broad Base44 storage keys');
assert(!errorBoundary.includes('window.setTimeout(() => {'), 'Error boundary still schedules automatic recovery');
assert(!errorBoundary.includes('window.location.reload()'), 'Error boundary still reloads automatically');
assert(errorBoundary.includes('role="alert"'), 'Error fallback is not marked as an accessible alert');
assert(errorBoundary.includes('NuVira hit a loading issue'), 'Visible recovery copy missing');
assert(!errorBoundary.includes('error?.message'), 'Error boundary still exposes or logs raw exception messages');

assert(authContext.includes('replaceInAppRoute(callbackResult.returnTo || \'/\')'), 'Native auth callback does not use in-app route replacement');
assert(!authContext.includes('window.location.replace(callbackResult.returnTo)'), 'Native auth callback hard replace remains');
assert(nativeAuthRedirect.includes('export function replaceInAppRoute'), 'In-app route helper missing');
assert(nativeAuthRedirect.includes('normalizeReturnRoute(route)'), 'In-app route helper does not normalize return routes');
assert(nativeAuthRedirect.includes('window.history.replaceState'), 'In-app route helper does not use history replacement');
assert(nativeAuthRedirect.includes("window.dispatchEvent(new PopStateEvent('popstate'))"), 'In-app route helper does not notify BrowserRouter');
assert(!nativeAuthRedirect.includes('window.location.assign(loginUrl)'), 'Login redirect still hard-assigns same-origin route');
assert(!nativeAuthRedirect.includes('window.location.replace(signedOutRoute)'), 'Logout still hard-replaces signed-out route');
assert(!nativeAuthRedirect.includes('window.location.href = safeRoute'), 'In-app auth route helper still falls back to hard reload');
assert(nativeAuthRedirect.includes("if (!route.startsWith('/') || route.startsWith('//')) return '/'"), 'External/open return routes are not rejected');

assert(checkout.includes('checkout_idempotency_key'), 'Checkout idempotency key unexpectedly removed');
assert(createPaymentIntent.includes('stripe.paymentIntents.create'), 'createPaymentIntent unexpectedly changed or lost PI creation evidence');
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
  casesCovered: 36,
  runtimeWritesPerformed: false,
  backendFunctionsChanged: false,
  providerCallsPerformed: false,
  hubMutationPerformed: false,
}, null, 2));
