# G39H-PATCH1: Calendar Summary Runtime Activation Unblock

## Executive summary

G39H was merged, and the deployed Base44 source for `getAdminCalendarEventsSummary` contains the native-first calendar markers. However, live admin-auth runtime responses continued returning the old response shape without `native_first_enabled`, `writes_performed`, `provider_call_impact`, or `hub_mutation_performed`.

This patch is a runtime-activation hardening change only. It keeps the calendar summary read-only, keeps Hub fallback active, preserves the existing `Calendar.jsx` response contract, and adds a PATCH1 marker so the live runtime can be proven after scoped publish.

## Symptoms

- PR #474 merged G39H source.
- Scoped publish for `getAdminCalendarEventsSummary` timed out during Deno deployment activation.
- Base44 CLI 0.0.54 timed out.
- Base44 CLI 0.0.55 timed out.
- Error observed: `Deno deployment failed: Operation wait_for_deployment(getAdminCalendarEventsSummary) timed out after 90 seconds`.
- Pulling the deployed function source showed the G39H markers were present in remote source.
- Live admin-auth runtime responses still lacked the G39H metadata fields.

## Source/runtime mismatch evidence

Local and pulled Base44 source included these G39H markers:

- `native_first_enabled`
- `native_event_count`
- `hub_fallback_event_count`
- `suppressed_hub_event_count`
- `fallback_required`
- `fallback_reasons`
- `calendar_events_source`
- `writes_performed:false`
- `provider_call_impact:false`
- `notifications_sent:false`
- `hub_mutation_performed:false`
- `live_command_candidate:false`

Live runtime responses still returned only the old shape:

- `success`
- `date_from`
- `date_to`
- `generated_at`
- `summary`
- `dates`
- `truncated`

The live response omitted `native_first_enabled`, `writes_performed`, `provider_call_impact`, and `hub_mutation_performed`, so G39H was classified as `patch_required` / not live.

## Root-cause hypothesis

The best-supported hypothesis is Deno deployment activation friction rather than a business-logic failure:

- Source upload succeeded because pulled remote source contained the G39H markers.
- Live runtime continued serving the previous activated version after activation timeout.
- The function has no expensive top-level reads, provider calls, Hub calls, or loops at module load.
- A local Deno parse/type check without repo config reported many TypeScript strictness findings in the file. Older source also had strictness findings, but G39H added a larger helper surface and more inferred object shapes.

PATCH1 therefore narrows deployment activation risk by disabling TypeScript checking for this Base44 function file while preserving JavaScript runtime syntax checks and harness coverage.

## Patch summary

PATCH1 changes only `getAdminCalendarEventsSummary` runtime source and this documentation:

- Adds `// @ts-nocheck` at the top of the function file to avoid Deno deploy activation being blocked or slowed by strict inferred-type analysis in a Base44 function that is authored as JavaScript-style TypeScript.
- Adds marker constant `g39h_patch1_calendar_runtime_activation_unblock`.
- Adds safe additive response metadata `runtime_activation_patch` with that marker.

No Calendar UI code is changed.

## Safety guarantees

PATCH1 preserves the G39H behavior:

- native calendar context remains primary where complete
- Hub fallback remains active
- missing/incomplete native context can still use Hub fallback
- subscription and multi-delivery context remains Hub source-of-truth
- historical Hub-only rows remain retained where appropriate
- duplicate native/Hub events are deduped with native preferred
- stale Hub events remain suppressible when corrected native stable-id/date context exists

PATCH1 keeps these safety fields:

- `writes_performed:false`
- `provider_call_impact:false`
- `notifications_sent:false`
- `hub_mutation_performed:false`
- `live_command_candidate:false`

## No-write policy

This patch must not:

- create or update Customer App records
- create or update native records
- create or update Event records
- create logs or queues
- call Stripe, Shopify, providers, or notification systems
- run sync, repair, replay, inventory deduction, or PurchaseOrder automation
- mutate Hub records
- change customer-facing behavior
- disable Hub fallback

## Publish verification plan

After merge, publish only `getAdminCalendarEventsSummary`.

The live source must contain:

- `g39h_patch1_calendar_runtime_activation_unblock`
- `native_first_enabled`
- `hub_fallback_event_count`
- `calendar_events_source`
- `writes_performed:false`
- `provider_call_impact:false`
- `notifications_sent:false`
- `hub_mutation_performed:false`
- `live_command_candidate:false`

Admin-auth live runtime responses must include:

- `native_first_enabled:true`
- `writes_performed:false`
- `provider_call_impact:false`
- `notifications_sent:false`
- `hub_mutation_performed:false`
- `live_command_candidate:false`
- `calendar_events_source`
- `runtime_activation_patch:g39h_patch1_calendar_runtime_activation_unblock`

If live runtime responses still omit G39H metadata after a successful publish, classify as `runtime_not_activated` and do not proceed to the next Hub burn-down surface.

## Rollback plan

Rollback is code-only:

1. Revert the PATCH1 commit if it causes deployment or runtime issues.
2. Keep Hub fallback active.
3. Do not run data repair because PATCH1 is read-only.
4. Do not mutate records.
5. Re-run scoped publish and boundary verification for `getAdminCalendarEventsSummary`.

## Readiness classification target

PATCH1 can close only when live runtime returns the G39H metadata and no-write verification remains clean.

Target classification:

- `calendar_events_native_first_patch_live`

Otherwise:

- `runtime_not_activated`
- `patch_required`
