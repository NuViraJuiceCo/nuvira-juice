import { Capacitor, registerPlugin } from '@capacitor/core';
import { paymentIntentIdFromClientSecret } from '@/lib/nativeApplePay';

const NativeGooglePay = registerPlugin('NativeGooglePay');

export function isNativeGooglePayPlatform() {
  return Capacitor.isNativePlatform?.() === true && Capacitor.getPlatform?.() === 'android';
}

export async function getNativeGooglePayAvailability(publishableKey) {
  if (!isNativeGooglePayPlatform()) {
    return { available: false, reason: 'not_android_native' };
  }

  try {
    return await NativeGooglePay.isAvailable({ publishableKey });
  } catch (error) {
    return {
      available: false,
      reason: error?.code || 'native_plugin_unavailable',
      message: error?.message || String(error),
    };
  }
}

export async function confirmNativeGooglePayPayment({ clientSecret, publishableKey }) {
  const result = await NativeGooglePay.confirmPayment({ clientSecret, publishableKey });
  return {
    ...result,
    paymentIntentId: paymentIntentIdFromClientSecret(clientSecret),
  };
}
