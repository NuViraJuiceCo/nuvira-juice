import { base44 } from '@/api/base44Client';
import { appParams } from '@/lib/app-params';
import { Capacitor, registerPlugin } from '@capacitor/core';

const DeliveryLiveActivity = registerPlugin('DeliveryLiveActivity');
const ACTIVE_SESSION_KEY = 'nuvira_active_driver_route_session_v1';
const UPDATE_INTERVAL_MS = 30 * 1000;
let webWatchId = null;
let webSession = null;
let webLastSentAt = 0;
let webSequence = 0;

function normalize(value, max = 180) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function activeSessionId() {
  if (typeof window === 'undefined') return '';
  return normalize(window.sessionStorage.getItem(ACTIVE_SESSION_KEY), 180);
}

function rememberSession(sessionId) {
  if (typeof window === 'undefined') return;
  if (sessionId) window.sessionStorage.setItem(ACTIVE_SESSION_KEY, sessionId);
  else window.sessionStorage.removeItem(ACTIVE_SESSION_KEY);
}

function unwrap(response) {
  return response?.data || response || {};
}

async function ingestWebSample(position) {
  if (!webSession) return;
  const now = Date.now();
  if (now - webLastSentAt < UPDATE_INTERVAL_MS) return;
  webLastSentAt = now;
  webSequence += 1;
  const response = await base44.functions.fetch('getAdminOperationsDashboardSummary', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Route-Session-Token': webSession.token,
    },
    body: JSON.stringify({
      gateway_action: 'manageDriverRouteTelemetry',
      payload: {
        action: 'ingest',
        session_id: webSession.sessionId,
        sequence: webSequence,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy_meters: position.coords.accuracy,
        captured_at: new Date(position.timestamp || now).toISOString(),
      },
    }),
  });
  if (response.status === 410) stopWebTracking();
  if (!response.ok && response.status !== 410) throw new Error('route_location_update_failed');
}

function stopWebTracking() {
  if (webWatchId !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
    navigator.geolocation.clearWatch(webWatchId);
  }
  webWatchId = null;
  webSession = null;
  webLastSentAt = 0;
  webSequence = 0;
}

async function startWebTracking(session) {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    throw new Error('location_services_unavailable');
  }
  stopWebTracking();
  webSession = session;
  webWatchId = navigator.geolocation.watchPosition(
    (position) => { ingestWebSample(position).catch(() => null); },
    () => null,
    { enableHighAccuracy: true, maximumAge: 15_000, timeout: 20_000 },
  );
}

export async function getDriverRouteTelemetryStatus() {
  const response = await base44.functions.invoke('manageDriverRouteTelemetry', {
    action: 'status',
    ...(activeSessionId() ? { session_id: activeSessionId() } : {}),
  });
  const result = unwrap(response);
  if (result.state === 'inactive' || result.state === 'stopped' || result.state === 'expired') rememberSession('');
  return result;
}

export async function startDriverRouteTelemetry({ fulfillmentTaskId, orderedTaskIds = [] }) {
  const response = await base44.functions.invoke('manageDriverRouteTelemetry', {
    action: 'start',
    fulfillment_task_id: normalize(fulfillmentTaskId, 160),
    ordered_task_ids: orderedTaskIds.map((value) => normalize(value, 160)).filter(Boolean),
  });
  const result = unwrap(response);
  if (!result.success || !result.session_id || !result.session_token) {
    throw new Error(result.error || 'route_tracking_start_failed');
  }

  const session = { sessionId: result.session_id, token: result.session_token };
  rememberSession(result.session_id);
  try {
    if (Capacitor.isNativePlatform()) {
      await DeliveryLiveActivity.startRouteTracking({
        endpoint: `${appParams.appBaseUrl.replace(/\/$/, '')}${result.ingest_path}`,
        sessionId: result.session_id,
        sessionToken: result.session_token,
        minimumUpdateIntervalSeconds: result.minimum_update_interval_seconds || 30,
        minimumDistanceMeters: result.minimum_distance_meters || 75,
      });
    } else {
      await startWebTracking(session);
    }
  } catch (error) {
    await base44.functions.invoke('manageDriverRouteTelemetry', {
      action: 'stop',
      session_id: result.session_id,
      reason: 'device_tracking_start_failed',
    }).catch(() => null);
    rememberSession('');
    throw error;
  }
  return result;
}

export async function stopDriverRouteTelemetry({ sessionId, reason = 'operator_stopped' } = {}) {
  const targetSessionId = normalize(sessionId || activeSessionId(), 180);
  if (Capacitor.isNativePlatform()) {
    await DeliveryLiveActivity.stopRouteTracking().catch(() => null);
  } else {
    stopWebTracking();
  }
  if (!targetSessionId) return { success: true, state: 'inactive' };
  const response = await base44.functions.invoke('manageDriverRouteTelemetry', {
    action: 'stop',
    session_id: targetSessionId,
    reason,
  });
  rememberSession('');
  return unwrap(response);
}

export async function getNativeDriverRouteTrackingStatus() {
  if (!Capacitor.isNativePlatform()) {
    return { platform: 'web', active: webWatchId !== null };
  }
  return DeliveryLiveActivity.getRouteTrackingStatus().catch(() => ({
    platform: Capacitor.getPlatform(),
    active: false,
    reason: 'native_tracking_status_unavailable',
  }));
}
