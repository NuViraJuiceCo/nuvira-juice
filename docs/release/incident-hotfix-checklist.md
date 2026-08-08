# Incident/hotfix checklist

Use this checklist when production reliability is affected.

1. Identify exact user-facing failure and affected platform.
2. Freeze unrelated feature work.
3. Verify current production source, Base44 live asset, active Appflow Production commit, store builds, and latest `origin/main` independently.
4. Patch from current `main`, not from a stale branch.
5. Keep runtime, backend, provider, and payment scope explicit.
6. Run the critical regression suite.
7. Run Web/native bundle parity if native or shared Web code is affected.
8. Require PR review and merge before release build.
9. Deploy Base44 and Appflow from the one approved commit and run the deployment-provenance gate before any native archive.
10. Generate the release manifest before native archive.
11. TestFlight and Play internal testing first for native changes; verify the active Appflow snapshot on physical devices.
12. Record rollback plan.
13. Do not suppress Hub/provider/payment safeguards unless separately approved.
14. Do not delete or retire a function without the call-site, automation, webhook, lifecycle, replacement, and rollback evidence required by the change runbook.
