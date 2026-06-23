#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const docPath = 'docs/migration/g50a-application-reliability-architecture-release-audit.md';
const doc = read(docPath);

const requiredDocPhrases = [
  'Classification: `application_reliability_release_control_audit_pr_ready`',
  'Executive root cause',
  'Current architecture map',
  'P0 defect registry',
  'P1 defect registry',
  'UX and accessibility defect matrix',
  'Native/web divergence matrix',
  'Backend, Hub, and source-of-truth matrix',
  'First 10 stabilization PRs in exact order',
  'Exact first hotfix',
  'Exact first architectural rewrite',
  'Release gate checklist',
  'Definition of done for app stabilization',
  'No-write confirmation',
  'PR #332',
  'G50B must be the first hotfix',
  'G50E must be the first architectural rewrite',
  'No App Store archive from an unmerged branch',
  'Production Apple Pay payment confirmation remains blocked',
];

for (const phrase of requiredDocPhrases) {
  assert(doc.includes(phrase), `G50A audit doc missing required phrase: ${phrase}`);
}

const app = read('src/App.jsx');
assert(app.includes("window.location.replace('/account-setup')"), 'Expected current main startup redirect evidence is missing from src/App.jsx');
assert(app.includes('const ProtectedRoute = ({ element, user })'), 'Expected inline ProtectedRoute evidence is missing from src/App.jsx');
assert(app.includes('base44.entities.UserProfile.filter({ customer_email: user.email })'), 'Expected email-based UserProfile lookup evidence is missing from src/App.jsx');

const boundary = read('src/components/AppErrorBoundary.jsx');
assert(boundary.includes("window.location.replace(target)") || boundary.includes('window.location.assign(target)'), 'Expected hard navigation evidence is missing from AppErrorBoundary');
assert(boundary.includes('window.location.reload()'), 'Expected reload evidence is missing from AppErrorBoundary');
assert(boundary.includes("startsWith('base44_')"), 'Expected Base44 storage-clearing evidence is missing from AppErrorBoundary');

const auth = read('src/lib/AuthContext.jsx');
assert(auth.includes('window.location.replace(callbackResult.returnTo)'), 'Expected native auth hard replace evidence is missing from AuthContext');
assert(auth.includes('document.addEventListener(\'visibilitychange\''), 'Expected visibility auth refresh evidence is missing from AuthContext');
assert(auth.includes('const hasBasicInfo = user?.first_name && user?.last_name'), 'Expected inconsistent onboarding helper evidence is missing from AuthContext');

const checkout = read('src/pages/Checkout.jsx');
assert(checkout.includes("sessionStorage.removeItem('nuvira_pending_checkout_session')"), 'Expected pending checkout removal evidence is missing from Checkout');
assert(checkout.includes("localStorage.getItem('nuvira_pending_checkout_session')"), 'Expected pending checkout read evidence is missing from Checkout');
assert(checkout.includes('checkout_idempotency_key'), 'Expected checkout idempotency key evidence is missing from Checkout');

const createPaymentIntent = read('base44/functions/createPaymentIntent/entry.ts');
assert(createPaymentIntent.includes('stripe.paymentIntents.create'), 'Expected Stripe PaymentIntent creation evidence is missing');
assert(createPaymentIntent.includes('idempotencyKey'), 'Expected Stripe idempotency key evidence is missing');
assert(createPaymentIntent.includes('entities.Order.filter') && createPaymentIntent.includes('entities.Order.create'), 'Expected filter-then-create pending Order evidence is missing');

const stripeWebhook = read('base44/functions/stripeWebhook/entry.ts');
assert(stripeWebhook.includes('stripe_checkout_session_id') && stripeWebhook.includes('entities.Order.create'), 'Expected webhook filter/create evidence is missing');

const appLayout = read('src/components/layout/AppLayout.jsx');
assert(appLayout.includes('Always-mounted tab panels') && appLayout.includes('<Home />') && appLayout.includes('<Shop />') && appLayout.includes('<Cart />'), 'Expected always-mounted tab panel evidence is missing');

const vite = read('vite.config.js');
assert(vite.includes("logLevel: 'error'"), 'Expected Vite warning suppression evidence is missing');

const capacitor = JSON.parse(read('capacitor.config.json'));
assert(capacitor.webDir === 'dist', 'Expected Capacitor webDir=dist evidence is missing');
assert(!('server' in capacitor), 'Expected no Capacitor server.url for bundled native app evidence');

const packageJson = JSON.parse(read('package.json'));
assert(packageJson.scripts?.build === 'vite build', 'Expected build script evidence is missing');
assert(!packageJson.scripts?.test, 'Expected no canonical test script evidence changed; update G50A doc if a test script exists now');

const forbiddenDocPatterns = [
  new RegExp(`${'sk'}_${'live'}_[A-Za-z0-9_]+`),
  new RegExp(`${'sk'}_${'test'}_[A-Za-z0-9_]+`),
  new RegExp(`${'pk'}_${'live'}_[A-Za-z0-9_]+`),
  new RegExp(`${'pk'}_${'test'}_[A-Za-z0-9_]+`),
  new RegExp(`${'wh'}${'sec'}_[A-Za-z0-9_]+`),
  new RegExp(`${'client'}_${'secret'}`, 'i'),
  /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/,
];
for (const pattern of forbiddenDocPatterns) {
  assert(!pattern.test(doc), `G50A audit doc contains forbidden sensitive pattern: ${pattern}`);
}

console.log(JSON.stringify({
  ok: true,
  docPath,
  runtimeWritesPerformed: false,
  providerCallsPerformed: false,
  checkedEvidence: [
    'release_control',
    'startup_redirect',
    'error_boundary_reload',
    'native_auth_hard_replace',
    'checkout_non_atomicity',
    'native_web_divergence',
  ],
}, null, 2));
