## Scope

- [ ] Runtime behavior changed
- [ ] Backend function/schema/entity changed
- [ ] Checkout/payment path changed
- [ ] Native/iOS release-critical path changed
- [ ] Docs/scripts/CI only

## Required declarations

Exact source branch/commit:

Affected platforms:
- [ ] Web
- [ ] iOS native
- [ ] Android native
- [ ] Backend/Base44 functions

Web/native divergence:
- [ ] None
- [ ] Intentional, documented below

Backend/schema/provider impact:
- [ ] None
- [ ] Present, documented below

Tests run:

Real-device test required:
- [ ] No
- [ ] Yes, plan below

Deployment provenance required:
- [ ] No, this cannot change a deployed Web/native channel
- [ ] Yes; Base44, Appflow Production, and native/store builds will use one approved commit

Function retirement or replacement:
- [ ] None
- [ ] Call sites, dynamic invocations, automations, schedules, webhooks, lifecycle dependencies, replacement, observation window, and rollback are documented below

Open critical PR review:
- [ ] No open release-critical PRs affected
- [ ] Open release-critical PRs acknowledged/excluded with reasons

Rollback plan:

Required production verification and owner:

No-write/no-payment statement when applicable:
- [ ] No live records mutated
- [ ] No provider calls
- [ ] No payment submitted
- [ ] No notifications sent
