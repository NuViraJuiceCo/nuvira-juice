# Google conversion improvements — September 10, 2026

## Scope and baseline

Owner approved the Google Ads audit improvements. Canonical base is `b9f16306a5be52b05f6c3c172b21c11b864af31f`. This work does not authorize a budget increase, a new campaign, a bidding-strategy change, new tracking providers, or a broad unreviewed Base44 publish.

Google Ads account: NuVira Juice Co., `325-350-2382`. Merchant Center: `5778700568`.

Read-only reporting period: August 26–September 9, 2026, Central Time.

| Campaign | Clicks | Impressions | Spend | Recorded purchases |
| --- | ---: | ---: | ---: | ---: |
| NuVira \| Search \| Local Delivery \| Launch | 34 | 877 | $79.64 | 0 |
| NuVira \| Shopping \| All Products \| Local Delivery | 1 | 257 | $6.07 | 0 |

This is a small sample, not proof that customers cannot purchase. Google Ads has an existing primary GA4 purchase conversion action. The consent-aware attribution path needs improvement; do not equate an attribution limitation with proof of missing orders.

## Live Search change

The following eleven exact-match campaign-level negative keywords were saved and independently read back in Google Ads on September 10. Before the change, the negative keyword table was empty. Only the Search campaign was selected.

```text
[smoothies near me]
[beet juice near me]
[fresh beet juice near me]
[cold pressed pomegranate juice]
[fresh pressed pomegranate juice]
[ardens garden juice]
[cold pressed tart cherry concentrate]
[lakewood juice]
[smoothie delivery near me]
[twisted alchemy lime juice]
[wonder beet]
```

These specific search terms generated 13 clicks and $30.90 in the reviewed Search period. Exact matching deliberately avoids broadly excluding relevant juice, cleanse/program, or local-delivery searches. Undisclosed search terms were not classified as waste.

Search remains $33.18/day and Shopping $20/day; both current maximum CPC limits remain $2.50. No budget, geographic, bidding-strategy or Shopping setting was changed. The historical $6.07 Shopping click does not prove today's cap failed: change history records the cap being set September 4 at 10:54:04 AM Central, without an exact timestamp for that click.

## Merchant reconciliation — no mutation needed

Processed Merchant Center offer `69d490ce699b5f1ac4dde498` explicitly shows:

- The NuVira Trio: sale/current price **$36.00**, regular price **$38.97**.
- Approved, no attention issues, visible on Google and in Shopping ads.
- Destination: `https://nuvirajuice.com/product/the-nuvira-trio.html`.
- One main image plus three additional images.

The Google Ads preview surfaced the base-price field only. Its $38.97 display was not sufficient evidence of an incorrect processed sale price. Both Merchant builders already emit the correct sale-price structure. No product, feed, provider or price change was made. All eleven Merchant products were approved at inspection.

## Offer readback

The live admin Discount Codes page shows WELCOME10 active, 10% off, first order only, once per customer, and no start/end date. The minimum-subtotal field is zero; this does not override normal checkout item-count or delivery-zone minimums. Existing terms exclude stacking with other discounts/rewards and retain delivery fees and applicable tax. The edit form was inspected without saving changes.

## Source and release boundary

Landing-page and explicit browser-only Google advertising-measurement changes are separate from the live campaign exclusions. Tests cover denied, historical/unset, granted, cross-tab revoked and native consent paths, with unchanged protected checkout context and Purchase authority/deduplication. Browser/server test fixtures do not create real orders or provider conversion events.

Independent review rejected a candidate server advertising grant because permission saved at payment preparation could become stale before payment completion or delayed route capture. All candidate backend changes were restored to the exact canonical baseline before release. Server Measurement Protocol Purchase continues to send `ad_user_data: DENIED` and `ad_personalization: DENIED`; no checkout hash, payment attempt, function, schema, or provider configuration changes are included. Complete Google Ads Purchase attribution is not established by this browser-only correction and remains a separate validation item.

The shared preliminary ZIP checker previously treated an unmet cart-dollar minimum as geographic unavailability. Its frontend presentation now recognizes confirmed service zones even when an empty preliminary cart cannot meet the minimum, displays the returned dollar minimum and route-review caveat, and keeps full-address checkout authoritative. Lookup failures/unknown contracts remain retryable instead of sending customers to a waitlist. Only explicit unavailable geography shows a waitlist result. Older cached preliminary results require a recheck. Backend and Checkout are unchanged.

Local evidence: G189 26 assertions plus 4 rendered cases; G196 14/14; all 155 critical harnesses; full lint/typecheck, diagnostic baseline, tracked and new-file secret scans, and diff-check pass. Isolated WebKit mobile/tablet/desktop and three-choice consent checks pass with all external traffic blocked and public API responses mocked, including core, extended/route-review minimums, lookup failures, waitlist, and legacy-cache cases. These tests do not substitute for live post-deploy verification.

Source, tests, Base44 stored packages, published runtime, site parity and Appflow/native propagation are separate gates. No claim of complete release or future error-free sales is made by this document. The final release evidence must record exact merged source and actual live artifacts.
