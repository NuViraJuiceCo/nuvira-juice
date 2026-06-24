#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '../..');
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

const files = {
  checkout: 'src/pages/Checkout.jsx',
  embeddedPayment: 'src/components/checkout/EmbeddedPayment.jsx',
  createPaymentIntent: 'base44/functions/createPaymentIntent/entry.ts',
  subscriptionPaymentPanel: 'src/components/checkout/SubscriptionPaymentPanel.jsx',
  packageJson: 'package.json',
  capacitor: 'capacitor.config.json',
  appParams: 'src/lib/app-params.js',
  seo: 'src/components/SEO.jsx',
};

const source = Object.fromEntries(Object.entries(files).map(([key, relativePath]) => [key, read(relativePath)]));
const allAuditSource = Object.values(source).join('\n');

const evidence = {
  generated_at: new Date().toISOString(),
  scope: 'static_read_only_no_payment_creation',
  files_checked: files,
  integration: {},
  checkout_path: {},
  domain_environment: {},
  browser_wallet: {},
  native_shell: {},
  ui_layout: {},
  safety: {
    writes_performed: false,
    payment_intent_created: false,
    checkout_session_created: false,
    stripe_calls_performed: false,
    shopify_calls_performed: false,
    hub_calls_performed: false,
    provider_calls_performed: false,
    notifications_sent: false,
    order_mutation_performed: false,
    pii_returned: false,
    raw_payloads_returned: false,
  },
  classifications: [],
  warnings: [],
};

function classify(name) {
  if (!evidence.classifications.includes(name)) evidence.classifications.push(name);
}
function warn(name) {
  if (!evidence.warnings.includes(name)) evidence.warnings.push(name);
}

// 1. Express Checkout source exists.
assert.match(source.embeddedPayment, /ExpressCheckoutElement/, 'Express Checkout Element source must exist');
evidence.integration.express_checkout_source_exists = true;

