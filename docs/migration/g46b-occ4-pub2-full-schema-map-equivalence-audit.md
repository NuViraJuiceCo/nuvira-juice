# G46B-OCC4-PUB2 — Full schema-map equivalence audit

## 1. Executive summary

G46B-OCC4 is merged at `3e90ccbba3b633f648ea3ea1cd29a200c7124992`, but the subscription occurrence linkage schema fields are not safely publishable yet through the available Base44 CLI path.

Classification:

```text
subscription_occurrence_schema_publish_blocked_no_live_schema_export
```

Reason: the local merged schema map can be normalized and hashed, but a verified read-only live Base44 entity-schema map export was not available. Without the live schema map, this phase cannot prove that a full-map schema publish would create `0`, delete `0`, and update exactly `3` schemas.

No `base44 entities push` was run. No intended schema publish was run. No runtime code, schema source, UI, data records, providers, notifications, Hub records, or subscription occurrences were changed by this PR.

## 2. Current state and source commit

- G46B-OCC4 PR #523 is merged.
- Merge commit: `3e90ccbba3b633f648ea3ea1cd29a200c7124992`.
- Local source audited from that merged commit.
- Intended schema changes are source-merged but not live-published.
- G46C and OCC5 remain blocked.

Current carry-forward classification before PUB2:

```text
subscription_occurrence_schema_merged_publish_blocked_by_scoped_schema_tooling
```

PUB2 classification after this audit:

```text
subscription_occurrence_schema_publish_blocked_no_live_schema_export
```

## 3. Why scoped CLI publication is unavailable

The available CLI path is not entity-scoped for schemas. The observed `base44 entities push` behavior is a full entity-schema map submission, not a single-entity publish. Prior CLI/source inspection showed the operation reads all local `base44/entities/*.jsonc` files and submits the complete map. The server response model can include created, updated, and deleted schemas.

That matters because the desired OCC4 publish is only three additive schema updates:

- `Order`
- `ShopifyOrder`
- `FulfillmentTask`

A full-map push could still overwrite unrelated live schema drift or delete live-only entities if the local and live maps are not equivalent. Therefore, it is not safe to treat `base44 entities push` as scoped to the three intended schemas.

## 4. CLI full-map risk

A full-map schema push is only acceptable after proving the entire live map matches the local Git map except for the exact intended additive fields. Required predicted impact for a later, separately approved publish is:

```text
entities_created: 0
entities_deleted: 0
entities_updated: 3
updated:
  - Order
  - ShopifyOrder
  - FulfillmentTask
```

PUB2 could not prove that server-side impact because there is no verified read-only live schema export.

## 5. Live/local entity counts

| Source | Entity count | Evidence status |
| --- | ---: | --- |
| Local merged Git schema map | 58 | Verified from `base44/entities/*.jsonc` |
| Live Base44 schema map | unavailable | Blocked: no verified read-only export path |

Because the live count is unavailable, entity-set equivalence is not proven.

## 6. Local normalized schema hashes

Normalization ignores JSONC comments, whitespace, and object-key ordering. It does not ignore field names, types, required status, defaults, enums, descriptions, constraints, RLS, visibility, or behavior-affecting metadata.

Key target hashes:

| Entity | Local normalized SHA-256 |
| --- | --- |
| `Order` | `c8f42e9aeae31818874ffc38c702cf78ee499611f20443ed64d127eae3b5be8d` |
| `ShopifyOrder` | `eb02bc22561281dfc325b2857042ee417b35ca58e555f0cbb2cf92f21bf8e729` |
| `FulfillmentTask` | `bd7423c691682f558df99334598b21bd0d8fba07b018ef396250d2d7e1dd0f34` |

Complete local hash manifest:

