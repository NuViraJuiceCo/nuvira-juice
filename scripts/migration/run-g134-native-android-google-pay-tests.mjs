#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const gradle = read('android/app/build.gradle');
const manifest = read('android/app/src/main/AndroidManifest.xml');
const mainActivity = read('android/app/src/main/java/com/nuvirajuice/app/MainActivity.java');
const plugin = read('android/app/src/main/java/com/nuvirajuice/app/NativeGooglePayPlugin.java');
const activity = read('android/app/src/main/java/com/nuvirajuice/app/NativeGooglePayActivity.java');
const bridge = read('src/lib/nativeGooglePay.js');
const oneTime = read('src/components/checkout/EmbeddedPayment.jsx');
const subscription = read('src/components/checkout/SubscriptionPaymentPanel.jsx');
const criticalSuite = read('scripts/ci/run-critical-regressions.mjs');

assert.match(gradle, /implementation "com\.google\.android\.gms:play-services-wallet:20\.0\.0"/);
assert.match(gradle, /implementation "com\.stripe:stripe-android:23\.0\.1"/);
assert.match(manifest, /android:name="com\.google\.android\.gms\.wallet\.api\.enabled"\s+android:value="true"/);
assert.match(manifest, /android:name="\.NativeGooglePayActivity"\s+android:exported="false"/);
assert.match(mainActivity, /registerPlugin\(NativeGooglePayPlugin\.class\)/);

assert.match(plugin, /@CapacitorPlugin\(name = "NativeGooglePay"\)/);
assert.match(plugin, /public void isAvailable\(PluginCall call\)/);
assert.match(plugin, /existingPaymentMethodRequired/);
assert.match(plugin, /WalletConstants\.ENVIRONMENT_PRODUCTION/);
assert.match(plugin, /WalletConstants\.ENVIRONMENT_TEST/);
assert.match(plugin, /new Intent\(getContext\(\), NativeGooglePayActivity\.class\)/);
assert.match(plugin, /startActivityForResult\(call, intent, "handleGooglePayResult"\)/);
assert.match(plugin, /@ActivityCallback/);
assert.match(plugin, /validClientSecret/);
assert.match(plugin, /validPublishableKey/);
assert.doesNotMatch(plugin, /sk_live_|sk_test_|getDouble\("(?:amount|total)"\)/, 'native bridge must not contain a Stripe secret or trust a client amount');

assert.match(activity, /PaymentConfiguration\.init\(this, publishableKey\)/);
assert.match(activity, /new GooglePayLauncher\(/);
assert.match(activity, /GooglePayEnvironment\.Production/);
assert.match(activity, /GooglePayEnvironment\.Test/);
assert.match(activity, /presentForPaymentIntent\(clientSecret, "NuVira order"\)/);
assert.match(activity, /result instanceof GooglePayLauncher\.Result\.Completed/);
assert.match(activity, /result instanceof GooglePayLauncher\.Result\.Canceled/);
assert.doesNotMatch(activity, /GooglePayLauncherContract|@SuppressWarnings\("RestrictedApi"\)/, 'native integration must use Stripe public APIs');

assert.match(bridge, /Capacitor\.getPlatform\?\.\(\) === 'android'/);
assert.match(bridge, /NativeGooglePay\.isAvailable\(\{ publishableKey \}\)/);
assert.match(bridge, /NativeGooglePay\.confirmPayment\(\{ clientSecret, publishableKey \}\)/);
assert.match(oneTime, /getNativeGooglePayAvailability\(publishableKey\)/);
assert.match(oneTime, /confirmNativeGooglePayPayment\(\{ clientSecret, publishableKey \}\)/);
assert.match(oneTime, /Pay \$\$\{total\.toFixed\(2\)\} with Google Pay/);
assert.match(oneTime, /nativeGooglePayPreferred = isNativeGooglePayPlatform\(\) && nativeGooglePayStatus\.available/);
assert.match(oneTime, /!nativeGooglePayPreferred && \(!expressReady \|\| expressAvailable\)/);
assert.match(subscription, /getNativeGooglePayAvailability\(publishableKey\)/);
assert.match(subscription, /confirmNativeGooglePayPayment\(\{ clientSecret, publishableKey \}\)/);
assert.match(subscription, /Subscribe — \$\$\{amountDue\.toFixed\(2\)\} with Google Pay/);
assert.match(subscription, /nativeGooglePayPreferred = isNativeGooglePayPlatform\(\) && nativeGooglePayStatus\.available/);
assert.match(subscription, /!nativeGooglePayPreferred && \(!expressReady \|\| expressAvailable\)/);
assert.match(criticalSuite, /run-g134-native-android-google-pay-tests\.mjs/);

console.log(JSON.stringify({
  ok: true,
  suite: 'g134-native-android-google-pay',
  checkout_surfaces: ['one_time', 'subscription'],
  environments: ['test', 'production'],
  server_authoritative_amount: true,
  native_binary_required: true,
  provider_calls_performed: false,
}, null, 2));
