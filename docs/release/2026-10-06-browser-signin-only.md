# Browser Sign-In Return Fix

## Scope

Website-only correction, isolated from the local desktop redesign and the
unpublished Speed PR #810. Based on canonical main
`27bd7d184e7d957a07aef59b33744f01e7af1c08`.

Browser Google/Apple sign-in returns to the originating site's sanitized
account, checkout, or other requested browser route, not `/native-login`.
That native route is covered by the existing Apple app association and can
open the installed app. Native authentication plugin and bridge paths remain
unchanged. Legacy Login/Register provider entry points share the same guard.
The isolated design preview refuses live provider authentication explicitly.

## Verification

The browser-provider regression harness executes the actual page handlers
and Base44 SDK URL construction with synthetic credentials and no provider
requests. It covers repeat Google and Apple starts, same-origin return paths,
native-route rejection, unsafe return values, legacy pages, and preview guards.
Existing native auth and checkout regression suites remain required.

Three already-merged internal merge references are recorded for PRs #804,
#805, and #808 to repair the existing release-manifest failure on main.
GitHub PR heads, merge commits, and ancestry were checked. The previous native
release commit and all enforcement rules are unchanged. Speed PR #810 is
explicitly excluded at its reviewed exact head with a time-limited
acknowledgement, following the owner's sign-in-only authorization.

## Release Boundary

After CI passes, build from a clean detached checkout of the exact merged
commit. Publish only the Base44 website for app `69d48d0c39891f7945481152`.
Do not publish functions, entities, providers, settings, native/Appflow/store
builds, the desktop redesign, or unpublished Speed changes. Verify asset
hash parity on both live website domains and inspect the provider return URL.
Full authenticated Google/Apple completion on the owner's device remains a
separate acceptance check, not something synthetic regression tests prove.