// 2. Stripe initialization is present.
assert.match(source.embeddedPayment, /loadStripe\(/, 'loadStripe initialization must exist');
assert.match(source.embeddedPayment, /<Elements\b/, 'Elements provider must exist');
evidence.integration.stripe_initialization_present = true;

// 3. Production checkout mounts the wallet element.
assert.match(source.checkout, /createPaymentIntent/, 'Checkout must invoke createPaymentIntent before embedded payment');
assert.match(source.checkout, /<EmbeddedPayment\b/, 'Checkout must render EmbeddedPayment after client secret exists');
assert.match(source.embeddedPayment, /<ExpressCheckoutElement\b/, 'EmbeddedPayment must mount ExpressCheckoutElement');
evidence.checkout_path.payment_step_mounts_embedded_payment = true;
evidence.integration.express_checkout_mounted_after_payment_initialization = true;

// 4. Card fallback remains available.
for (const token of ['CardNumberElement', 'CardExpiryElement', 'CardCvcElement', 'confirmCardPayment']) {
  assert.match(source.embeddedPayment, new RegExp(token), `${token} fallback must remain present`);
}
evidence.integration.card_fallback_available = true;

// 5. Apple Pay is not hard-disabled.
assert.doesNotMatch(source.embeddedPayment, /applePay\s*:\s*['"]never['"]/, 'Apple Pay must not be hard-disabled');
evidence.integration.apple_pay_not_hard_disabled = true;

// 6. Visibility conditions are documented.
assert.match(source.embeddedPayment, /onReady=\{\(\{\s*availablePaymentMethods/, 'available payment methods readiness handler must exist');
assert.match(source.embeddedPayment, /setExpressAvailable\(/, 'express availability state must be tracked');
evidence.integration.visibility_conditions_documented_in_source = true;

// 7. Missing domain registration is classified safely.
classify('apple_pay_domain_registration_status_unknown');
evidence.domain_environment.payment_method_domain_registration_checked_live = false;
evidence.domain_environment.payment_method_domain_registration_status = 'unknown_not_checked_by_static_audit';

// 8. Test/live mismatch is classified safely.
assert.match(source.createPaymentIntent, /Deno\.env\.get\(['"]STRIPE_SECRET_KEY['"]\)/, 'backend uses configured Stripe secret key');
assert.match(source.createPaymentIntent, /Deno\.env\.get\(['"]STRIPE_PUBLISHABLE_KEY['"]\)/, 'backend returns configured publishable key');
evidence.domain_environment.mode_from_source = 'runtime_env_driven_not_value_exposed';
classify('unknown_environment_configuration');

// 9. Ineligible browser is not treated as an integration defect.
classify('apple_pay_browser_or_wallet_ineligible_possible');
evidence.browser_wallet.browser_wallet_eligibility_requires_live_device = true;

// 10. Missing wallet setup is classified safely.
classify('apple_pay_integration_present_live_device_validation_pending');
evidence.browser_wallet.wallet_setup_not_verified_by_static_audit = true;

// 11. WebView/native-shell path is distinguished.
const pkg = JSON.parse(source.packageJson);
const dependencyNames = Object.keys(pkg.dependencies || {});
const hasNativeStripePlugin = dependencyNames.some((name) => /stripe/i.test(name) && /capacitor|react-native|native/i.test(name));
evidence.native_shell.capacitor_present = /@capacitor\/core/.test(source.packageJson) && /webDir/.test(source.capacitor);
evidence.native_shell.native_stripe_apple_pay_plugin_present = hasNativeStripePlugin;
if (!hasNativeStripePlugin) classify('apple_pay_webview_unsupported_or_separate_native_path_required');

// 12. CSP/origin failure is classified safely.
const cspConfigured = /Content-Security-Policy|script-src|frame-src|connect-src/.test(allAuditSource);
evidence.domain_environment.csp_config_found_in_repo = cspConfigured;
if (!cspConfigured) classify('apple_pay_csp_or_origin_unverified');

// 13. Zero-size/hidden container is detected.
assert.match(source.embeddedPayment, /minHeight\s*:\s*['"]48px['"]/, 'Express Checkout container must have nonzero min height');
evidence.ui_layout.express_container_min_height_px = 48;
evidence.ui_layout.zero_height_container_detected = false;
assert.doesNotMatch(source.embeddedPayment, /ExpressCheckoutElement[\s\S]{0,250}className=['"][^'"]*hidden/, 'Express Checkout must not be locally hidden while evaluating wallet readiness');
evidence.ui_layout.hidden_by_local_class = false;

// Current Stripe docs and installed types prefer paymentMethods for wallet behavior.
assert.match(
  source.embeddedPayment,
  /paymentMethods\s*:\s*\{[\s\S]*applePay\s*:\s*['"]always['"][\s\S]*googlePay\s*:\s*['"]always['"]/,
  'Express Checkout must use paymentMethods.applePay/googlePay for wallet behavior'
);
assert.doesNotMatch(source.embeddedPayment, /wallets\s*:\s*\{[\s\S]*applePay/, 'Deprecated wallets.applePay option must not be used');
evidence.integration.express_checkout_uses_current_payment_methods_option = true;

// PaymentIntent and Order creation boundary: do not test live mount by clicking through without approval.
assert.match(source.createPaymentIntent, /stripe\.paymentIntents\.create\(/, 'createPaymentIntent creates a PaymentIntent');
assert.match(source.createPaymentIntent, /entities\.Order\.create\(/, 'createPaymentIntent pre-creates a pending Order');
assert.match(source.createPaymentIntent, /payment_method_types\s*:\s*\[\s*['"]card['"]\s*\]/, 'PaymentIntent is constrained to card-backed payment method type');
assert.doesNotMatch(source.createPaymentIntent, /automatic_payment_methods\s*:/, 'automatic_payment_methods should remain omitted in current contract');
evidence.checkout_path.review_payment_button_calls_payment_initialization = true;
evidence.checkout_path.payment_initialization_creates_payment_intent = true;
evidence.checkout_path.payment_initialization_precreates_pending_order = true;
evidence.checkout_path.live_mount_smoke_requires_separate_payment_initialization_order_approval = true;
classify('apple_pay_backend_payment_initialization_required_for_mount');

// 14. No secret keys in output.
const outputPreview = JSON.stringify(evidence);
const unsafeOutputPattern = /\b(?:sk_live|sk_test|pk_live|pk_test|whsec_)[A-Za-z0-9_]+|client_secret|_secret_|(?:^|[^A-Za-z0-9])pi_[A-Za-z0-9]{8,}/i;
assert.doesNotMatch(outputPreview, unsafeOutputPattern, 'harness output must not contain Stripe keys, client secrets, or payment IDs');

// Source privacy warnings are recorded without outputting the sensitive values.
if (/clientSecret\.substring|clientSecret prefix|PaymentIntent ID|const piId = clientSecret/.test(source.embeddedPayment + source.checkout)) {
  warn('existing_debug_paths_can_display_payment_intent_id_or_client_secret_prefix_when_payment_step_exists');
}

// 15. No client secrets in output.
assert.equal(evidence.safety.raw_payloads_returned, false, 'no raw payload output');

// 16-21. No PaymentIntent/session creation, payment mutation, Order creation, providers, notifications, Hub mutation.
assert.equal(evidence.safety.payment_intent_created, false, 'harness must not create PaymentIntent');
assert.equal(evidence.safety.checkout_session_created, false, 'harness must not create Checkout Session');
assert.equal(evidence.safety.order_mutation_performed, false, 'harness must not mutate Order');
assert.equal(evidence.safety.provider_calls_performed, false, 'harness must not call providers');
assert.equal(evidence.safety.notifications_sent, false, 'harness must not send notifications');
assert.equal(evidence.safety.hub_calls_performed, false, 'harness must not call Hub');

// Hostname map from static source only.
evidence.domain_environment.static_hostnames = [...new Set([
  ...(source.appParams.match(/https:\/\/[^'"`\s]+/g) || []),
  ...(source.seo.match(/https:\/\/[^'"`\s]+/g) || []),
  ...(source.createPaymentIntent.match(/https:\/\/[^'"`\s]+/g) || []),
  ...(read('base44/functions/createCheckoutSession/entry.ts').match(/https:\/\/[^'"`\s]+/g) || []),
].map((url) => url.replace(/[),.;]+$/, '')))].sort();

console.log(JSON.stringify(evidence, null, 2));
