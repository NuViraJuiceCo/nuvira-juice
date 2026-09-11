# Contact-relight-v3 photo rollout — new approval receipt

## Owner approval and boundary

On September 11, 2026, the owner explicitly approved the contact-relight-v3 OASIS, AURA and RE-NU photos for replacement across channels, including all existing sizes. The owner will create the reel: all agent reel work and generation are stopped. This receipt records that newer approval without rewriting the historical `marketing/product-contact-review-20260911/review-manifest.json`, whose review-only text predates approval.

Starting canonical commit: `5b757f261896b2c909761cec16f2909912cc0c9b` (PR #798's prior V5 rollout). This patch is prepared locally only. It does not publish the website/Appflow, update Shopify or Merchant, edit an ad, invoke a function, or alter Product records. Provider rollout is separately owned by the release coordinator.

## Frozen sources and complete size coverage

For each `{key}` in `oasis`, `aura`, `re-nu`, the approved input folder is `marketing/product-contact-review-20260911/{key}-contact-relight-v3/`. Exact PNG masters/variants are pinned in the new `scripts/media/approved-primary-photo-provenance-20260911-contact-v3.json` and deterministic encoder `scripts/media/export-approved-primary-contact-v3.mjs`.

| Use | Approved source | Delivery output |
| --- | --- | --- |
| Product hero / gallery / SEO | 1080×1350 `*-4x5.png` | 1080×1350 `*-primary.webp`, quality 88, no resize |
| Shop / Home / cart / order / reward thumbnail | 1080×1080 `*-1x1.png` | 640×640 `*-card.webp`, quality 84, proportional downsize |
| Shopify / Merchant 4:5 primary candidate | Same approved 1080×1350 crop | 1080×1350 `*-provider.jpg`, quality 95, 4:4:4, no resize |
| Square provider candidate | Same approved 1080×1080 crop | 1080×1080 `*-merchant.jpg`, quality 95, 4:4:4, no resize |
| Meta vertical still-photo placements | Exact approved 1080×1920 `*-9x16.png` | Existing approved PNG source; coordinator-owned media upload |
| Meta square still-photo placements | Exact approved 1080×1080 `*-1x1.png` | Existing approved PNG source; coordinator-owned media upload |

The new public directory is `public/images/approved-lifestyle/20260911-contact-v3/`, containing all 12 web/provider derivatives. Nothing replaces bytes at an old URL. No new crop, upscale, generation, relabeling, geometry, color or lighting edit is performed by this patch. The approved upstream contact-relight masters intentionally adjust contact lighting and a small unprinted base region; the manifest reports unchanged protected cap/label/body/headspace pixels. This encoder independently verifies every frozen file and exact 4:5/square master crop before lossy export; it does not claim lossy encoded pixels are identical to PNG pixels.

All output files preserve input XMP verbatim, including `http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia`. No source C2PA signature is copied. The encoder validates all nine inputs before creating output, rejects existing output/provenance paths, and makes no provider calls.

## Minimal source scope

Only `src/lib/approved-product-media.js` changes at runtime: the versioned media root and the additive list of retired V4/V5 hero/card URLs. Existing identity matching, exact IDs/variants, conflict rejection, alt descriptions and fallback rules remain unchanged. Existing gallery code already consumes that retired list, so no ProductDetail, Shop, CSS or gallery-handler edit is needed. The new primary plus the same three authentic supporting photographs is preserved for each target; the other eight products are unchanged.

Old `20260910` and `20260911-v5` files remain available for snapshots/error recovery but are not reintroduced into target galleries. Unknown product secondary images are not removed. The AdminProducts upload control deliberately continues showing its edited source image, and the previously migrated CompositionEditor continues using the shared renderer without another change. No cart/order/reward snapshots, inventory, prices, payment, promotion, consent, targeting, budget, backend, schema, auth, uploader or settings mutation is part of this patch.

## Verification and release handoff

Focused media contracts pin all 12 derivatives, assert the new approval receipt fields, preserve eight non-target products, enforce all current dimensions/framing and verify both retired generations in relative and absolute gallery forms. Existing offer-continuity tests change only their expected image path and retain the purchase/coupon behavior tests. Local render-state coverage is not a live/native/customer checkout claim.

An independent read-only reviewer verified all nine actual source hashes, six exact master crops, all 12 byte-identical in-memory re-encodes and XMP, all 12 older static files, and 36 gallery combinations, without source/provider edits. Full gate results and final local commit identity are kept in the outside-repository handoff evidence. Push/PR/merge/deploy require the release coordinator's next instruction.

After review, use one new exact clean merge for site-only publication and the separately coordinated Appflow Web update. Verify the new main/static product pages and all 12 assets on both live domains, then cloud artifact equivalence and actual device activation as separate gates. Merchant saves/review, Shopify media assignment and Meta placement-specific still-photo assignments do not happen automatically from this source patch. Old Appflow #52 / build 11125820 remains the baseline until a future authorized activation; do not confuse cloud activation with physical rendering proof.
