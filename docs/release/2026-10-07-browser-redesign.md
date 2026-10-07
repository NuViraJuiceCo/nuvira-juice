# Browser Redesign Release Candidate

## Source

- Current live website baseline: `dec1d650d1d2b4cbe4d063f30171aae4a7a4cb40` (PR #811).
- Speed head: `792381f01ff014ac3534a8f3db2a7123292ff3a2` (PR #810), merged into main before this candidate. This is source integration, not a deployment.
- Frozen design source: `d20cd0f` on `codex/desktop-brand-20261006`.
- The design delta from its existing Speed ancestor `2dc3ae7` was applied with a three-way indexed patch onto the current main. This preserves the Speed and sign-in fixes through actual main ancestry without importing an unnumbered integration merge.
- The only patch conflict was the critical-regression runner list; both existing provider-return coverage and the additional design/member/audit suites are retained.

## Scope

Browser storefront, product and program presentation, customer account surfaces,
navigation, cart feedback, responsive layout, dialog accessibility, truthful
product labels, and the approved $5 referral offer. Minimum-order and checkout
authority remain unchanged. Preview servers are local QA tools, not production
authentication proxies or production checkout implementations.

No Base44 function publication, account mutation, inventory operation, payment,
reward redemption, Appflow update, store build, installed-app update, or V3
deployment is part of this release. Native CI checks shared-code compatibility;
passing them does not authorize a native release.

## Required Promotion Evidence

- Clean source checkout, exact SHA, and locked dependency installation.
- Secret scan, diagnostic baseline, complete critical regressions, production
  build and unchanged site-size cap, and all required hosted PR/main checks.
- No backend, native platform, workflow, dependency, or release-history validator
  changes; retain explicit prior merge mappings and zero fallback mappings.
- Responsive Safari/browser customer-flow checks against the combined bundle.
- Rehashed current-live rollback artifact before publication.
- Final publication confirmation for the exact candidate, then website-only
  publication and hosted asset/hash, route and responsive smoke verification.

Local previews and fixture checks do not certify provider completion, payment,
real reward redemption, every authenticated state, or field Core Web Vitals.
Private account screenshots and external release receipts remain outside Git.
