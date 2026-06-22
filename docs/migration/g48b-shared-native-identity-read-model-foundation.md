# G48B: Shared native identity and read-model foundation

## Executive summary

G48B was intended to introduce a reusable, pure, read-only native identity and customer read-model foundation for the chain:

```text
Customer App Order
→ native ShopifyOrder
→ native FulfillmentTask
```

The target was to replace duplicated exact-matching and safety classification logic currently spread across `getCustomerAccountDashboardData`, `getCustomerOrderDetail`, and customer-order readiness modes in `previewNativeOrderCutoverReadiness`.

The implementation did **not** proceed because the repository does not currently prove that Base44 function deployments safely bundle shared relative modules outside each function entrypoint.

Final G48B classification:

```text
native_identity_foundation_blocked_by_function_module_packaging
```

No runtime code was changed. No function behavior, customer behavior, schema, UI, live gate, allowlist, Hub fallback, or Hub write behavior changed.

## G48A carry-forward

G48A is closed with classification:

```text
native_operational_backbone_architecture_decided
```

G48A selected G48B as the first coherent package because a shared native identity/read-model layer would remove repeated blockers across:

- customer order history;
- customer OrderTracker;
- admin order diagnostics;
- delivery route/action readiness;
- production/compliance read models;
- checkout diagnostics;
- operations dashboards;
- future subscription occurrence linkage.

The strategic decision remains valid. The blocker is packaging evidence, not the identity model itself.

## Shared-module support audit

### Repository evidence inspected

The audit inspected Base44 function entrypoints and repository deploy/build conventions.

Findings from the current repository:

```text
base44/functions entrypoint count: 258
relative shared import count in base44/functions: 0
base44 sdk import count: 254
shared/_shared/lib function module directories found: none
repo deploy/build evidence for shared Base44 function module bundling: none found
```

Target functions inspected:

- `base44/functions/getCustomerAccountDashboardData/entry.ts`
- `base44/functions/getCustomerOrderDetail/entry.ts`
- `base44/functions/previewNativeOrderCutoverReadiness/entry.ts`

Those functions use standalone `entry.ts` files and import the Base44 SDK directly. The repository does not show an existing deployed pattern such as:

```text
base44/functions/_shared/*
base44/functions/shared/*
base44/lib/*
relative imports from one function entrypoint to a shared module
```

### Packaging result

```text
shared_function_module_supported=not_proven
shared_module_path=none_proven
shared_module_bundled_on_deploy=unknown
```

This evidence proves that shared Base44 function modules are **undocumented and not repository-proven** in the current project. It does **not** prove that Base44 definitively rejects shared local imports or that the feature is unsupported. No deploy, CLI-source, or controlled packaging proof has been performed in this phase.

Distinction for follow-up work:

- `unsupported`: CLI/platform evidence proves shared imports cannot be deployed.
- `undocumented`: official/project docs do not describe the behavior clearly enough.
- `not_proven`: repository evidence does not yet prove the behavior works safely.

Current G48B state is `undocumented` and `not_proven`, not `unsupported`.

Because no source/build/deploy evidence proves that a shared helper module would be bundled into multiple Base44 functions, G48B must not introduce a shared import and assume it will deploy correctly.

### Decision

Do not duplicate the identity resolver into three separate functions. That would recreate the exact maintenance problem G48B is meant to solve and would create a hidden divergence risk across customer history, tracker, and preview code.

## Intended G48B v1 scope

If shared function-module packaging is confirmed later, G48B v1 should implement one-time order identity only.

It should not include:

- subscriptions/multi-delivery;
- refunds/payment authority changes;
- checkout reservation writes;
- delivery writes;
- compliance status writes;
- inventory/PO behavior;
- notifications;
- Hub suppression.

## Intended identity graph

The shared resolver should produce an internal identity graph for:

```text
Customer App Order
→ native ShopifyOrder
→ native FulfillmentTask
```

The resolver should be pure and read-only. It should accept preloaded bounded rows where practical rather than performing per-order queries.

Internal resolver result should include:

```text
identity_contract_version=g48b_order_identity_v1
```

That marker is for admin/internal diagnostics only. It must not be exposed to customer-facing UI responses.

## Exact matching contract

### Customer App Order to native ShopifyOrder

Allowed exact keys:

- `base44_order_id`
- `customer_app_order_id`, if present and supported
- normalized exact `order_number`
- normalized exact `shopify_order_number`

Safe normalization may remove formatting differences such as a leading `#`, but must not perform fuzzy matching.

### Customer App Order or native ShopifyOrder to FulfillmentTask

Allowed exact keys:

- `order_id`
- `base44_order_id`
- `native_shopify_order_id`
- `shopify_order_id`
- normalized exact `order_number`

### Prohibited matching

The shared resolver must never match by:

- customer name;
- customer email;
- phone;
- address;
- approximate amount;
- approximate date;
- product combination;
- display label;
- newest record;
- fuzzy text matching.

If exact identity is missing, duplicated, or conflicting, the row remains fallback/review-held.

## Ownership boundary

Any customer-facing consumer must apply authenticated Customer App Order ownership filtering before native enrichment or allowlist/automatic eligibility evaluation.

The resolver may compute identity after ownership has been established, but it must never allow:

- order-number lookup alone to return another customer's order;
- native ShopifyOrder identity to change customer ownership;
- FulfillmentTask identity to change customer ownership;
- allowlisting to bypass authenticated ownership.

Current ownership caveat remains:

```text
source_and_harness_verified_not_live_multi_account
```

## Intended safety classifier

The shared foundation should classify rows using stable internal values such as:

