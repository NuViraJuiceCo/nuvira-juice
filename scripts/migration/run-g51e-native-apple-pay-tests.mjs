#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

const files = {
  embeddedPayment: 'src/components/checkout/EmbeddedPayment.jsx',
  checkout: 'src/pages/Checkout.jsx',
  nativeApplePay: 'src/lib/nativeApplePay.js',
  bridgeController: 'ios/App/App/AppBridgeViewController.swift',
  swiftPlugin: 'ios/App/App/NativeApplePayPlugin.swift',
  storyboard: 'ios/App/App/Base.lproj/Main.storyboard',
  entitlements: 'ios/App/App/App.entitlements',
  infoPlist: 'ios/App/App/Info.plist',
  pbxproj: 'ios/App/App.xcodeproj/project.pbxproj',
};

const source = Object.fromEntries(Object.entries(files).map(([key, relativePath]) => [key, read(relativePath)]));

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('native Apple Pay bridge is iOS-only and uses Capacitor registerPlugin', () => {
  assert.match(source.nativeApplePay, /registerPlugin\(['"]NativeApplePay['"]\)/);
  assert.match(source.nativeApplePay, /Capacitor\.isNativePlatform\?\.\(\) === true/);
  assert.match(source.nativeApplePay, /Capacitor\.getPlatform\?\.\(\) === ['"]ios['"]/);
  assert.match(source.nativeApplePay, /merchant\.com\.nuvirajuice/);
});

test('native bridge derives the PaymentIntent id without adding Checkout state', () => {
  assert.doesNotMatch(source.checkout, /paymentIntentId=\{paymentIntentId\}/);
  assert.match(source.nativeApplePay, /paymentIntentIdFromClientSecret\(clientSecret\)/);
  assert.match(source.nativeApplePay, /clientSecret\.split\(['"]_secret_['"]\)\[0\]/);
  assert.match(source.embeddedPayment, /paymentIntentIdFromClientSecret\(clientSecret\)/);
});

test('payment component renders native Apple Pay button only after native availability check', () => {
  assert.match(source.embeddedPayment, /getNativeApplePayAvailability\(\)/);
  assert.match(source.embeddedPayment, /nativeApplePayStatus\.available/);
  assert.match(source.embeddedPayment, /`Pay \$\$\{total\.toFixed\(2\)\} with Apple Pay`/);
  assert.match(source.embeddedPayment, /confirmNativeApplePayPayment\(/);
  assert.match(source.embeddedPayment, /onSuccess\(resolvedPaymentIntentId\)/);
});

test('admin diagnostic distinguishes native Apple Pay from Stripe web Express Checkout', () => {
  assert.match(source.embeddedPayment, /native_apple_pay/);
  assert.match(source.embeddedPayment, /native_reason/);
  assert.match(source.embeddedPayment, /native_card/);
  assert.match(source.embeddedPayment, /formatDiagnosticBool\(nativeApplePayStatus\.available\)/);
  assert.match(source.embeddedPayment, /Stripe reported no eligible wallet buttons/);
});

test('inline wallet diagnostics are hidden unless an admin explicitly opts in', () => {
  assert.match(source.checkout, /wallet_diagnostics/);
  assert.match(source.checkout, /new URLSearchParams\(window\.location\.search\)\.get\(['"]wallet_diagnostics['"]\) === ['"]1['"]/);
  assert.match(source.checkout, /showWalletDiagnostics=\{\(user\?\.role === ['"]admin['"] \|\| user\?\.role === ['"]owner['"]\) && typeof window !== ['"]undefined['"] && new URLSearchParams\(window\.location\.search\)\.get\(['"]wallet_diagnostics['"]\) === ['"]1['"]\}/);
  assert.doesNotMatch(source.checkout, /showWalletDiagnostics=\{user\?\.role === ['"]admin['"] \|\| user\?\.role === ['"]owner['"]\}/);
});

test('Swift plugin uses StripeApplePay and existing PaymentIntent client secret', () => {
  assert.match(source.swiftPlugin, /import StripeApplePay/);
  assert.match(source.swiftPlugin, /public class NativeApplePayPlugin: CAPPlugin, CAPBridgedPlugin, ApplePayContextDelegate/);
  assert.match(source.swiftPlugin, /StripeAPI\.defaultPublishableKey = publishableKey/);
  assert.match(source.swiftPlugin, /StripeAPI\.paymentRequest\(/);
  assert.match(source.swiftPlugin, /STPApplePayContext\(paymentRequest: request, delegate: self\)/);
  assert.match(source.swiftPlugin, /return clientSecret/);
  assert.doesNotMatch(source.swiftPlugin, /sk_live_|sk_test_|whsec_/);
});

test('app bridge registers the local native Apple Pay plugin before web checkout calls it', () => {
  assert.match(source.bridgeController, /class AppBridgeViewController: CAPBridgeViewController/);
  assert.match(source.bridgeController, /override func capacitorDidLoad\(\)/);
  assert.match(source.bridgeController, /registerPluginInstance\(NativeApplePayPlugin\(\)\)/);
  assert.match(source.storyboard, /customClass="AppBridgeViewController"/);
  assert.match(source.pbxproj, /AppBridgeViewController\.swift in Sources/);
});

test('iOS project links StripeApplePay and compiles the native plugin', () => {
  assert.match(source.pbxproj, /NativeApplePayPlugin\.swift in Sources/);
  assert.match(source.pbxproj, /https:\/\/github\.com\/stripe\/stripe-ios-spm/);
  assert.match(source.pbxproj, /productName = StripeApplePay/);
  assert.match(source.pbxproj, /version = 26\.0\.0/);
});

test('Apple Pay merchant entitlement is explicit and mirrored into Info.plist', () => {
  assert.match(source.entitlements, /com\.apple\.developer\.in-app-payments/);
  assert.match(source.entitlements, /\$\(APPLE_PAY_MERCHANT_ID\)/);
  assert.match(source.infoPlist, /NuViraApplePayMerchantIdentifier/);
  assert.match(source.pbxproj, /APPLE_PAY_MERCHANT_ID = merchant\.com\.nuvirajuice/);
});

let passed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error.stack || error.message);
    process.exit(1);
  }
}

console.log(JSON.stringify({
  ok: true,
  passed,
  classification: 'g51e_native_apple_pay_contract_ready',
}, null, 2));
