# G46B-OCC4-SUPPORT1 — Base44 schema publish tooling request

## 1. Executive summary

Three additive, optional, internal schema changes for future subscription occurrence linkage are merged in Git but are not live in Base44.

Current blocker:

```text
subscription_occurrence_schema_publish_blocked_no_live_schema_export
```

Customer subscription migration remains blocked because the future native chain requires these fields to exist live before occurrence materialization, OCC5, or G46C customer subscription reads can proceed safely.

Requested Base44 support path: provide one of the following safe mechanisms:

1. A read-only export of the complete live entity-schema map.
2. An entity-specific schema publish mechanism for exactly `Order`, `ShopifyOrder`, and `FulfillmentTask`.
3. A genuine server-side dry-run/diff mode for the complete entity-schema map push.
4. Written confirmation of full-map push behavior, including whether it preserves unspecified live metadata and whether it can delete live schemas.

No schema publish should occur until one of these support paths is available and validated.

## 2. Exact requested schema scope

The requested schema scope is exactly three entities.

### Order

Add these optional internal fields:

| Field | Type | Required | Default | Constraint | Notes |
| --- | --- | --- | --- | --- | --- |
| `customer_app_subscription_id` | string | no | none | none | Internal parent `Subscription.id` linkage for future occurrence orders. |
| `subscription_occurrence_id` | string | no | none | none | Internal immutable occurrence identity. |
| `subscription_cycle_key` | string | no | none | none | Internal secondary cycle key; not sufficient as sole identity. |
| `fulfillment_number` | number | no | none | none | Internal occurrence fulfillment sequence/reference. |
| `source_type` | string | no | none | none | Internal source classification such as one-time or subscription occurrence. |

### ShopifyOrder

Add these optional internal fields:

| Field | Type | Required | Default | Constraint | Notes |
| --- | --- | --- | --- | --- | --- |
| `subscription_occurrence_id` | string | no | none | none | Internal immutable occurrence id copied from Customer App Order. |
| `subscription_cycle_key` | string | no | none | none | Internal secondary cycle key copied from Customer App Order. |

### FulfillmentTask

Add these optional internal fields:

| Field | Type | Required | Default | Constraint | Notes |
| --- | --- | --- | --- | --- | --- |
| `subscription_occurrence_id` | string | no | none | none | Internal immutable occurrence id copied from Customer App Order/native ShopifyOrder. |
| `subscription_cycle_key` | string | no | none | none | Internal secondary cycle key copied from Customer App Order/native ShopifyOrder. |

All requested fields are:

- optional
- nullable / absent for existing rows
- internal-only
- no defaults
- no uniqueness constraints
- no enum narrowing
- no historical backfill requirement
- no customer-facing visibility expansion

## 3. Current CLI limitation

The available Base44 CLI schema path is not entity-scoped.

Observed/confirmed limitation:

- `base44 entities push` does not expose an entity/file targeting option.
- The command submits the complete local `entityNameToSchema` map from `base44/entities/*.jsonc`.
- The response model can contain created, updated, and deleted schemas.
- The local project currently contains 58 entity schemas.
- A full-map publish can only be considered safe if complete local/live equivalence is proven first.
- Full live-map equivalence cannot currently be proven because there is no verified read-only live schema export path available to this workflow.

Risk: a full-map push could overwrite unrelated live-only schema metadata or delete a live schema absent from the local map if the live and local schema maps are not equivalent.

## 4. Requested Base44 support answers

Please confirm the following:

1. Is there a supported or undocumented entity-specific schema publish command for one or more named entities?
2. Is there a read-only entity-schema export command or authenticated API endpoint that returns the complete live schema map?
3. Is there a genuine server-side dry-run/diff mode for `base44 entities push`?
4. Does `base44 entities push` delete live entities that are absent from the local map?
5. Does `base44 entities push` overwrite live-only field metadata or unspecified schema metadata with the local map values?
6. Can Base44 support publish exactly these three schemas and no others?
   - `Order`
   - `ShopifyOrder`
   - `FulfillmentTask`
7. Can Base44 support provide the current live normalized schemas for exactly the three target entities?
8. Can Base44 support confirm the current live entity count?
9. Can Base44 support confirm that adding optional fields causes no data-row mutation and no historical backfill?
10. Can Base44 support confirm the rollback procedure for entity schema publication?
11. Can Base44 support confirm whether a full-map push preserves RLS, visibility, index, default, enum, and other behavior-affecting metadata when those fields are unchanged locally?
12. Can Base44 support provide an official recommended workflow for safe schema-only changes in a project with existing production data?

## 5. Unsafe tooling incident note

`base44 eject` must not be used again for schema inspection.

It was tested as a possible read-only inspection path, but it entered create/link/build/deploy behavior instead of exporting a live schema map. The process was interrupted and is not considered read-only evidence.

Support request:

- confirm whether the interrupted `base44 eject` flow created any project, version, deployment, or linked-app artifact
- provide the safe way to inspect and remove any artifact created by that interrupted flow
- confirm that `base44 eject` is not intended as a read-only schema export command
- identify the correct read-only schema inspection path, if one exists

