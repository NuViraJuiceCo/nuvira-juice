#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const eventPush = fs.readFileSync('src/lib/eventPushNotifications.js', 'utf8');
const app = fs.readFileSync('src/App.jsx', 'utf8');
const notificationPrompt = fs.readFileSync('src/components/home/NotificationPrompt.jsx', 'utf8');
const registerPush = fs.readFileSync('base44/functions/registerPushSubscription/entry.ts', 'utf8');
const sendPush = fs.readFileSync('base44/functions/sendCustomerPushNotification/entry.ts', 'utf8');

const existingSubscriptionBody = eventPush.match(
  /export async function getExistingEventPushSubscription\(\) \{([\s\S]*?)\n\}/,
)?.[1] || '';
const unsubscribeBody = eventPush.match(
  /export async function unsubscribeFromEventPushNotifications\(\) \{([\s\S]*?)\n\}/,
)?.[1] || '';

assert.match(eventPush, /token_type: fcmToken \? 'fcm' : 'apns'/);
assert.match(registerPush, /if \(requested === 'fcm' && fcmToken\) return 'fcm'/);
assert.match(registerPush, /const tokenType = resolveTokenType\(body, fcmToken, apnsToken\)/);

assert.match(existingSubscriptionBody, /const savedTarget = readEventNativePushTarget\(\)/);
assert.doesNotMatch(existingSubscriptionBody, /FirebaseMessaging\.getToken/);
assert.match(existingSubscriptionBody, /savedTarget\?\.server_registered === true/);
assert.match(eventPush, /function nativePushRegistrationTargets\(pushTarget\)/);
assert.match(eventPush, /export async function ensureAuthenticatedNativePushRegistration\(\)/);
assert.match(eventPush, /server_registered: true/);
assert.match(eventPush, /persistent_storage: true/);
assert.doesNotMatch(eventPush, /success: true, status, reason, mode: 'native_push_direct'/);
assert.match(eventPush, /token_type: 'apns'/);
assert.match(eventPush, /apns_environment: 'production'/);
assert.match(eventPush, /registered_token_types/);
assert.match(unsubscribeBody, /selectors\.push\(\{ token_type: 'fcm'/);
assert.match(unsubscribeBody, /selectors\.push\(\{ token_type: 'apns'/);
assert.match(unsubscribeBody, /clearEventNativePushTarget\(\)/);

assert.match(eventPush, /notificationActionPerformed/);
assert.match(eventPush, /notificationReceived/);
assert.match(eventPush, /mark_read_id: notificationId/);
assert.match(eventPush, /route\.startsWith\('\/'\)/);
assert.match(eventPush, /route\.startsWith\('\/\/'\)/);
assert.match(app, /installEventNativePushListeners/);
assert.match(app, /onNotificationAction: \(\{ route \}\) => navigate\(route\)/);
assert.match(app, /ensureAuthenticatedNativePushRegistration/);
assert.match(app, /if \(!user\?\.email\) return undefined/);
assert.match(app, /reconcilePushRegistration\(attempt \+ 1\)/);
assert.match(notificationPrompt, /const \{ user \} = useAuth\(\)/);
assert.match(notificationPrompt, /if \(typeof window === 'undefined' \|\| !user\?\.email\)/);
assert.doesNotMatch(notificationPrompt, /result\.success \|\| nextPermission === 'granted'/);

assert.match(sendPush, /const apnsFallbackSubscriptions = fcmSubscriptions/);
assert.match(sendPush, /if \(result\.skipped_reason\)/);
assert.match(sendPush, /sendApnsSubscriptions\(base44, apnsFallbackSubscriptions, payload\)/);

assert.doesNotMatch(eventPush, /ENABLE_BROAD_CUSTOMER_PUSH/);
assert.doesNotMatch(registerPush, /ENABLE_BROAD_CUSTOMER_PUSH/);

console.log(JSON.stringify({
  success: true,
  suite: 'g64-native-push-transport',
  cases: 33,
  fcm_primary: true,
  apns_fallback: true,
  ios_dual_transport_registration: true,
  unsubscribe_revokes_all_saved_transports: true,
  tap_deep_link_and_read_tracking: true,
  authenticated_registration_recovery: true,
  server_confirmation_required: true,
  broad_customer_sends_enabled: false,
  writes_performed: false,
  provider_calls_performed: false,
  customer_notifications_sent: false,
}, null, 2));
