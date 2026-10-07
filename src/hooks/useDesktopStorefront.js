import { useSyncExternalStore } from 'react';
import { isNativeAppRuntime } from '@/lib/nativeRuntime';

const serverSnapshot = () => false;
const snapshot = () => typeof window !== 'undefined'
  && !isNativeAppRuntime();

// Retain the existing hook name for callers. Web and native are distinct
// experiences; CSS adapts the website without remounting it on window resize.
const subscribe = () => () => {};

export default function useDesktopStorefront() {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