This support packet intentionally does not include device codes, access tokens, project credentials, raw private account data, or raw live schema exports.

## 6. Evidence bundle

Source and PR evidence:

| Evidence | Value |
| --- | --- |
| OCC4 schema source PR | https://github.com/NuViraJuiceCo/nuvira-juice/pull/523 |
| OCC4 merge commit | `3e90ccbba3b633f648ea3ea1cd29a200c7124992` |
| PUB2 equivalence audit PR | https://github.com/NuViraJuiceCo/nuvira-juice/pull/524 |
| PUB2 merge commit | `5c7ee1a7bc32626db96e130cc4e8872899a1f6b7` |
| Local entity count | `58` |
| Intended entity creates | `0` |
| Intended entity deletes | `0` |
| Intended entity updates | `3` |
| Current blocker classification | `subscription_occurrence_schema_publish_blocked_no_live_schema_export` |

Target local normalized hashes from the merged Git schema map:

| Entity | Local normalized SHA-256 |
| --- | --- |
| `Order` | `c8f42e9aeae31818874ffc38c702cf78ee499611f20443ed64d127eae3b5be8d` |
| `ShopifyOrder` | `eb02bc22561281dfc325b2857042ee417b35ca58e555f0cbb2cf92f21bf8e729` |
| `FulfillmentTask` | `bd7423c691682f558df99334598b21bd0d8fba07b018ef396250d2d7e1dd0f34` |

Compatibility evidence:

- OCC4 fixture harness proved the new fields are optional/internal and compatible with existing one-time, historical, ShopifyOrder, and FulfillmentTask rows.
- PUB2 fixture harness proved the equivalence contract logic for entity-set drift, unrelated schema drift, expected three-entity additive diffs, and no-publish/no-record-mutation behavior.
- No historical subscription backfill is required or approved.
- OCC5 and G46C remain blocked until the fields are live.

## 7. Acceptance criteria for a support-provided path

A support-provided path is acceptable only if at least one of these options is available.

### Option A — Entity-specific publish

Support or CLI can publish exactly:

- `Order`
- `ShopifyOrder`
- `FulfillmentTask`

Required guarantees:

- no other entities are created, updated, or deleted
- no data rows are created, updated, deleted, or backfilled
- the added fields remain optional/internal with no defaults or constraints
- rollback procedure is documented

### Option B — Read-only full live export

Support or CLI/API can export the complete live entity-schema map read-only.

Required guarantees:

- export does not create/link/build/deploy any project or resource
- export includes all live entity schemas
- export includes behavior-affecting metadata such as RLS, visibility, defaults, enums, constraints, indexes, descriptions, and required arrays
- no credentials or private account data are included in the committed audit output

This enables a full local/live equivalence audit before any full-map push is considered.

### Option C — Server-confirmed dry run

Support or CLI/API provides a server-side dry-run/diff for the complete schema-map push.

Required predicted impact:

```text
created: 0
deleted: 0
updated: 3
updated_entities:
  - Order
  - ShopifyOrder
  - FulfillmentTask
```

Required diff detail:

- no unrelated entity changes
- no removed fields
- no changed existing fields
- no required-field additions
- no default additions
- no uniqueness/index/constraint/enum changes
- no RLS or visibility changes

## 8. Hard stops

- No `base44 entities push` without equivalence proof or server-confirmed dry-run.
- No `base44 deploy`.
- No `base44 eject` for schema inspection.
- No Builder Fix All.
- No broad Builder publish.
- No schema publish without separate explicit approval.
- No historical subscription backfill.
- No occurrence materialization.
- No Customer App Order, ShopifyOrder, or FulfillmentTask record creation.
- No customer subscription read cutover.
- No Stripe authority change.
- No Hub authority change.
- No provider calls.
- No notifications.

## 9. Current blocked migration impact

Until Base44 provides a safe schema publication path, these remain blocked:

- G46B-OCC5 runtime/linkage work
- G46C customer subscription reads
- future subscription occurrence materialization
- subscription occurrence native chain proof

The correct interim action is to move to another Hub-dependent page/domain rather than adding subscription runtime work around schema fields that are not live.

## 10. No-write and no-publish confirmation

This SUPPORT1 phase is documentation-only.

- No schema files changed.
- No runtime files changed.
- No UI files changed.
- No `base44 entities push` run.
- No `base44 deploy` run.
- No `base44 eject` run.
- No Builder publish or Fix All run.
- No records created, updated, deleted, or backfilled.
- No subscription occurrences, orders, native orders, or tasks created.
- No Stripe, Shopify, Hub, or provider calls.
- No notifications sent.
- No credentials, tokens, raw live schema exports, or private account data included.

## 11. Recommendation

Hold OCC5 and G46C until Base44 provides one of the accepted tooling paths.

Preferred support outcome:

1. Entity-specific publish for exactly `Order`, `ShopifyOrder`, and `FulfillmentTask`.
2. If entity-specific publish is unavailable, provide a read-only complete live schema export or server-side dry-run sufficient to prove a full-map push would produce exactly `created:0`, `deleted:0`, `updated:3`.
3. If neither is available, keep subscription occurrence migration blocked and continue with another Hub-dependent migration domain.
