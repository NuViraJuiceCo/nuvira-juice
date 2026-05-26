# May 30 Event Push And Rewards

## Scope

This is an isolated event activation feature for the May 30 event. It does not modify order sync, native safe sync, Stripe, Shopify, production, fulfillment, inventory, compliance, refund, repair, replay, checkout, payment, Hub retirement, or broad notification behavior.

## Push Feasibility Result

Native App Store push is not feasible before May 30 from the current app state unless a separate native shell/binary already exists outside this repo and can be updated/tested/released in time.

Web Push is feasible as a best-effort event path for supported browsers and installed PWAs.

Current stack:

- Base44-hosted Vite/React web app.
- No Expo, React Native, Capacitor, Ionic, iOS, or Android project files.
- This branch adds a PWA manifest, root service worker, browser push subscription storage, and event-only push send path.
- No APNs, FCM, or Expo credentials are present.

The current published app cannot receive true APNs/FCM native device push without native push infrastructure. A native mobile shell would require app credentials and a new binary release if the current shell lacks push code.

For May 30, the implemented primary path is:

- in-app notification plus the one-time points bonus for everyone who redeems.
- event-only Web Push only when the user's browser/device supports Push API, the user enables it, and VAPID secrets are configured.

If push cannot send, points and in-app notification still succeed. The response reports a safe `push_skipped_reason`.

## Feature Flags

Required for live award behavior:

```text
ENABLE_MAY30_EVENT_BONUS=true
ENABLE_MAY30_EVENT_PUSH=true
MAY30_EVENT_KEY=may30_event_visit
MAY30_EVENT_BONUS_POINTS=250
WEB_PUSH_VAPID_PUBLIC_KEY=BHmr7cCgm_eL3ckBL91ZKnvCqXvLax8pahXxpFCY8qwFXi0alWve4tDDJaaSDTuLwA-4VSEWBHMMlE_BixdHWaM
WEB_PUSH_VAPID_PRIVATE_KEY=<matching private key, stored only in Base44 secrets>
WEB_PUSH_CONTACT=mailto:info@nuvirajuice.com
```

If `ENABLE_MAY30_EVENT_BONUS` is not `true`, redemption returns a safe skipped response and does not award points or create a notification.

## Event Flow

- User scans a QR/link to `/event/may30`.
- User must be authenticated.
- User may tap `Enable Event Push` if the browser supports it.
- User taps `Claim Event Bonus`.
- Frontend calls `redeemMay30EventBonus` with `event_key: "may30_event_visit"`.
- Backend awards 250 points once per authenticated user.
- Backend creates one in-app notification:
  - Title: `Welcome To NuVira`
  - Body: `Your 250 point event visit bonus has been added.`
- Backend does not send broad notifications.
- Backend attempts Web Push only for this event bonus if an active subscription exists.
- Backend does not call Stripe, Shopify, Hub, APNs, FCM, Expo, or broad notification providers.

## Idempotency

The event bonus uses:

```text
event_visit_bonus_may30_${user_id}
```

Duplicate protection checks:

- `CommandLog.idempotency_key`
- existing `UserPoints.points_history[].idempotency_key`
- existing `Notification.idempotency_key`

Duplicate redemption returns `already_claimed/skipped` and does not add points or create another notification.

## Device Setup Notes

Desktop Chrome/Edge and Android Chrome can generally use Web Push from the HTTPS app after the user grants permission.

iPhone Safari/WebKit web push usually requires:

- iOS 16.4 or newer.
- Open `https://www.nuvirajuice.com`.
- Share button.
- Add to Home Screen.
- Open NuVira from the Home Screen icon.
- Log in.
- Open `/event/may30`.
- Tap `Enable Event Push`.

Normal in-browser Safari tabs may not expose Push API. If unsupported, the event page still allows points redemption and in-app notification.

## Post-Event Native Push Work

Proper push after the event needs one of these paths:

- Native shell: APNs/FCM credentials, device token registration, token storage, send function, TestFlight/Play Store testing, and a new app binary if the current shell lacks push code.
- Web/PWA push: manifest, service worker, VAPID keys, browser subscription flow, subscription storage, send function, and Safari/iOS installed web app testing.

Until then, the app supports in-app notifications only.
