# Desktop storefront refinement — review preview

Prepared October 5–6, 2026. **Implemented locally; not published.**

## Source and boundary

- Isolated branch: `codex/desktop-layout-20261005`.
- Base: `b0127bdca0c1de2127b41966e2203571346eeecf`, the October 5 website performance release. Remote main and that release's provenance were checked before creating this branch.
- Desktop customer website only, at viewport widths of at least 1024 CSS pixels. `AppLayout` excludes admin and native runtimes from the CSS scope.
- Existing content, images, markup order, handlers, mobile utilities, backend functions, native projects, auth/payment behavior, and catalog/prices are unchanged. JSX changes add semantic presentation classes; ProductRow additionally supplies an explicit CSS-only column-count property. Separate dependency maintenance is documented below.
- No live publish, backend write, account change, order, payment, email, or provider operation was performed.

## Presentation changes

- Centered, maximum-width desktop content rather than indefinite expansion.
- A 520px desktop Home hero, bounded heading and ZIP controls, balanced feature grids, readable compact product cards, and side-by-side lower Home sections.
- Shop search beside the heading; three product columns on compact desktop and four at 1440px and above.
- Contact and Support use side-by-side layouts. Account and Rewards have desktop grouping rules; About has readable line-length caps.
- Two existing custom customer sheets have a 640px desktop width cap. Existing portaled Radix dialogs retain their existing bounded sizes.

## Evidence

- Clean production build and site-size gate: passed, **47,278,474 bytes across 380 files**, below the 49,000,000-byte limit.
- Existing critical-regression runner: **165/165 harnesses passed**, with no provider calls or production writes.
- `run-desktop-layout-tests.mjs --dist "$PWD/dist"`: **13/13 check groups passed**, covering 162 fully scoped CSS rules, actual AppLayout browser/native/admin rendering, markup invariance, and 550 SHA-256 checks: 548 original files retain their bytes; the two dependency manifests match the exact reviewed maintenance hashes.
- All 151 tracked public source files remain unchanged. The old `dist` contained 104 stale numbered copies totaling 26,912,522 bytes. That complete directory was moved intact to `/private/tmp/nuvira-desktop-deps-20261006.em1THx/pre-maintenance-dist` before rebuilding; it remains recoverable.
- The final-output comparator observed **990 browser modules** and no modules from the seven checked packages: `@capacitor/android`, `@capacitor/ios`, `postcss-selector-parser`, `postcss-nested`, `tailwindcss`, `tailwindcss-animate`, and `source-map-js`. All **201 emitted JS/CSS assets are byte-identical** to the pre-maintenance desktop bundle. This comparison does not cover HTML, copied public assets, deployed files, or installed native apps.
- Diagnostic-baseline gate: passed with **zero lint diagnostics, zero TypeScript diagnostics, and zero new audit fingerprints**. All eight newly reported findings were resolved. Audit still reports 13 existing high-severity package findings / 17 fingerprints; the approved baseline, waivers, and website exception are unchanged.

The original browser screenshot/interaction matrix below remains valid. Post-maintenance Shop smoke checks also passed at 1440 and 390 CSS pixels: no document overflow, 16px search text, successful AURA filtering, and preserved mobile presentation. Refreshed screenshots are `shop-desktop-maintenance-1440.png` and `shop-mobile-maintenance-390.png` in the same evidence directory. Temporary viewport overrides were reset.

- Preview-handler checks reject all writes and functions, reject protected/unknown reads, enforce loopback hosting and restrictive CSP, reject traversal, and disclose the historical local catalog.
- Browser shop geometry at 390, 820, 1024, 1280, 1440, and 1920 CSS pixels: no document-wide horizontal overflow. Desktop card widths stay bounded; 1920px main content is capped at 1280px.
- Actual public UI interactions: search for AURA, product-detail navigation, selecting three bottles, adding to the local cart, qualifying minimum message, enabled checkout control, category filtering, and FAQ expansion. Test cart was cleared afterwards. No checkout was submitted.
- At 390px, matching Home and Shop components have identical measured widths and font sizes to the exact released build. Existing mobile layouts were also visually compared.
- Contact and Support inspected at 1024px and 1440px; Home at 1024px, 1440px, and 1920px. Desktop screenshots and measurements are in the workspace's `outputs/desktop-layout-20261005/` directory.

## Separate dependency maintenance

- Exactly five locked package entries changed: `@capacitor/core`, `@capacitor/ios`, and `@capacitor/android` from 8.3.4 to exact 8.4.3 pins; `postcss-selector-parser` from 6.1.4 to a 7.1.6 override; and `source-map-js` from 1.2.1 to a 1.2.2 override. No unrelated package entries changed. Capacitor CLI remains locked at 8.3.4 with its existing `^8.3.4` declaration.
- A fresh isolated `npm ci` succeeded and applied the existing `@capacitor/live-updates@0.5.0` patch. That verified dependency tree now resides in this checkout; `npm ls` is clean. The previous shared dependency cache was preserved.
- These npm package patches **do not repair already installed native apps**. Tracked iOS/Android projects remain unmodified and unsynced; the iOS Swift Package pin remains 8.3.4. Native remediation, build, device testing, and distribution remain separate work. No native V3 work or deployment was performed.

## Open verification boundaries

Authenticated Account/Rewards states and eligibility-only modals received structural checks, not authenticated browser testing. Browser evidence uses the real built UI with historical public catalog fixtures and local photos. It does not verify live availability/pricing, sign-in, delivery eligibility, forms, payment submission, analytics, native-device behavior, or business outcomes. The browser's temporary zoom-adjusted viewport was measured using `innerWidth`, not assumed from tool dimensions.

## Review / reproduce

```sh
DISABLE_BASE44_VITE_PLUGIN=true npm run build
node scripts/migration/run-desktop-layout-tests.mjs --dist "$PWD/dist"
npm run ci:critical-regressions
npm run ci:diagnostic-baseline
node scripts/qa/serve-desktop-preview.mjs
```

Open `http://127.0.0.1:4196/` in a desktop-width browser (at least 1024 CSS pixels). The fixture server cannot submit purchases or contact messages. Its visible notice is preview-only and is not in the website bundle. The one-time structural scope verifier intentionally compares this presentation patch against the exact released base; it is not a blanket permanent freeze on future business-code development.

PR creation/review and publishing remain pending. Publishing requires separate approval after visual review. No live website, native V3, backend, or provider changes are included in this local handoff.