| Entity | Local normalized SHA-256 |
| --- | --- |
| `BagReturn` | `0173fde78c9f7b2eb5ca27677905ae0c4caa766f7a827b7ae9fadae6a2d8e2d4` |
| `Banner` | `fad1f49584b98679f550f324a91ff825012c3530678ae3c599a2180e43a4270c` |
| `BatchComplianceLog` | `ca6c35653b5e043c22bed59708bb3d8907bc6c00584d1353ed9a4decb23bcb5b` |
| `Bundle` | `a27b42144d4c1c462ad2ab16b595e98401af47e61e96254fa8913ec4c6b49485` |
| `CCPLog` | `af9626f622f0afd0e9593fdbc01abf38796a63b0e33415fcb938d39216647c46` |
| `CheckoutSession` | `317c32be7238a66c55626b1fea4dc5acd3612328770e0c8cf11f6106723cc01d` |
| `CommandLog` | `ef713adf41420f96db3d6024c21340404d021928aeb118c7281bb5bed8faf22f` |
| `ComplianceAlert` | `d16b626a995f2bb99497b5f479c00f054e0d7d0082099a340ac73f8ebb972400` |
| `ComplianceDoc` | `0043a7df25d93c9cca5f8bffd048ecd9b84ac9c8b4f5401974dbc806779b2354` |
| `ComplianceLog` | `9ad71c2196797ab4b5dfc4975e029bd1b4cbd7ca681fc7bb65d96ef41db866d4` |
| `CorrectiveActionLog` | `6c2bd7e7343003316682b4f427d3cef19111ffa66e74a8ef78bad6369131e06c` |
| `CustomerMessageDeliveryLog` | `6ce06fda8ff4971f7fbcf37f52537dad8c80404d5f0ddc9afbc9f379151ef00d` |
| `DailyChecklist` | `7748115a994a43167dfc1eafef70f6f49ba18c1055e030587f6a6d7f70616909` |
| `DeliveryApprovalRequest` | `45f8f2bfc5699a03088548dc901b5ac1d86dfb50e3019e234c8c7bcc7dba0394` |
| `DeliverySchedule` | `5c583fa0c4b56a88ca158c9c6a1d0a9a97cda1f9e3f900d730a42a0942dd94eb` |
| `DeliveryWaitlist` | `baf8cd252df52c5e09efdc6fa0cc6165e2a88b7474bbf96a5264e638957ce87c` |
| `DeliveryZone` | `f7ad3c6f2fd01bbd7bc176d4dc1612c7160844f9d987181464aeb89d4e6e29b8` |
| `DriverActionLog` | `d7be44070d262a65a4c71c177bfb1b720a60c7be90742360318e0ac7845f58ee` |
| `Event` | `d72b509afe0867616182b3e327a712784b8df96ba32abf4021c367e4fb701de8` |
| `EventBonusRedemption` | `59b07a0bd893494f1455e847c6d6be100d7caab62e64a2841fd52ec8a32aa810` |
| `FulfillmentTask` | `bd7423c691682f558df99334598b21bd0d8fba07b018ef396250d2d7e1dd0f34` |
| `HACCPPlanReview` | `992997c66e795f767d2a566b7fff4379dafd4c495b983bc17d136301df1a7908` |
| `IngredientYield` | `f5f6a27b40e2d751a0136469ca7383e341f11c1b252f21170067eb45a45ff9dc` |
| `InventoryItem` | `c4685aa226f6004af9210a41a31efc828569a28b09f4aadcfd07fce6b871dcac` |
| `LabelAllergenReview` | `11228091b6c130ff1e4ac25e8eb4d9de4d3e419db822b131d82bf46fea042fc4` |
| `LoyaltyMember` | `eaff54e3f5fdf0e96d5430c4461f439415b157ac67918936d6df044c21aeee08` |
| `ManualProductionBatch` | `ee2e483b6b626d3e66fa593cc04060f0ada99cf2491dd1ccf8830e7481d9f863` |
| `Merch` | `ba4658159e3259cfe7ffdc303d5067bcba331a5d5e441eb398dec80e066c4356` |
| `Notification` | `758863cc409716066bbffeca4f8b8c11e0410de6181ac19cbd90f346531304f2` |
| `NotificationCampaign` | `793066f1b4cbab82ad6afbe79bacf0db07e41df39ed12ff985e71591be40644e` |
| `NotificationPreference` | `9e625774bdd2f3ddb7752521c0ede9ccc33aae1c818bff313804b8f15582d93c` |
| `NuViraCredit` | `28cc644aa2b127bbc52aa61fa49c246c0179f794a07b0f6824c777f872db4b4d` |
| `OperationalAlert` | `c29cd869b74604cd45e7ba3bd1c26c29fb6991d3fda2e530697199620038cf12` |
| `Order` | `c8f42e9aeae31818874ffc38c702cf78ee499611f20443ed64d127eae3b5be8d` |
| `OrderReviewQueue` | `e588fffbabdd2a3d0f6aa251a9a3ccf03a56dcc35ed132329a8d8f056ae2c2a7` |
| `OrderSyncLog` | `3207feb750380571680d2011531e1e8e5d0573b3cd5de47be786aa9474ced203` |
| `PendingSubscriptionCheckout` | `f776e6624bbfa669ebda4c6136883d2aeb744b9bf5d08faf1a3560810bc43605` |
| `Product` | `718c54af7327be6495520d6babc0f8eb45e52c525877f9eb45f7795c030e6686` |
| `ProductionBatch` | `984dda22ea0d560ae27df5f123f9b05b5cfb3281da64fb39dd158cda73db6491` |
| `PurchaseOrder` | `cba7ea42d1ead0a829d6d04ec564c306939818cdd5cbc121ce9c7724f2562372` |
| `PushSubscription` | `ce679b9dd6695975eb5f85e635e1fe1303608819b8580747e9663a9706666086` |
| `Recipe` | `ef31d194a718c1af143c1499a7fa46034292560cee71c05e3f00ffe18e705919` |
| `RewardTier` | `e2d75e1a4cb9c60da6986b80c13e5a5034ceb700cb069d1cd304fa6f1b7331b9` |
| `SafeSyncParityLog` | `d95b5c88d26948c67afbd5314ea38aa4a754727816aba2eb53f4e000aa013a76` |
| `SanitationLog` | `5559e9ca6ccb0ffab465d8eefb99b424c81b9952d125a15d03b9b4bfa00dcc2c` |
| `ShopifyOrder` | `eb02bc22561281dfc325b2857042ee417b35ca58e555f0cbb2cf92f21bf8e729` |
| `ShopifyProduct` | `66a628e2124f2fc85d29cc7e64b4efb1f7e19fb558fd1ff947f2408f3bc35467` |
| `ShopifySyncLog` | `134a85802a9794f02d502593e742d45bdcd6323c80f7fb9651c5c4aaebb61f2d` |
| `ShopifyWebhookLog` | `3cb5f69c246a2b8d4d46aef4c94dc6c3ba475fa937bf4815b349b94b58e7a0ab` |
| `Subscription` | `42274e518cc0bcadf830eb17375eb97435e200f47945e9d221b74a4f2a81c188` |
| `SubscriptionBundle` | `70a4a934e1dc102c19c490455b2560f4038ac2249e4687ce32c6a5923e5163ed` |
| `SubscriptionPlan` | `ca5eab3c572aed4cd5823dc3449b3377c25f7c3b172da1d73c072f0583b4daf6` |
| `Supplier` | `9a19aa570edfa954b49eb248dc1d92ef23a86163cb3fdd69f5dee517eb1c9714` |
| `TemperatureLog` | `5c30fda5a4660327afe08015a784ecba59134f0886f57a4d00442eb5d77813f0` |
| `User` | `dad95326470f57c31f1e7545c4862442e7ae0ebeeff25f8ca3c0d33a8bb46751` |
| `UserPoints` | `9771092bb2fae7e5fd995f146920d75cf3cd02ab1e9575a296a5094e0efea5ee` |
| `UserProfile` | `86509483fc32221396a4ed5d6230cb268c4d2b3fea7d7fe5acc8829a87b81797` |
| `pHLog` | `4acfbcd0baff656ab10e1f193e519e053c6d1c6d428cc201394da51a278cdcb7` |

