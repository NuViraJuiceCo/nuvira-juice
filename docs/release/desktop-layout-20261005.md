# Desktop storefront refinement — review preview

Prepared October 5–6, 2026. **Implemented locally; not published.**

## Source and boundary

- Isolated branch: `codex/desktop-layout-20261005`.
- Base: `b0127bdca0c1de2127b41966e2203571346eeecf`, the October 5 website performance release. Remote main and that release's provenance were checked before creating this branch.
- Desktop customer website only, at viewport widths of at least 1024 CSS pixels. `AppLayout` excludes admin and native runtimes from the CSS scope.
- Existing content, images, markup order, handlers, mobile utilities, backend functions, native projects, auth/payment behavior, catalog/prices, and dependencies are unchanged. JSX changes add semantic presentation classes; ProductRow additionally supplies an explicit CSS-only column-count property.
- No live publish, backend write, account change, order, payment, email, or provider operation was performed.

## Presentation changes

- Centered, maximum-width desktop content rather than indefinite expansion.
- A 520px desktop Home hero, bounded heading and ZIP controls, balanced feature grids, readable compact product cards, and side-by-side lower Home sections.
- Shop search beside the heading; three product columns on compact desktop and four at 1440px and above.
- Contact and Support use side-by-side layouts. Account and Rewards have desktop grouping rules; About has readable line-length caps.
- Two existing custom customer sheets have a 640px desktop width cap. Existing portaled Radix dialogs retain their existing bounded sizes.

## Evidence

- Production build and site-size gate: passed, 47,278,072 bytes across 380 files, below the 49,000,000-byte limit.
- Existing critical-regression runner: **165/165 harnesses passed**, with no provider calls or production writes.
- `run-desktop-layout-tests.mjs --dist "$PWD/dist"`: **12/12 check groups passed**, covering 162 fully scoped CSS rules, actual AppLayout browser/native/admin rendering, markup invariance, and 550 protected-file SHA-256 comparisons.
- Preview-handler checks reject all writes and functions, reject protected/unknown reads, enforce loopback hosting and restrictive CSP, reject traversal, and disclose the historical local catalog.
- Browser shop geometry at 390, 820, 1024, 1280, 1440, and 1920 CSS pixels: no document-wide horizontal overflow. Desktop card widths stay bounded; 1920px main content is capped at 1280px.
- Actual public UI interactions: search for AURA, product-detail navigation, selecting three bottles, adding to the local cart, qualifying minimum message, enabled checkout control, category filtering, and FAQ expansion. Test cart was cleared afterwards. No checkout was submitted.
- At 390px, matching Home and Shop components have identical measured widths and font sizes to the exact released build. Existing mobile layouts were also visually compared.
- Contact and Support inspected at 1024px and 1440px; Home at 1024px, 1440px, and 1920px. Desktop screenshots and measurements are in the workspace's `outputs/desktop-layout-20261005/` directory.

## Open boundaries and release hold

The full diagnostic-baseline gate **does not pass**: it finds eight newly reported/unapproved npm-audit fingerprints, with zero new lint or TypeScript diagnostics. A read-only rerun against the exact released source reproduces the same eight fingerprints. Package manifests, lockfile, approved baseline, and installed dependencies match the release. Findings include two critical Capacitor advisories and build-toolchain findings; production reachability has not been established. This patch does not waive, suppress, or fix those findings. Review them before release approval.

Authenticated Account/Rewards states and eligibility-only modals received structural checks, not authenticated browser testing. Browser evidence uses the real built UI with historical public catalog fixtures and local photos. It does not verify live availability/pricing, sign-in, delivery eligibility, forms, payment submission, analytics, native-device behavior, or business outcomes. The browser's temporary zoom-adjusted viewport was measured using `innerWidth`, not assumed from tool dimensions.

## Review / reproduce

```sh
DISABLE_BASE44_VITE_PLUGIN=true npm run build
node scripts/migration/run-desktop-layout-tests.mjs --dist "$PWD/dist"
npm run ci:critical-regressions
node scripts/qa/serve-desktop-preview.mjs
```

Open `http://127.0.0.1:4196/` in a desktop-width browser (at least 1024 CSS pixels). The fixture server cannot submit purchases or contact messages. Its visible notice is preview-only and is not in the website bundle. The one-time structural scope verifier intentionally compares this presentation patch against the exact released base; it is not a blanket permanent freeze on future business-code development.

Publishing remains a separate action requiring approval after visual review and resolution of the release-gate findings. No native V3 or live-app deployment is included.
