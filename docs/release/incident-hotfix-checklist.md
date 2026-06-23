# Incident/hotfix checklist

Use this checklist when production reliability is affected.

1. Identify exact user-facing failure and affected platform.
2. Freeze unrelated feature work.
3. Verify current production source and latest `origin/main`.
4. Patch from current `main`, not from a stale branch.
5. Keep runtime, backend, provider, and payment scope explicit.
6. Run the critical regression suite.
7. Run Web/native bundle parity if iOS native is affected.
8. Require PR review and merge before release build.
9. Generate release manifest before native archive.
10. TestFlight first for native changes.
11. Record rollback plan.
12. Do not suppress Hub/provider/payment safeguards unless separately approved.
