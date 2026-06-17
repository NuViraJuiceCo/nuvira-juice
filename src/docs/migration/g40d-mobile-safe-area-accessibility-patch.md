# G40D — Mobile Safe-Area Top Layout Patch

**Branch:** `codex/g40d-mobile-safe-area-accessibility`
**Commit:** `G40D: fix mobile safe-area top layout`
**Date:** 2026-06-17
**Status:** `mobile_safe_area_patch_merged_publish_pending_builder_sync`

---

## 1. Problem Summary / Evidence

Customer app pages besides Home had their page headers / back buttons overlapping the iOS status bar / notch on mobile (iOS Safari, PWA, Capacitor webview).

Observed examples:
- `/events` — sticky header `"sticky top-0 bg-background/95 … py-3"` had **no** `env(safe-area-inset-top)` padding. The "Events & Community" title and back arrow sat directly under the iOS clock/battery row.
- `OrderTracker` gradient header — used hardcoded `pt-10` (`2.5rem`). On devices with larger notches (iPhone 14 Pro / 15 series) `env(safe-area-inset-top)` can be `~59px`, so the back button was partially obscured.
- `OrderConfirmation` loading/processing state — `min-h-screen flex items-center justify-center` without a safe-area top spacer.

Pages that already handled safe-area correctly (not patched):
- **Home** — inline `paddingTop: 'max(1.25rem, env(safe-area-inset-top))'` on its header element ✅
- **Account** — inline `paddingTop: 'max(2.5rem, env(safe-area-inset-top))'` ✅
- **Rewards** — inline `paddingTop: 'max(1.5rem, env(safe-area-inset-top))'` ✅
- **Cart** — inline `paddingTop: 'max(1.5rem, env(safe-area-inset-top))'` ✅

---

## 2. Affected Surfaces

| Surface | Issue | Severity |
|---------|-------|----------|
| `/events` sticky header | No safe-area — title under status bar | High |
| `OrderTracker` gradient header (all states) | `pt-10` hardcoded — unsafe on tall notch | High |
| `OrderTracker` muted/cancelled header | Same `pt-10` issue | Medium |
| `OrderTracker` loading state skeleton header | Same `pt-10` issue | Medium |
| `OrderConfirmation` loading state container | No safe-area top spacer | Low |

---

## 3. Root Cause

Each page managed (or failed to manage) top safe-area padding independently. The app shell (`AppLayout`) does not inject a top safe-area spacer — each page is responsible. Pages added by feature branches after the Home pattern was established did not consistently adopt `env(safe-area-inset-top)`.

The Events sticky header used `py-3` (12px top + bottom) which is less than the 44–59px safe-area on notched iPhones. Because it is `sticky top-0`, it pins exactly to the viewport top, placing content behind the status bar.

The OrderTracker gradient headers used `pt-10` (40px) which is also insufficient for tall-notch iPhones (iPhone 14 Pro: 59px, iPhone 15 Pro: 59px).

---

## 4. Chosen Fix — Shared Layout Helper

### `src/components/layout/MobilePageHeader.jsx`

A new shared `MobilePageHeader` component and `SafeAreaTop` helper:

```jsx
// Sticky header with safe-area — drop-in replacement for ad-hoc headers
<MobilePageHeader title="Events & Community" backTo="/account" />

// For colored/gradient headers on pages like OrderTracker
import { SAFE_TOP_PADDING } from '@/components/layout/MobilePageHeader';
style={{ paddingTop: SAFE_TOP_PADDING }}
// SAFE_TOP_PADDING = 'max(1rem, env(safe-area-inset-top))'
```

The `SAFE_TOP_PADDING` constant (`max(1rem, env(safe-area-inset-top))`) ensures:
- On web/desktop: renders as `1rem` (16px) — no layout jump
- On iOS notch: `env(safe-area-inset-top)` wins (~44–59px)
- The `max()` prevents zero/negative values if the env variable is unavailable

### Back button tap target

`MobilePageHeader` uses `w-11 h-11` (44px × 44px) which meets Apple HIG minimum touch target guidance.

### Pages patched

| File | Change |
|------|--------|
| `pages/Events.jsx` | Replaced ad-hoc sticky header with `<MobilePageHeader>` |
| `pages/OrderTracker.jsx` | Replaced `pt-10` with `paddingTop: SAFE_TOP_PADDING` on all 3 colored/muted header instances + loading skeleton |
| `pages/OrderConfirmation.jsx` | Added `paddingTop: 'env(safe-area-inset-top)'` to loading/processing container |

### Pages NOT patched (already correct)