Live normalized hashes are unavailable, so normalized hash comparison cannot be completed.

## 7. Entity-set comparison

Entity-set comparison is blocked.

| Check | Result |
| --- | --- |
| Local entity set captured | yes |
| Live entity set captured | no |
| Local/live entity count equal | not proven |
| Live-only entities absent locally | not proven |
| Local-only entities absent live | not proven |
| Full-map delete risk eliminated | not proven |
| Full-map create risk eliminated | not proven |

Classification if a future export shows entity-set drift:

```text
full_schema_map_not_equivalent_entity_set_drift
```

## 8. Three intended additive diffs

The intended OCC4 schema source additions are internal linkage fields for future subscription occurrence chains.

### Order

Expected additive fields:

| Field | Type | Required | Default | Constraint/enum |
| --- | --- | --- | --- | --- |
| `customer_app_subscription_id` | string | no | none | none |
| `subscription_occurrence_id` | string | no | none | none |
| `subscription_cycle_key` | string | no | none | none |
| `fulfillment_number` | number | no | none | none |
| `source_type` | string | no | none | none |

### ShopifyOrder

Expected additive fields:

| Field | Type | Required | Default | Constraint/enum |
| --- | --- | --- | --- | --- |
| `subscription_occurrence_id` | string | no | none | none |
| `subscription_cycle_key` | string | no | none | none |

### FulfillmentTask

Expected additive fields:

| Field | Type | Required | Default | Constraint/enum |
| --- | --- | --- | --- | --- |
| `subscription_occurrence_id` | string | no | none | none |
| `subscription_cycle_key` | string | no | none | none |

