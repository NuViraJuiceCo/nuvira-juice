import { Capacitor } from '@capacitor/core';

export function isNativeAppRuntime() {
  return Capacitor.isNativePlatform?.() === true;
}
