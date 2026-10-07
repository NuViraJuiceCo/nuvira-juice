# Website speed and navigation continuity — October 6, 2026

Status: locally implemented and tested; **unpublished**. Targeted local Chrome responsive QA passed; final-source hosted CI is pending. This is website maintenance, not V3 or an app-channel release.

## Source and boundary

Base: `27bd7d184e7d957a07aef59b33744f01e7af1c08` (PR #809). Branch: `codex/live-speed-continuity-20261006`. These results describe the working-tree candidate, not an immutable release commit: the receipts report the base `HEAD` while the changes are uncommitted. Freeze and reverify the final reviewed source before publication.

No backend handler, schema, dependency, native shell/configuration, authentication authority, checkout/payment logic or private V3 change is included. No website/function deployment, Appflow promotion or store distribution is authorized by this note. The earlier dashboard-gateway publication is not being repeated.

## Website changes

1. Eligible public and already-authorized customer routes render without the layout's 0.22-second exit/entry animation sequence. Route-code loading stays inside the content area, with navigation retained and a pathname-keyed neutral fallback rather than the previous page's account content. Native, admin, unknown and captured authentication-return states keep their prior layout path; existing authentication/onboarding gates remain in place.
2. Website Account sections and Order History cards no longer wait through entrance-animation delays. Native keeps its existing animation props. These presentation changes do not enable queries or grant access.
3. Signed-in desktop hover/focus may warm **code only** for Account and Rewards. Exact-route checks, native/admin exclusions, one speculative member import at a time and retryable failures bound this behavior. It neither mounts page components nor prefetches customer data.
4. About/local-landing heroes and product-gallery thumbnail buttons opt into lighter website image delivery. Original JPEG fallbacks, native URLs, approved primary/card mappings, full gallery images and SEO image identities remain unchanged. About retains its existing separate desktop/mobile photos and restores the correct originals on derivative failure.

## Image provenance and measured payloads

`scripts/media/website-image-inputs-20261006.json` freezes 17 already-published originals by hash. `website-image-provenance-20261006.json` records 18 WebP derivatives totaling **1,392,818 bytes**, their dimensions, hashes, encoding settings and fidelity measurements. Originals and source XMP are retained; composition/aspect ratio are preserved without cropping, enlargement, retouching or generation. Resizing and lossy encoding are disclosed, not represented as identical decoded pixels.

- About desktop hero: 505,127 → 144,726 bytes for the 1440px candidate; mobile hero: 285,513 → 105,976 bytes. Larger/high-DPR selections may retain an original source.
- Twelve 384px gallery thumbnails: 3,571,495 original bytes → 318,498 derivative bytes, **91.08% less** for that complete thumbnail set. This is a file-size comparison, not measured page-speed improvement; actual delivery depends on browser selection, caching and visible images.
- All originals remain packaged. The successful candidate build is **48,680,256 bytes across 400 files**, below the unchanged **49,000,000-byte** limit by only **319,744 bytes**. Do not silently add assets or raise the limit.

## Verification

| Area | Candidate status |
| --- | --- |
| Critical regressions | Passed: 177/177 harnesses, no provider calls or production writes |
| Diagnostics | Passed baseline gate: zero lint/typecheck diagnostics and zero new audit fingerprints |
| Existing audit findings | Still 13 high-severity packages / 17 fingerprints, zero critical; not a clean vulnerability audit |
| Build/site-size gate | Passed at the byte count above |
| Native-history focused tests | Passed: 30 tests, including four new mapping/ancestry cases |
| Local Chrome responsive QA | Passed targeted About, catering hero, Shop/AURA gallery, and Home navigation; 390px, 768px, 1440px and normal 1800px checks; see limits below |
| Final committed-source CI and deployed parity | Pending; no result inferred from local tests |

Workspace receipts: `outputs/live-speed-continuity-20261006/candidate-regressions.json` (2026-10-06 21:05:10 UTC), `diagnostic-candidate.json` (21:05:11 UTC) and `build.log`. Existing vulnerability policy/waivers are not relaxed. Three new website harnesses cover image delivery, motion continuity and member code warmup; existing route/media tests are extended.

Chrome selected the 1440px About desktop derivative (624×480 rendered at normal desktop width), the distinct 1066px mobile photo at 390px, and the desktop photo at the 768px breakpoint. Catering selected 1800px WebP on desktop and 840px on mobile. These checks had no horizontal page overflow. AURA's approved primary/card image stayed unchanged; all three secondary thumbnail derivatives loaded, and clicking image 2 opened the original full-size JPEG. Route loading retained navigation with neutral content while the next module loaded. Screenshots are in the same workspace receipt folder.

This local preview uses a historical anonymous catalog and blocks live services, writes and external images. Its blocked external About logo is a preview limitation, not deployed-image evidence. It cannot establish authenticated production behavior, production network timing, Core Web Vitals, provider/payment outcomes or physical-device readiness. Image failure recovery was tested in the focused source harnesses, not injected into the browser.

## Separate native release-history correction

The previous post-merge Native Quality Gate failed during manifest generation, after its iOS build passed. Three internal merges lacked explicit historical PR mappings. Read-only GitHub associations plus exact local merge ancestry establish `306a8dbf… → PR808`, `60463a34… → PR805` and `8bc2dcf0… → PR804`. The release-input file now records those mappings and source PR/head/merge provenance.

The validator, workflows, prior records and `previous_released_commit` (`e1dcdc5f2adcc788251c0f1dbd33fe3e932397aa`) remain unchanged. Hosted full-history CI must confirm the correction; the shallow local checkout cannot certify the entire historical range. Do not erase the failed run or substitute fixture tests for a native release gate.

Appflow remains separately held: the full website tree contains earlier native-visible changes beyond this maintenance patch. An isolated app-performance candidate needs an explicitly reviewed source delta, compatibility/device evidence and the runbook's common-source/provenance requirements before action-time promotion approval. Correcting release metadata does not authorize updating installed apps.

## Release limits

Complete browser QA and final-source CI before requesting action-time website publication approval. Preserve the exact prior approved bundle/source for rollback and verify deployed asset parity afterward. No live payment/provider test, physical-device verification, production Core Web Vitals, universal speed improvement or issue-free launch is established here. Follow `change-and-release-runbook.md`; keep website, Appflow, native/store and V3 status separate.

## Reconciliation after the separate browser sign-in release

The preceding metrics are the original speed candidate. A separate website-only sign-in repair subsequently shipped from PR #811, merge `dec1d650d1d2b4cbe4d063f30171aae4a7a4cb40`. Its published entry is `/assets/index-b82w7Qcv.js`, SHA-256 `bb4c3ccb64eaa9a2dedf8a22c81080589ff708c4d3890dfdee55759fb0ccd64d`. The speed branch now incorporates that exact main before any later publication; the old `index-Daj25Dnl.js` speed build must not be deployed over the sign-in repair.

The four sign-in implementation files (`authReturnTo.js`, `NativeLogin.jsx`, `Login.jsx`, `Register.jsx`) are retained byte-for-byte from the released sign-in source. Its browser-provider-return harness joins all three speed harnesses, making the combined critical runner 178 harnesses. The historical native-merge mappings already present on both branches are retained without duplication. Only the temporary acknowledgement excluding this speed PR #810 is removed, because this candidate includes that work; all other acknowledgements, validators, workflows and the previous-released baseline remain unchanged.

Reconciliation requires fresh exact-commit tests, build identity, hosted CI, local smoke, and a rollback copy of the sign-in-fixed release. Current receipts are maintained in `outputs/live-speed-continuity-20261006/after-sso/`. Earlier green results do not substitute for these checks. The desktop redesign remains excluded. No new production, backend, provider, Appflow or store action is authorized by this reconciliation; website publication still requires separate action-time approval.

Final hosted-manifest inspection caught one additional release-record requirement: the internal reconciliation merge `b60d465c3ea68b95648a21bdd4f25305f5aaed8c` needs an explicit PR #810 mapping. The PR-only fallback had passed, but is unavailable after merging to main. Record the observed open PR head and the actual ordered parents (`2dc3ae7…`, `dec1d65…`) without inventing a future PR merge commit. Preserve all prior mapping records, validators, workflows and the previous-released baseline. The final candidate must pass fresh CI and produce a manifest with **no** `current_pr_validation_branch_merge` fallbacks before publication approval; the earlier green `b60d465` CI is historical evidence, not post-merge readiness proof.