- `native_identity_exact_ready`
- `native_identity_shopify_order_missing`
- `native_identity_fulfillment_task_missing`
- `native_identity_duplicate_shopify_order`
- `native_identity_duplicate_fulfillment_task`
- `native_identity_conflict`
- `refund_payment_hub_source_of_truth`
- `cancelled_payment_risk`
- `subscription_multi_delivery_hub_source_of_truth`
- `review_queue_hold`
- `repair_replay_hold`
- `delivery_schedule_mismatch`
- `payment_mismatch`
- `fulfillment_mismatch`
- `historical_late_mirror_hold`
- `unknown_manual_review_required`

Customer-facing responses must strip diagnostics such as:

- `native_primary_eligible`
- `identity_contract_version`
- `fallback_reason`
- `mismatch_fields`
- `source_of_truth`
- `review_required`
- native record ids;
- raw records;
- raw provider payloads.

Admin-only read previews may return limited operational context when needed for migration decisions, but live mutation responses and customer-facing responses remain tighter.

## Intended consumers

The first integration targets remain:

1. `base44/functions/getCustomerAccountDashboardData/entry.ts`
   - customer order history path;
   - preserve G43B current behavior and allowlist.
2. `base44/functions/getCustomerOrderDetail/entry.ts`
   - customer OrderTracker path;
   - preserve G43C current behavior and allowlist.
3. `base44/functions/previewNativeOrderCutoverReadiness/entry.ts`
   - customer-order readiness preview modes;
   - preserve read-only admin preview behavior.

No integration was performed in this phase because shared-module packaging is not proven.

## Live configuration preserved

G48B does not modify any live configuration.

Current G43B customer order-history allowlist remains:

```text
NV-MQHJR3V2
NV-MPZNKGNT
```

Current G43C OrderTracker allowlist remains:

```text
NV-MQHJR3V2
```

G45C customer rewards limited-native-first remains disabled.

Apple Pay production payment work remains blocked by Base44 platform atomicity.

Hub fallback and Hub writes remain active where currently required.

## Known controls for future proof

A future implementation should preserve the known control behavior:

### NV-MQHJR3V2

- clean one-time order identity;
- history native enrichment live;
- tracker native enrichment live;
- Customer App Order remains canonical.

### NV-MPZNKGNT

- history allowlisted;
- tracker candidate;
- tracker activation still requires owning-customer smoke.

### NV-MP5SOQLJ

- historical late mirror;
- chronology hold;
- must not appear as newly created customer activity.

## Test plan held by packaging blocker

The intended G48B harness should be created only after shared-module packaging is confirmed.

Future harness:

```text
scripts/migration/run-g48b-native-identity-read-model-foundation-tests.mjs
```

Required cases should include:

1. exact native ShopifyOrder match by `base44_order_id`;
2. exact native ShopifyOrder match by `customer_app_order_id`;
3. exact native ShopifyOrder match by normalized order number;
4. duplicate native ShopifyOrder blocks enrichment;
5. FulfillmentTask match by `order_id`;
6. FulfillmentTask match by `base44_order_id`;
7. FulfillmentTask match by `native_shopify_order_id`;
8. FulfillmentTask match by `shopify_order_id`;
9. FulfillmentTask match by normalized order number;
10. duplicate/conflicting task blocks tracker readiness;
11. missing task allows history-only readiness when task fields are not enriched;
12. ownership filtering precedes enrichment;
13. cross-customer native match is rejected;
14. historical mirror chronology is preserved;
15. refunds/cancellations remain Hub/payment source-of-truth;
16. subscriptions/multi-delivery remain Hub source-of-truth;
17. review/repair holds preserve fallback;
18. no customer-visible diagnostics;
19. no PII/raw payload exposure;
20. no writes;
21. no providers;
22. no notifications;
23. no Hub mutation.

## Required blocker resolution

Before implementing runtime G48B, one of these must be true:

1. Base44 CLI/deploy-source evidence proves shared relative modules are bundled with every function that imports them.
2. A controlled packaging probe proves the deployed function can import a sibling shared module under the functions root.
3. The repository introduces a documented, tested deploy convention for shared Base44 function modules.
4. Base44 provides an official shared-function-module packaging contract.

Only after that should G48B implement the resolver and integrate it into the three target functions.

## Hard stops

Do not proceed with runtime G48B while:

- shared-function-module packaging remains unproven;
- implementation would require copying the resolver into multiple functions;
- customer-visible behavior changes would occur while gates are disabled;
- G43B/G43C allowlists would change;
- Hub fallback or Hub writes would be suppressed;
- runtime code would add writes, providers, notifications, or sync/repair behavior.

## No-write policy

This phase is documentation/read-only only.

Confirmed intended non-effects:

- no runtime code changes;
- no schema/entity changes;
- no UI changes;
- no Base44 publish;
- no Builder publish;
- no Order mutation;
- no ShopifyOrder mutation;
- no FulfillmentTask mutation;
- no Hub mutation;
- no Stripe/Shopify/provider calls;
- no notifications/messages;
- no sync/repair/replay;
- no logs/queues created;
- no inventory deduction;
- no PurchaseOrder creation.

## Recommendation

Keep G48B blocked until shared module packaging is confirmed. Do not create three copied implementations.

Next best options:

1. Run G48B-PACK1 to inspect the installed Base44 CLI/deploy packaging path and determine whether shared imports can be statically proven.
2. If static proof is ambiguous, design but do not execute a controlled G48B-PACK2 live probe using an existing admin-only read preview function.
3. If confirmed, implement G48B as a true shared pure module and integrate into the three target read paths with disabled/behavior-preserving checks.
4. If unsupported, close G48B without copying the resolver and move to another G48 package.
