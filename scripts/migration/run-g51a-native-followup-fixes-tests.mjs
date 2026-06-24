#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const embedded = read('src/components/checkout/EmbeddedPayment.jsx');
const subscription = read('src/components/checkout/SubscriptionPaymentPanel.jsx');
const diagnostic = read('src/components/checkout/ApplePayMountDiagnostic.jsx');
const indexCss = read('src/index.css');
const nativeLogin = read('src/pages/NativeLogin.jsx');
const createPaymentIntent = read('base44/functions/createPaymentIntent/entry.ts');

function assertCurrentExpressCheckoutOptions(source, label) {
  assert(/<ExpressCheckoutElement\b/.test(source), `${label} must render ExpressCheckoutElement`);
  assert(/paymentMethods\s*:\s*\{[\s\S]*applePay\s*:\s*['"]always['"][\s\S]*googlePay\s*:\s*['"]always['"]/.test(source), `${label} must use current paymentMethods wallet options`);
  assert(!/wallets\s*:\s*\{[\s\S]*applePay/.test(source), `${label} must not use deprecated wallets.applePay options`);
}

assertCurrentExpressCheckoutOptions(embedded, 'EmbeddedPayment');
assertCurrentExpressCheckoutOptions(subscription, 'SubscriptionPaymentPanel');
assertCurrentExpressCheckoutOptions(diagnostic, 'ApplePayMountDiagnostic');

assert(/const \[expressReady, setExpressReady\] = useState\(false\)/.test(embedded), 'EmbeddedPayment must track Express Checkout readiness');
assert(/\(!expressReady \|\| expressAvailable\)/.test(embedded), 'EmbeddedPayment must collapse the wallet section when no wallet methods are available');
assert(/setExpressReady\(true\)[\s\S]*setExpressAvailable\(hasExpress\)/.test(embedded), 'EmbeddedPayment must set availability from Stripe onReady');
assert(/onLoadError=\{\(err\) => \{[\s\S]*setExpressReady\(true\)[\s\S]*setExpressAvailable\(false\)/.test(embedded), 'EmbeddedPayment must collapse the wallet section after Express Checkout load errors');

assert(/const \[expressReady, setExpressReady\] = useState\(false\)/.test(subscription), 'SubscriptionPaymentPanel must track Express Checkout readiness');
assert(/\(!expressReady \|\| expressAvailable\)/.test(subscription), 'SubscriptionPaymentPanel must collapse the wallet section when no wallet methods are available');

assert(/\.nuvira-admin-header\s*\{[\s\S]*padding-top\s*:\s*max\(3\.75rem,\s*calc\(env\(safe-area-inset-top\) \+ 0\.75rem\)\)/.test(indexCss), 'Admin header must include a hard iOS status-bar padding floor plus safe-area top padding');
assert(/const ENABLE_PROVIDER_BUTTONS = import\.meta\.env\.VITE_ENABLE_AUTH_PROVIDER_BUTTONS === ['"]true['"]/.test(nativeLogin), 'Native provider buttons must be opt-in, not on by default');
assert(!/VITE_ENABLE_AUTH_PROVIDER_BUTTONS !== ['"]false['"]/.test(nativeLogin), 'Native provider buttons must not default to enabled');

assert(/payment_method_types\s*:\s*\[\s*['"]card['"]\s*\]/.test(createPaymentIntent), 'Checkout PaymentIntent must stay card-backed for wallet/card safety');
assert(!/automatic_payment_methods\s*:/.test(createPaymentIntent), 'Checkout PaymentIntent must not enable automatic payment methods');

console.log(JSON.stringify({
  ok: true,
  classification: 'g51a_native_followup_fixes_static_regression_passed',
  walletCheckoutUsesCurrentPaymentMethods: true,
  emptyWalletSectionCollapses: true,
  adminHeaderSafeAreaPatched: true,
  nativeProviderAuthOptInOnly: true,
  backendPaymentMethodContractPreserved: true,
}, null, 2));
