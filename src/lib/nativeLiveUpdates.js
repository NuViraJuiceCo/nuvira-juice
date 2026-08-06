import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import * as LiveUpdates from '@capacitor/live-updates';

let initialized = false;
let syncInFlight = null;

async function syncAndApplyLatestBundle() {
  if (!Capacitor.isNativePlatform()) return;
  if (syncInFlight) return syncInFlight;

  syncInFlight = (async () => {
    try {
      const result = await LiveUpdates.sync();
      if (result?.activeApplicationPathChanged) {
        await LiveUpdates.reload();
      }
    } catch {
      // Keep the last known-good bundle available when Appflow or the network is unavailable.
      console.warn('[native-live-update] Sync unavailable; continuing with the cached app bundle.');
    } finally {
      syncInFlight = null;
    }
  })();

  return syncInFlight;
}

export function initializeNativeLiveUpdates() {
  if (initialized || !Capacitor.isNativePlatform()) return;
  initialized = true;

  void syncAndApplyLatestBundle();
  void CapacitorApp.addListener('resume', () => {
    void syncAndApplyLatestBundle();
  });
}
