# Approved social preview cards

Six immutable 1200 × 630 JPEGs are exact copies of the existing JPEG exports of
the owner's approved September 11 review-v1 cards. The JPEG import receipt pins
all hashes and source-photo versions:
OASIS/AURA contact-relight-v3 and RE-NU edge-cleanup-v4. JPEG metadata retains the
`compositeWithTrainedAlgorithmicMedia` designation. No image was retouched or
re-encoded during import.

The initial PR #801 PNG package at merge
`6798d21d32397b5df7d950c8f23c94f5f0b2169c` was rejected by Base44's 50 MB extracted
site limit (53,383,538 bytes). That attempt did not change the live site. This
follow-up uses already-approved JPEGs totaling 1,660,898 bytes, replacing only
the six never-deployed PNG copies totaling 7,776,852 bytes. The old copies remain
recoverable from Git and the untouched review directory; their historical
provenance receipt is retained. No newly generated or re-encoded image is used.

The immutable source path is now
`/images/social-share/20260911-approved-jpeg-v1/*.jpg`. The mandatory build size
guard counts the complete extracted `dist` directory and fails above
49,000,000 bytes, leaving explicit headroom below the server limit.

## Deliberately separate from commerce images

`src/lib/social-share-images.js` selects cards only for the exact public Home,
Shop, OASIS, AURA, RE-NU and Trio canonical routes. Only Open Graph / Twitter
metadata uses these graphics. Product data, product photos and galleries,
Product and LocalBusiness JSON-LD, no-JavaScript product photos, Merchant feed
images, pricing, availability, checkout, native heroes and provider records are
unchanged. Unknown routes and products keep their existing image fallback; no
unverified image dimensions are declared for them.

Generated route metadata belongs to Helmet so later product hydration or route
changes can replace it. Product JSON-LD and unrelated verification tags are not
marked as Helmet-owned. Existing canonical redirects are unchanged.

## Release gates and hosting limitation

This source change is not evidence of a production release or a refreshed
Facebook/iMessage/X cache. Run the focused harness normally and with `--built`
after the production build. The client reconciliation test uses the installed
Helmet implementation and a synthetic head DOM, not a mounted browser or device.

The build emits the main index, a supplemental `shop/index.html`, existing
`product/{slug}.html` canonical pages and existing directory snapshots. Observed
Base44 hosting may override Home/Shop metadata and does not necessarily serve
directory snapshots for extensionless product URLs. Do not claim those paths
fixed based solely on these local files, and do not perform a broad app publish
to work around that behavior. After an approved exact-source site release,
read back each public route with ordinary and crawler user agents, including
tracked URLs and legacy clean product paths. Verify actual image bytes/XMP and
unique metadata, then separately request provider preview refresh if authorized.

No backend deployment, settings change, app icon change, provider write, native
publish, or cache refresh is part of this patch.