Local source confirms these new OCC4 linkage fields are not in the required arrays and do not add defaults, uniqueness, enum narrowing, or customer-facing behavior. However, because the live schema map is unavailable, PUB2 cannot prove that these are the only server-side diffs.

## 9. Unrelated drift

Unrelated schema drift is unknown. PUB2 did not obtain a live schema map. Therefore, it cannot prove that the other 55 entity schemas are unchanged between live Base44 and local Git.

Required future classification if any non-target entity differs:

```text
full_schema_map_not_equivalent_unrelated_schema_drift
```

## 10. Predicted full-map push impact

Local-only prediction is not decision-grade because it lacks live schema input.

Required future impact if equivalence is later proven:

```text
entities_total: 58
entities_created: 0
entities_deleted: 0
entities_updated: 3
updated:
  - Order
  - ShopifyOrder
  - FulfillmentTask
```

Required per-updated-entity impact:

| Metric | Required value |
| --- | ---: |
| Removed field count | 0 |
| Changed existing field count | 0 |
| Required-field additions | 0 |
| Default additions | 0 |
| Constraint changes | 0 |

Because live schema input is missing, no full-map push should be approved from this PR.

## 11. Read-only export limitation

PUB2 required a verified read-only export of the live entity-schema map. That path was not found.

A read-only probe using `base44 eject` was attempted and proved unsafe for this purpose: it began a create/link/build/deploy flow rather than a schema export. It was interrupted and is excluded as valid evidence. Further live schema export work should use Base44 support, an explicitly documented read-only schema export, or an entity-scoped publish mechanism.

No credentials, tokens, raw project metadata, or live schema exports are committed in this PR.

## 12. Publish approval criteria

Do not run `base44 entities push` until all of the following are true:

1. A verified read-only live schema map is available, or Base44 provides an entity-specific publish path.
2. Local and live entity sets match exactly.
3. Every non-target entity normalized hash matches.
4. `Order`, `ShopifyOrder`, and `FulfillmentTask` differ only by the intended additive OCC4 fields.
5. Predicted server impact is exactly:
   - created: `0`
   - deleted: `0`
   - updated: `3`
6. A separate owner approval explicitly accepts that the CLI submits the complete entity map.

Only then should a later `G46B-OCC4-PUB3` be considered.

## 13. Rollback and verification plan for a future approved publish

If a future full-map schema push is separately approved after equivalence proof:

1. Re-run the equivalence audit immediately before publishing.
2. Confirm no local Git schema drift from the approved commit.
3. Capture the server response and require:
   - created: `0`
   - deleted: `0`
   - updated: `3`
4. Verify only `Order`, `ShopifyOrder`, and `FulfillmentTask` report updates.
5. Verify the OCC4 fields exist and remain optional/internal.
6. Do not backfill or mutate records during schema verification.
7. If any unrelated entity is created, deleted, or updated, stop and escalate to Base44 support.

## 14. Harness coverage

Added fixture-only harness:

```text
scripts/migration/run-g46b-occ4-pub2-schema-map-equivalence-tests.mjs
```

Coverage includes:

- deterministic JSONC normalization
- comment/key-order normalization
- missing/extra entity detection
- unrelated schema drift detection
- deleted field detection
- type, required, default, enum/constraint drift detection
- expected additive diffs for `Order`, `ShopifyOrder`, and `FulfillmentTask`
- unexpected fourth updated entity failure
- predicted created/deleted/updated count rules
- credential/output safety
- no schema publish invocation
- no live record mutation

## 15. No-write confirmation

- No `base44 entities push` was run.
- No `base44 deploy` was run.
- No intended schema publish was run.
- No function publish was run.
- No UI publish was run.
- No local schema files were changed in this PR.
- No records were intentionally created, updated, deleted, or backfilled.
- No subscription occurrence, Customer App Order, ShopifyOrder, or FulfillmentTask record was created or mutated.
- No Stripe, Shopify, Hub, provider, or notification call was intentionally invoked.

Caveat: the attempted read-only `base44 eject` probe was unsafe; it began a create/link/build/deploy flow and was interrupted after 14 functions. It was not a schema export, was not used as evidence, and is the reason this phase stops at `subscription_occurrence_schema_publish_blocked_no_live_schema_export` until Base44 provides safe schema export/tooling.

## 16. Recommendation

Do not publish OCC4 schemas yet.

Request one of:

1. a Base44-supported read-only live entity-schema map export, or
2. a Base44-supported entity-specific schema publish path for exactly `Order`, `ShopifyOrder`, and `FulfillmentTask`.

Keep OCC5 and G46C blocked until the OCC4 schema fields are safely live.
