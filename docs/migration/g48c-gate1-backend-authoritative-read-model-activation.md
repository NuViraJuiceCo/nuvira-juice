# G48C-GATE1 — Backend-authoritative production/compliance read-model activation

## 1. G48C deployed-disabled result

G48C merged in PR #554 at `fdd8bbf3e1d2580d92a41abb76a96600540e6587` and was published disabled.

Published scope:

- `getAdminProductionPlanningSummary`
- Web/admin UI bundle

Verified result:

```text
production_compliance_read_model_deployed_disabled_ui_activation_tooling_unresolved
```

The backend helper deployed correctly from the function-local directory. No production, compliance, order, task, Hub, notification, provider, or customer-facing mutation occurred.

## 2. Vite/Builder activation blocker

G48C originally used a ComplianceOps frontend gate:

```text
VITE_ENABLE_ADMIN_PRODUCTION_COMPLIANCE_READ_MODEL
```

That was safe while disabled but not a proven activation path because a reliable Builder/Vite production environment-variable injection mechanism has not been established for this app. Activation must not depend on a browser bundle variable that may require a Builder-specific configuration path.

## 3. Selected backend-authoritative contract

G48C-GATE1 removes the G48C-specific Vite gate. ComplianceOps now makes the versioned read-only request to the existing admin-authenticated backend function:

```text
getAdminProductionPlanningSummary
read_model_mode=PRODUCTION_COMPLIANCE_LIFECYCLE
```

The backend remains the only activation authority. It evaluates:

- admin authorization;
- requested read-model mode;
- `ENABLE_ADMIN_PRODUCTION_COMPLIANCE_READ_MODEL`;
- `ADMIN_PRODUCTION_COMPLIANCE_READ_MODEL_KILL_SWITCH`.

On explicit read-model requests, the backend returns safe admin-only capability metadata:

```text
production_compliance_read_model_available
production_compliance_read_model_enabled
production_compliance_read_model_version
```

The browser does not receive secret names, secret values, allowlist values, or backend configuration details.

## 4. Disabled behavior

With backend G48C still disabled, the explicit read-model request returns the existing production-planning response plus safe capability metadata indicating disabled state. It does not load the lifecycle payload and does not perform additional production/compliance matching reads.

Expected disabled behavior:

```text
success=true
production_compliance_read_model_available=true
production_compliance_read_model_enabled=false
production_compliance_read_model_version=g48c_production_compliance_lifecycle_v1
writes_performed=false
```

ComplianceOps preserves the existing `getAdminComplianceOpsSummary` rendering and hides the G48C canonical panel.

## 5. Future enabled behavior

When a later approved backend activation returns:

```text
production_compliance_read_model_enabled=true
production_compliance_read_model_version=g48c_production_compliance_lifecycle_v1
production_compliance_lifecycle_read_model.read_model_enabled=true
```

ComplianceOps may render the canonical production/compliance read-model panel. The UI does not perform independent batch/log matching and does not select records by fuzzy names, newest timestamps, local storage, query parameters, or browser globals.

## 6. Version negotiation

ComplianceOps accepts only:

```text
g48c_production_compliance_lifecycle_v1
```

Unsupported, missing, or malformed version metadata fails closed to the existing ComplianceOps path.

## 7. Fallback behavior

Fallback is preserved when:

- backend request fails;
- response is malformed;
- enabled marker is absent;
- version is unsupported;
- lifecycle payload is missing;
- rows are incomplete;
- fallback is required;
- review is required.

Valid existing compliance rows remain visible through the existing ComplianceOps summary.

## 8. Write-path isolation

G48C-GATE1 does not change:

- production lifecycle write commands;
- compliance save/validate/verify actions;
- schemas/entities;
- Hub reads or writes;
- customer-facing status;
- notifications;
- provider integrations;
- Apple Pay PR #545.

The read-model panel is display-only. Read readiness does not imply write readiness.

## 9. Tests

Added:

```text
scripts/migration/run-g48c-gate1-backend-authoritative-activation-tests.mjs
```

Coverage includes:

- no Vite gate required;
- backend disabled hides panel;
- enabled fixture shows panel;
- version negotiation;
- fallback on malformed/failed responses;
- no UI fuzzy matching;
- no query/localStorage/browser-global activation;
- admin-only backend contract;
- no production/compliance/order/task mutation;
- no provider calls;
- no notifications;
- no Hub mutation;
- existing G48C/G39F/ComplianceOps fallback contracts.

The original G48C harness is updated only to recognize the backend-authoritative activation contract instead of the removed Vite gate.

## 10. Publish-disabled plan

After merge:

1. Publish `getAdminProductionPlanningSummary` only if source changed.
2. Publish Web/admin UI only.
3. Keep backend G48C disabled.
4. Verify explicit read-model request returns backend-disabled metadata.
5. Verify ComplianceOps panel remains hidden.
6. Verify no Vite environment variable is needed in the production bundle.
7. Run no-write verification.

## 11. LIVE1 prerequisites

G48C-LIVE1 remains held until separately approved and until there is evidence for an exact candidate:

- exact `ProductionBatch` exists;
- exactly one matching `BatchComplianceLog` exists;
- log is locked;
- pH/pass-fail/status fields are complete and agree;
- no repair/review hold exists;
- current fallback output is recorded;
- admin smoke and no-write verification are planned.

## 12. No-write policy

G48C-GATE1 is PR prep only.

No:

- backend activation;
- production record mutation;
- compliance log mutation;
- compliance alert creation;
- production start/complete/verify;
- Hub suppression;
- provider call;
- notification;
- customer-facing status change;
- Base44 or Builder publish during PR prep.

Final intended PR-prep classification:

```text
production_compliance_read_model_activation_path_pr_ready
```

Gate finding:

```text
frontend_read_model_gate_type=backend_authoritative
frontend_read_model_gate_default=false
frontend_read_model_gate_activation_path_proven=true
```
