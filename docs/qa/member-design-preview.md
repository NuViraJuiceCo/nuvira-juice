# Read-Only Member Design Preview

This is separate from the anonymous desktop review on port 4203. It serves the
same local build with real browser authentication and a narrowly filtered proxy.
It is not a deployment or a checkout/payment test environment.

```sh
node scripts/qa/serve-member-preview.mjs --port 4204
```

Open `http://127.0.0.1:4204/account` directly, not inside the review iframe.
Use your existing account's normal Google or email/password sign-in. The existing
browser callback helper returns to this origin, not the native app bridge.
The server does not save or log credentials, tokens, URLs, account data or cookies.
Authentication tokens use the application's existing browser storage; sign out
after reviewing and stop the server when finished.

## Allowed

- Current user, dashboard, rewards tiers, order history/detail.
- Program journey list/detail and notification list (not marking read).
- Own profile, bag returns and notification preferences. Alternate identity emails
  must be confirmed by the authenticated dashboard before any entity read.
- Existing-account email/password authentication. Google/Apple use the normal
  provider navigation; no provider configuration is changed.

## Blocked

All entity writes, account setup/updates/deletion, uploads, checkout, payments,
reward claims, subscription changes, journey progress, notification changes,
push registration, analytics relays, admin actions and unreviewed endpoints.
Third-party scripts, frames, workers and browser API connections are blocked by
CSP. Backend reads still enforce their existing authentication and ownership.
No service-role key, production cookie or alternate API host is accepted.

Public product data remains the local historical design fixture. Delivery ETA,
referrals or other unreviewed member services may show an unavailable state.
Existing UI controls remain visible for layout review, but live save actions fail
at the server. Local-only state changes (such as cart edits) are still possible.

## Verification

`node scripts/migration/run-member-preview-tests.mjs` tests allow/deny contracts,
identity scope, both SDK transport paths, static containment, origin/host checks,
size limits and upstream redirect rejection with a synthetic upstream. It does
not prove a real provider login. A successful return and member-page data load in
the browser are required for that claim.
