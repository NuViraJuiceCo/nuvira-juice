#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const eventPush = fs.readFileSync('src/lib/eventPushNotifications.js', 'utf8');
const app = fs.readFileSync('src/App.jsx', 'utf8');
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
assert.match(unsubscribeBody, /savedTarget\?\.token_type === 'apns'/);
assert.match(unsubscribeBody, /clearEventNativePushTarget\(\)/);

assert.match(eventPush, /notificationActionPerformed/);
assert.match(eventPush, /notificationReceived/);
assert.match(eventPush, /mark_read_id: notificationId/);
assert.match(eventPush, /route\.startsWith\('\/'\)/);
assert.match(eventPush, /route\.startsWith\('\/\/'\)/);
assert.match(app, /installEventNativePushListeners/);
assert.match(app, /onNotificationAction: \(\{ route \}\) => navigate\(route\)/);

assert.match(sendPush, /const apnsFallbackSubscriptions = fcmSubscriptions/);
assert.match(sendPush, /if \(result\.skipped_reason\)/);
assert.match(sendPush, /sendApnsSubscriptions\(base44, apnsFallbackSubscriptions, payload\)/);

assert.doesNotMatch(eventPush, /ENABLE_BROAD_CUSTOMER_PUSH/);
assert.doesNotMatch(registerPush, /ENABLE_BROAD_CUSTOMER_PUSH/);

console.log(JSON.stringify({
  success: true,
  suite: 'g64-native-push-transport',
  cases: 17,
  fcm_primary: true,
  apns_fallback: true,
  unsubscribe_matches_saved_transport: true,
  tap_deep_link_and_read_tracking: true,
  broad_customer_sends_enabled: false,
  writes_performed: false,
  provider_calls_performed: false,
  customer_notifications_sent: false,
}, null, 2));
