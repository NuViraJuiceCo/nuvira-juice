# Responsive checkout presentation

## Source and scope

Base: `267e8eed882e826b888025835c08a426eae1b8ad` (PR #778). The owner approved the mobile checkout design and asked to extend the same treatment to computer and tablet. This change adds the approved forest/ivory palette, warm rewards accents, layered cards, product thumbnails, three progressive sections, a persistent total/action bar, and a desktop order-summary sidebar.

All pre-render checkout state, pricing, delivery eligibility, scheduling, profile persistence, bag-return persistence, idempotency, checkout-start error handling, and payment-request construction are byte-identical to the base. The compared region begins at `CHECKOUT_PROCESSING_WATCHDOG_MS` and ends before the empty-cart render guard; SHA-256: `d90ddd316a058597dda8bd79ad657fe216ee3c6d265cd6d07946bcee06230cc1`.

The original Stripe card/express/native-wallet handlers and success/error callbacks are unchanged. The existing card submit button is wrapped in a presentation-only action bar, inside its original form. Other payment consumers retain their inline button. No Base44 function, schema, entity, provider setting, notification, stock, loyalty balance, account, or tracking contract changes are included.

## Information retained

- Contact email, first/last name, phone, optional SMS consent/disclosure.
- Saved delivery address editing and the actual Google-assisted address control.
- Backend delivery eligibility, scheduling options, fees, minimums, waitlist and route-review handling.
- Points, credits, active rewards, legacy subscriber benefits, validated promotional/referral codes, complete price breakdown.
- Eligible bag returns, counts, future verified credit, cleanliness requirements.
- The unchanged health advisory and its versioned acknowledgment.
- Provider-supported payment choices, confirmed delivery, authoritative payment total, existing payment-error/unknown-state protection.
- Guest payment and subsequent loyalty activation.

Sections collapse but remain mounted, so editing does not discard the selected date or bag counts. Financial/contact/delivery inputs are disabled after payment starts; the existing Edit order details path must be used to change them. No prototype fixture is imported by shipped source.

## Local verification

- 129 isolated browser assertions using the actual Checkout component and actual EmbeddedPayment component with synthetic API/auth/cart/Stripe boundaries. Covers 320–1280 px, dark/light, tablet, desktop sidebar, no horizontal overflow, one dock, saved contacts/address editing, rewards/credits/promo arithmetic, bag request propagation, date persistence, health acknowledgment, guest address selection and payment, route-review accessibility, blocked/unavailable scheduling, authoritative total, card failure, and ambiguous-start lock.
- 27 focused static contract checks, registered in the critical runner.
- Original checkout processing, guest/loyalty, address/scheduling, promotion, native wallet, and tracking regressions remain applicable.
- Screenshots and machine-readable local evidence are written under ignored `release-evidence/checkout-design/`.

The browser suite intercepts and blocks all non-local network transport. It cannot create a production record, charge a card, contact a provider, or send a customer message. These tests do not claim new live Stripe/wallet or physical-device verification.

To reproduce:

```sh
npx vite --config scripts/tests/checkout-browser/vite.config.mjs
# In a second terminal, with Playwright available (or NUVIRA_PLAYWRIGHT_MODULE set):
node scripts/tests/checkout-browser/browser-tests.mjs
node scripts/migration/run-mobile-checkout-experience-tests.mjs
npm run ci:critical-regressions
npm run lint
npm run typecheck
npm run build
npx cap sync
npm run release:verify-bundle-parity
```

## Release boundary

This document records implementation/local QA, not a production release. Follow the change-and-release runbook: green PR gates, fresh serialized canonical lock, clean exact-merge site build/deploy and live responsive smoke; Appflow from that same merge and physical-device evidence before claiming the native app is updated. Preserve the now-live Meta server-funnel relay and flags from PR #778. No broad Base44 Publish App, function deploy, native archive, or provider mutation is part of this checkout presentation change.
