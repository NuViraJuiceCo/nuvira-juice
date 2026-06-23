# Native release checklist

Do not archive or upload until G50B and G50C are merged and required gates pass on current `main`.

## Source

- [ ] Worktree clean.
- [ ] `HEAD` equals exact approved `origin/main` commit.
- [ ] Approved commit recorded.
- [ ] `scripts/release/verify-native-release-source.mjs --policy-mode release --approved-commit <sha>` passes.
- [ ] Open critical PR gate passes or has documented approved exclusions.
- [ ] No stale native-shell branch used.

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

## Required smoke

- [ ] Signed out startup.
- [ ] Signed in with complete profile.
- [ ] Signed in with incomplete profile.
- [ ] Slow network startup.
- [ ] Offline startup.
- [ ] Auth callback.
- [ ] Background/resume.
- [ ] Force close/reopen.
- [ ] Try Again.
- [ ] Return Home.
- [ ] Reset Sign-In.

## Holds

- [ ] Website fallback remains available until native smoke passes.
- [ ] No unrelated feature work included.