- `pages/Home.jsx` — unchanged, already handles safe-area
- `pages/Account.jsx` — unchanged, already handles safe-area
- `pages/Rewards.jsx` — unchanged, already handles safe-area
- `pages/Cart.jsx` — unchanged, already handles safe-area
- `components/layout/MobileNav.jsx` — unchanged, already uses `env(safe-area-inset-bottom)`

---

## 5. Accessibility Criteria

| Criterion | Status |
|-----------|--------|
| 44px minimum back button tap target | ✅ `w-11 h-11` in MobilePageHeader |
| No tap target under status bar/notch | ✅ Fixed by safe-area padding |
| Page title visually clear | ✅ Below status bar after patch |
| Contrast unchanged | ✅ No color changes made |
| Keyboard/focus behavior | ✅ Unaffected — no focus management changed |
| No content hidden behind fixed header | ✅ Sticky header pushes content down naturally |
| Dynamic text does not collide with status bar | ✅ Safe-area padding provides minimum clearance |

---

## 6. Test Coverage

**Test harness:** `scripts/migration/run-g40d-mobile-safe-area-layout-tests.mjs`

| # | Test case |
|---|-----------|
| 1 | `MobilePageHeader.jsx` exists and exports `SAFE_TOP_PADDING` and `SafeAreaTop` |
| 1d | MobilePageHeader uses `sticky top-0` with `paddingTop: SAFE_TOP_PADDING` |
| 2 | Events.jsx imports and uses `MobilePageHeader` |
| 2b | Events.jsx no longer has raw sticky header without safe-area |
| 3 | OrderTracker imports and uses `SAFE_TOP_PADDING` on gradient headers |
| 3c | OrderTracker no longer has raw `pt-10` on gradient header |
| 3d | All 3+ SAFE_TOP_PADDING usages present in OrderTracker |
| 4 | OrderConfirmation loading container has safe-area top padding |
| 5 | Home still uses `env(safe-area-inset-top)` (regression guard) |
| 5b | Home does NOT import MobilePageHeader (no double-padding) |
| 6 | MobilePageHeader back button has `w-11 h-11` (44px tap target) |
| 7 | AppLayout has no fixed/sticky header at `top:0` without safe-area |
| 8 | MobileNav bottom safe-area unchanged |
| 9 | No Stripe/Shopify/Hub calls in patched files |
| 9b | No entity writes in patched files |
| 10 | No PII hardcoded in layout helper |

Run:
```bash
node --check scripts/migration/run-g40d-mobile-safe-area-layout-tests.mjs
node scripts/migration/run-g40d-mobile-safe-area-layout-tests.mjs
```

---

## 7. No-Write Confirmation

This PR:
- ✅ Does **not** mutate Order records
- ✅ Does **not** mutate ShopifyOrder records
- ✅ Does **not** mutate FulfillmentTask records
- ✅ Does **not** mutate Event records
- ✅ Does **not** mutate any native or Hub records
- ✅ Does **not** call Stripe
- ✅ Does **not** call Shopify
- ✅ Does **not** call Hub APIs
- ✅ Does **not** send notifications
- ✅ Does **not** run sync/repair/replay logic
- ✅ Does **not** create logs or queues
- ✅ Does **not** change production/delivery migration behavior
- ✅ Does **not** change backend functions

---

## 8. Publish Limitation

**Builder source is desynced from GitHub main.**

This patch is present in the Builder's live source code (via Base44 sync) but UI publish remains blocked until:
1. Builder source is confirmed synced to GitHub main branch containing G40D
2. Builder preview bundle contains G40D marker classes (e.g., `SAFE_TOP_PADDING`, `MobilePageHeader`)
3. Pending publish scope is clean (no unrelated Builder changes)

**Readiness classification:** `mobile_safe_area_patch_merged_publish_pending_builder_sync`

---

## 9. Post-Publish Smoke Plan

After safe publish, smoke test on iPhone (real device or iOS simulator):

| Route | Check |
|-------|-------|
| `/events` | Title "Events & Community" and back arrow fully below status bar |
| `/order-tracker/:id` | Gradient header back button below status bar; `pt-10` gone |
| `/order-confirmation` loading state | Spinner centered, not overlapping status bar |
| `/account` | Unchanged — safe-area padding still present |
| `/rewards` | Unchanged — safe-area padding still present |
| `/` (Home) | Unchanged — logo header safe-area still present |
| `/shop` | Unchanged — no header |
| `/cart` | Unchanged — safe-area padding still present |
| Bottom nav | Unchanged — `env(safe-area-inset-bottom)` still present |

Verify on all:
- No text/header/back button overlaps iOS status bar
- No double-padding on desktop/web
- No layout jump
- Bottom nav unaffected

**If live smoke passes:** update status to `mobile_safe_area_patch_live`  
**If Builder source still desynced:** status remains `mobile_safe_area_patch_blocked_by_builder_source_desync