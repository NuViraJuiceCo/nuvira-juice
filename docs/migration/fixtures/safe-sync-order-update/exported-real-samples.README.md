# G21M Redacted Real safeSync Samples

Extraction date/time: 2026-05-25T20:27:12.403Z

Sample count: 6

## Source Types Used

- Customer App `OrderSyncLog` records, read-only, for one successful `created` bridge result.
- Customer App `OrderSyncLog` records, read-only, for one `dedupe_exact_match` bridge result.
- Customer App `Order` records, read-only, for additional paid delivery order shapes where no more safe non-refund bridge logs were available.
- Customer App `Subscription` records, read-only, for one subscription event shape.

No Hub endpoint was called during extraction. No Stripe, Shopify, provider, sync, retry, repair, notification, or mutation endpoint was called.

## Redaction Rules Applied

- Real order numbers were replaced with stable synthetic order numbers.
- Customer emails were replaced with `sample-NNN@example.test`.
- Customer names were replaced with stable sample names.
- Phone values were replaced with `REDACTED_PHONE`.
- Street address, city, and postal code values were replaced with redacted placeholders.
- Stripe checkout session, payment intent, customer, subscription, and event identifiers were replaced with stable fake ids.
- Raw webhook/provider payloads were not exported.
- Auth headers, secrets, stack traces, and provider payloads were not exported.
- Product titles and quantities were retained because the approved policy allows safe line item context for admin-only parity work.

## Excluded Event Types

- Refunds and payment/refund mutation flows.
- Provider mutations and Stripe/Shopify API calls.
- Notifications.
- Customer-facing delivery status changes.
- Delivered/out-for-delivery, proof/drop, and unable-to-deliver events.
- Repair, replay, backfill, broad sync, and retry actions.
- Inventory, purchase order, production complete/verify, credit, bag-return, or financial-adjacent mutations.

## How To Run

From the Customer App repo:

```bash
node scripts/migration/run-safe-sync-exported-samples.mjs docs/migration/fixtures/safe-sync-order-update/exported-real-samples.redacted.json
```

The runner is local-only. It loads the native dry-run planner and comparator from the repo, reads this JSON fixture file, and performs no Base44 live reads or writes.

## Limitations And Gaps

- Only 6 samples were exported, below the approved maximum of 10.
- No pickup/POS sample was exported because no safe pickup/POS paid order candidate was found in the inspected Customer App order set.
- No live `OrderReviewQueue` sample was exported because the Customer App entity was not available to read in the live app at extraction time.
- The live bridge logs preserve status/action, but not full field-level accepted/rejected safeSync plans. Each `hub_result` is therefore a Hub-equivalent golden summary inferred from the G21 contract and current native dry-run planner, while `source_log_summary` preserves the real read-only source status/action.
- The duplicate sample maps Hub `dedupe_exact_match` to a skipped/no-second-write summary so it can be compared by the current dark-launch comparator.
- Two samples are order-shape snapshots rather than direct bridge-log samples because the available recent bridge logs were mostly refund, recovery, or delivery-status related and were excluded.
- The subscription sample is an event-shape sample derived from a read-only subscription record; cancelled/financial state was not copied into the payload.

## No-Mutation Confirmation

This extraction only read a small number of existing Customer App `OrderSyncLog`, `Order`, and `Subscription` records to produce redacted local fixture data.

No native `safeSyncOrderUpdate` writer was enabled. No `ShopifyOrder`, `OrderSyncLog`, `OrderReviewQueue`, `CommandLog`, Customer App `Order`, Stripe/Shopify/provider, sync/retry/repair, notification, production, fulfillment, inventory, or compliance record was created or updated.
