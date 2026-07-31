import { Capacitor, registerPlugin } from '@capacitor/core';

const NativeApplePay = registerPlugin('NativeApplePay');
const viteEnv = typeof import.meta !== 'undefined' ? import.meta['env'] : undefined;

export const DEFAULT_APPLE_PAY_MERCHANT_ID =
  viteEnv?.VITE_APPLE_PAY_MERCHANT_ID || 'merchant.com.nuvirajuice';

export function isNativeApplePayPlatform() {
  return Capacitor.isNativePlatform?.() === true && Capacitor.getPlatform?.() === 'ios';
}

export async function getNativeApplePayAvailability() {
  if (!isNativeApplePayPlatform()) {
    return { available: false, reason: 'not_ios_native' };
  }

  try {
    const status = await NativeApplePay.isAvailable({
      merchantIdentifier: DEFAULT_APPLE_PAY_MERCHANT_ID,
    });
    if (status?.available) return status;

    const reason =
      status?.merchantIdentifierConfigured === false ? 'merchant_identifier_missing'
        : status?.deviceSupportsApplePay === false ? 'device_does_not_support_apple_pay'
          : status?.canMakePayments === false ? 'wallet_payments_unavailable'
            : status?.canMakeCardPayments === false ? 'no_supported_wallet_card'
              : 'apple_pay_unavailable';

    return { ...status, available: false, reason };
  } catch (error) {
    return {
      available: false,
      reason: error?.code || 'native_plugin_unavailable',
      message: error?.message || String(error),
    };
  }
}

export function paymentIntentIdFromClientSecret(clientSecret) {
  if (typeof clientSecret !== 'string' || !clientSecret.includes('_secret_')) return '';
  return clientSecret.split('_secret_')[0] || '';
}

export async function confirmNativeApplePayPayment({
  clientSecret,
  publishableKey,
  total,
  customerName = '',
  customerEmail = '',
  customerPhone = '',
  merchantDisplayName = 'NuVira Juice Company',
}) {
  return NativeApplePay.confirmPayment({
    clientSecret,
    paymentIntentId: paymentIntentIdFromClientSecret(clientSecret),
    publishableKey,
    total,
    customerName,
    customerEmail,
    customerPhone,
    merchantIdentifier: DEFAULT_APPLE_PAY_MERCHANT_ID,
    merchantDisplayName,
  });
}
