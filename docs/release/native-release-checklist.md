# Native release checklist

Do not archive or upload until required gates pass on current `main`. Follow `docs/release/change-and-release-runbook.md`; Web, Appflow, and store builds are one release with one source identity.

## Source

- [ ] Worktree clean.
- [ ] `HEAD` equals exact approved `origin/main` commit.
- [ ] Approved commit recorded.
- [ ] `scripts/release/verify-native-release-source.mjs --policy-mode release --approved-commit <sha>` passes.
- [ ] Open critical PR gate passes or has documented approved exclusions.
- [ ] No stale native-shell branch used.

## Deployment provenance

- [ ] Base44 was built and deployed from the approved commit.
- [ ] Base44 deployment record contains the exact approved commit, deployment ID, and resulting live entry asset.
- [ ] Appflow Web was built from the same full approved commit.
- [ ] Appflow Production shows that Web build as Active.
- [ ] Base44 and Appflow observations are less than 24 hours old.
- [ ] `npm run release:verify-deployment-provenance` passes.
- [ ] Manual Native Release Gate was run with the exact deployment evidence.
- [ ] No native archive/upload started before deployment provenance passed.

## Build and manifest

- [ ] `npm ci` completed.
- [ ] Critical regression suite passed.
- [ ] Web build passed.
- [ ] `npx cap sync ios` completed.
- [ ] Web/native bundle parity passed.
- [ ] iOS simulator build passed with signing disabled.
- [ ] Release manifest generated and retained as artifact.
- [ ] Version/build increment is intentional and recorded.

## Distribution

- [ ] TestFlight internal distribution first.
- [ ] No automatic App Store release before smoke approval.
- [ ] Upgrade over current App Store build tested.
- [ ] Clean install tested.
- [ ] Installed version/build matches manifest.
- [ ] Active Appflow build/snapshot after launch matches the approved commit.
- [ ] iOS and Android are reported separately; one platform does not clear the other.

## Required smoke

- [ ] Signed out startup.
- [ ] Signed in with complete profile.
- [ ] Signed in with incomplete profile.
- [ ] Slow network startup.
- [ ] Offline startup.
- [ ] Auth callback.
- [ ] Email sign-in.
- [ ] Apple sign-in where enabled.
- [ ] Google sign-in where enabled.
- [ ] Profile completion.
- [ ] Background/resume.
- [ ] Force close/reopen.
- [ ] Try Again.
- [ ] Return Home.
- [ ] Reset Sign-In.

## Holds

- [ ] Website fallback remains available until native smoke passes.
- [ ] No unrelated feature work included.
- [ ] Any failed channel blocks `ready`, `live`, and `100%` language.
