# Unified V5 product-photo rollout

## Scope and approval

Owner-approved September 11 V5 soft-daylight AURA, OASIS and RE-NU photographs, reused without further generation, retouching, crop or upscaling. This source change prepares website and native media only. It does not publish the V5 reel, deploy a backend, update Product records, or upload to Shopify/Merchant Center.

Canonical starting source: `1bf90985d7a3bda4106b4baadfecbcf2a189be16`. Existing account, cart, price, availability, loyalty, payment, consent and provider behavior must remain unchanged.

## Static assets and provenance

`public/images/approved-lifestyle/20260911-v5/` contains, for each flavor:

- `*-primary.webp`: approved 4:5 crop, 1080×1350, no resize; WebP quality 88.
- `*-card.webp`: approved square crop proportionally downsized to 640×640; WebP quality 84.
- `*-provider.jpg`: same approved 4:5 crop, 1080×1350, no resize; JPEG quality 95, 4:4:4, for a separately approved provider upload after these URLs are live.
- `*-merchant.jpg`: optional 1080×1080 square JPEG, same approved square crop, no resize.

`scripts/media/approved-primary-photo-provenance-20260911-v5.json` pins every approved PNG source and generated asset, dimensions, bytes and XMP. `scripts/media/export-approved-primary-v5.mjs` is a local-only deterministic encoder. It validates all source hashes and exact crop pixels against the 9:16 master before writing, refuses overwrites, and embeds the source XMP verbatim. It requires explicitly supplied source-root and Sharp paths; no new package dependency was added.

The IPTC value is `compositeWithTrainedAlgorithmicMedia`, truthfully identifying an AI-assisted composite. No source C2PA signature is copied. Original bottle/label protection and exact crop parity are upstream PNG guarantees; lossy WebP/JPEG encoding is not claimed to preserve bit-identical PNG pixels.

## Render-path audit

| Surface | Existing shared path / scoped adjustment |
| --- | --- |
| Shop and compact Home cards | `src/components/shop/ProductCard.jsx` → `src/lib/product-card-images.js` → `approved-product-media.js` |
| Local-delivery shopping sections | `src/components/landing/LocalDeliveryShopping.jsx` → shared card image + `ProductPhoto` |
| Product hero, thumbnails, gallery | `src/pages/ProductDetail.jsx` → `src/lib/product-gallery-images.js`; existing 4:5 hero and square thumbnail geometry retained |
| Product SEO / crawler documents | `src/lib/product-seo.js` → shared primary and gallery; titles, prices, availability, canonical links unchanged |
| Cart and bundle composition | `src/pages/Cart.jsx`, `src/components/cart/BundleComposer.jsx` → shared `ProductPhoto`/thumbnail resolver |
| Birthday/free/earned-reward choices | `src/components/FreeProductPicker.jsx`, `src/components/RewardProductPicker.jsx` → shared `ProductPhoto` |
| Order thumbnails | `src/components/orders/OrderItemThumbnail.jsx` → `src/lib/order-item-images.js` → shared approved card; stored snapshot fallbacks retained |
| Admin source-image upload control | `src/pages/admin/AdminProducts.jsx` intentionally unchanged: it previews the stored source image being edited, not the customer-facing override, so future uploads visibly update the editor |
| Legacy mix editor | `src/components/subscription/CompositionEditor.jsx` raw image replaced by shared `ProductPhoto` only; selection/save handlers remain byte-identical; no subscription feature enabled |

`src/lib/approved-product-media.js` keeps exact product IDs, Shopify variant IDs, aliases and conflict rejection unchanged. Only the versioned media base, descriptive alt text and a frozen retired-V4 list change. These are customer-display overrides, not evidence of a changed provider Product image. The admin source-image upload control is a deliberate narrow exemption: it must preview the stored image so a successful future upload does not appear to do nothing. Uploading a catalog image does not remove the explicit customer-facing approved display override.

`src/lib/product-gallery-images.js` excludes each target's old V4 primary/card URLs from supplied secondaries in addition to the already-retired catalog original. Canonical absolute and relative forms are covered. The three authentic supporting photographs are preserved. Old asset files are retained for historical bundles and failure recovery. The other eight catalog products retain their prior primary/gallery treatment.

Remaining direct `product.image_url` uses in `cartContext.jsx`, `rewardSelection.js` and `product-seo.js` are payload/fallback resolution, not bypassing rendered target media. `Merch.jsx` is tote-specific and intentionally unchanged.

## Verification and release boundary

The approved-media harness now pins all 12 exported files, verifies source-provenance metadata/dimensions, renders the real shared photo component, covers retired secondary URLs, and checks legacy selection/save-handler hashes against the canonical baseline. Unknown products with no image still render no image in the legacy editor. The existing shopping-offer harness still verifies four-photo galleries and unchanged explicit coupon controls.

Run the full critical suite, lint, typecheck, build, secret scan, diagnostic baseline and diff check. Browser/native rendering, deployed URL parity and provider upload/readback are separate release checks; this document does not claim them completed.

For website + native activation, use one reviewed merge for site and Appflow, observe the active build and verify downloaded artifact equivalence. Existing release controls in `docs/release/change-and-release-runbook.md` apply. No provider catalog changes, budgets, ads, backend functions/entities/settings or native store binaries are part of this source patch.
