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
const nativeAuthRedirect = read('src/lib/nativeAuthRedirect.js');
const authContext = read('src/lib/AuthContext.jsx');
const createPaymentIntent = read('base44/functions/createPaymentIntent/entry.ts');
const productDetail = read('src/pages/ProductDetail.jsx');

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
assert(/import \{ Capacitor \} from ['"]@capacitor\/core['"]/.test(nativeLogin), 'Provider availability must distinguish web from native platforms');
assert(/import \{ Browser \} from ['"]@capacitor\/browser['"]/.test(nativeLogin), 'Native provider sign-in must use the Capacitor Browser plugin');
assert(/const ENABLE_PROVIDER_BUTTONS = !IS_NATIVE_PLATFORM \|\| Capacitor\.isPluginAvailable\(['"]Browser['"]\)/.test(nativeLogin), 'Provider buttons must remain enabled on web and require the native Browser plugin in packaged apps');
assert(/Browser\.open\(\{[\s\S]*getProviderLoginUrl\(provider, callbackUrl\)/.test(nativeLogin), 'Native provider sign-in must open the app-scoped OAuth URL in the system browser session');
assert(/getNativeBrowserProviderReturnUrl\(returnTo\)/.test(nativeLogin), 'Native provider sign-in must first return through the valid NuVira HTTPS callback');
assert(/createEncryptedNativeAuthCallbackUrl\(window\.location\.href, accessToken\)/.test(nativeLogin), 'NuVira HTTPS callback must encrypt the authenticated session before reopening the app');
assert(!/searchParams\.set\(['"]access_token['"], accessToken\)/.test(nativeLogin), 'Native browser bridge must never place a raw Base44 token in a URL');
assert(/window\.location\.replace\(callbackUrl\)/.test(nativeLogin), 'Native browser bridge must reopen the installed app');
assert(/export async function getNativeBrowserProviderReturnUrl\(returnRoute = ['"]\/['"]\)/.test(nativeAuthRedirect), 'Native browser HTTPS callback builder missing');
assert(/callbackUrl\.searchParams\.set\(NATIVE_BROWSER_CALLBACK_MARKER, ['"]1['"]\)/.test(nativeAuthRedirect), 'Native browser callback must carry the narrow bridge marker');
assert(/prepareNativeAuthHandoff\(/.test(nativeAuthRedirect), 'Native provider callback must prepare an encrypted one-time handoff');
assert(/encryptNativeAuthHandoff\(/.test(nativeAuthRedirect), 'Native browser callback must encrypt the one-time handoff');
assert(/consumeNativeAuthHandoff\(/.test(nativeAuthRedirect), 'Native app callback must decrypt the one-time handoff');
assert(/if \(url\.searchParams\.has\(['"]access_token['"]\)\) return null/.test(nativeAuthRedirect), 'Native scheme callbacks must reject raw access tokens');
assert(/export function getProviderLoginUrl\(provider, fromUrl\)/.test(nativeAuthRedirect), 'Provider login URL builder missing');
assert(/loginUrl\.searchParams\.set\(['"]app_id['"], String\(appParams\.appId\)\)/.test(nativeAuthRedirect), 'Provider login URL must remain scoped to the NuVira Base44 app');
assert(/loginUrl\.searchParams\.set\(['"]from_url['"], fromUrl\)/.test(nativeAuthRedirect), 'Provider login URL must preserve the approved callback');
assert(/await Browser\.close\(\)\.catch\(\(\) => \{\}\)/.test(authContext), 'Native auth callback must dismiss the provider browser before restoring app state');
assert(/base44\.auth\.loginViaEmailPassword\(normalizedEmail, password\)/.test(nativeLogin), 'Email sign-in must use the installed Base44 SDK contract');

assert(/payment_method_types\s*:\s*\[\s*['"]card['"]\s*\]/.test(createPaymentIntent), 'Checkout PaymentIntent must stay card-backed for wallet/card safety');
assert(!/automatic_payment_methods\s*:/.test(createPaymentIntent), 'Checkout PaymentIntent must not enable automatic payment methods');

const loadingGuardIndex = productDetail.indexOf('if (isLoading)');
const notFoundGuardIndex = productDetail.indexOf('if (!product)');
const productDerivedMetadataIndex = productDetail.indexOf('const seoTitle');
assert(loadingGuardIndex >= 0 && loadingGuardIndex < productDerivedMetadataIndex, 'Product detail must not read product fields before the loading guard');
assert(notFoundGuardIndex >= 0 && notFoundGuardIndex < productDerivedMetadataIndex, 'Product detail must not read product fields before the not-found guard');
assert(/!\s*isMerchProduct\s*&&\s*\([\s\S]*<HealthAdvisory variant=['"]expanded['"] \/>/.test(productDetail), 'Merch product detail pages must not show the Before You Drink advisory');

console.log(JSON.stringify({
  ok: true,
  classification: 'g51a_native_followup_fixes_static_regression_passed',
  walletCheckoutUsesCurrentPaymentMethods: true,
  emptyWalletSectionCollapses: true,
  adminHeaderSafeAreaPatched: true,
  webProviderAuthEnabledNativeBrowserGated: true,
  backendPaymentMethodContractPreserved: true,
  productDetailLoadingGuardPreserved: true,
  merchHealthAdvisoryHidden: true,
}, null, 2));
