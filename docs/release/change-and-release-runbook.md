# NuVira change and release runbook

This is the required process for information updates, fixes, function cleanup, and releases. A change is complete only when every applicable gate has evidence. Passing one channel does not imply that another channel passed.

## 1. Classify the change before editing

| Change type | Minimum path |
| --- | --- |
| Customer/order/loyalty data correction | Read-only reconciliation, exact affected-record list, backup or reversible correction, idempotent write, post-write reconciliation, no unrelated notifications |
| Backend function, automation, or entity change | Call-site and automation audit, PR and regression tests, scoped deployment, safe synthetic/live verification, monitoring and rollback |
| Web-only UI or content | PR and CI, Base44 deploy from the approved commit, exact live URL and responsive smoke |
| Shared Web/native JavaScript | PR and CI, Base44 and Appflow from one approved commit, deployment-provenance gate, native bundle sync, TestFlight/Play internal smoke |
| Native shell, signing, or store metadata | PR and CI, deployment-provenance gate, archive once from the approved commit, store validation, physical-device clean-install and upgrade smoke |

If a change crosses rows, use every applicable gate.

## 2. Establish the baseline and blast radius

1. Record the exact user-visible failure, affected platform, expected result, and rollback condition.
2. Inspect production read-only before changing records or providers.
3. Identify every source of truth, projection, automation, webhook, route, and customer communication affected.
4. Record what must not change: payments, unrelated orders, loyalty balances, inventory, emails, push, and store releases.
5. Work from a clean branch based on current `origin/main`; never continue from an old release workspace.

## 3. Function retirement rule

Never delete a function because its name looks old, specific, duplicated, or because no direct import is found.

Before retirement, prove all of the following:

- No frontend, native, backend, or dynamically constructed invocation remains.
- No Base44 automation, scheduled job, webhook, provider callback, or external URL targets it.
- No entity lifecycle, auth/profile, checkout, loyalty, production, delivery, or communications flow depends on it.
- A replacement owner and rollback path are recorded when behavior moved elsewhere.
- The function is disabled or quarantined first when the platform permits it, observed through a representative cycle, and deleted only after the observation window passes.

Emergency deletions require an explicit incident record and immediate rollback plan.

## 4. Implement and validate

1. Keep the change narrowly scoped and preserve unrelated user changes.
2. Add a regression test that fails on the original problem.
3. Run lint, typecheck, build, critical regressions, secret scan, and applicable domain suites.
4. For native/shared Web changes, run Capacitor sync and Web/native bundle parity.
5. Review the final diff for hidden generated files, credentials, PII, provider calls, and unintended live writes.
6. Merge through one reviewed PR and record the full approved commit SHA.

## 5. Enforce one source identity across channels

For any shared Web/native release, use this order:

1. Build and deploy Base44 from the approved commit.
2. Record the full commit used for the Base44 deployment, the resulting deployment ID, and the live entry asset. The commit must equal the approved commit. (Bundle filenames can differ across provider build environments.)
3. Build Appflow Web from the same full commit, assign it to Production, and verify it is Active.
4. Run `npm run release:verify-deployment-provenance` with the observed Base44 and Appflow evidence.
5. Run the manual Native Release Gate. It now requires the deployment identifiers, assets, commits, and observation times and will fail on drift.
6. Only after that gate passes, archive iOS/Android once from the same commit and upload that exact archive.

If Appflow cannot be proven current, native archive/upload is blocked. A newer native binary must never be allowed to load an older Appflow Production snapshot.

For a local evidence run, supply the same values used by the manual gate:

```bash
RELEASE_APPROVED_COMMIT=<full-sha> \
RELEASE_BASE44_DEPLOYMENT_ID=<deployment-id> \
RELEASE_BASE44_COMMIT=<full-sha> \
RELEASE_BASE44_ENTRY_ASSET=<index-file.js> \
RELEASE_BASE44_OBSERVED_AT_UTC=<iso-timestamp> \
RELEASE_APPFLOW_BUILD_ID=<build-id> \
RELEASE_APPFLOW_COMMIT=<full-sha> \
RELEASE_APPFLOW_STATUS=active \
RELEASE_APPFLOW_OBSERVED_AT_UTC=<iso-timestamp> \
npm run release:verify-deployment-provenance -- --out release-evidence/deployment-provenance.json
```

## 6. Distribution and physical-device sign-off

TestFlight and Play internal testing come before customer release. Record each platform separately:

- Installed app version/build matches the release manifest.
- Clean install and upgrade from the current store build both pass.
- The active Appflow build/snapshot after launch belongs to the approved commit.
- Email, Apple, and Google sign-in are tested where enabled.
- New profile, incomplete-profile completion, checkout, payment return, order confirmation, push registration, deep links, background/resume, and force-close/reopen pass when in scope.
- Admin consequences of a customer order—ingestion, production, fulfillment, loyalty, email, push, and reconciliation—pass with an isolated authorized test order when in scope.

No release may be described as `100%`, `live`, or `ready` while any applicable device, provider, store, or customer-journey gate is pending.

## 7. Closeout and rollback

1. Keep the release manifest, deployment-provenance evidence, store build IDs, device results, and links to the PR and provider builds together.
2. Verify production after deployment at the exact external URL or app journey reported by the user.
3. Monitor errors and communications after release without changing customer data unless separately authorized.
4. If a gate fails, stop promotion, restore the last known-good channel/build, and document the mismatch before retrying.
5. Update the previous released commit only after the approved release finishes all required gates.

## Status language

Report each row independently: Source, Automated tests, Base44 Web, Appflow Production, iOS, Android, Physical device, Providers, and Customer journey. Use `Passed`, `Failed`, `Pending`, or `Not applicable`; never infer one row from another.
