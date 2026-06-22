# G49C iOS version train bump

## Reason

The current-main iOS release candidate upload for build 20 was rejected by App Store Connect because the archive used marketing version `2.117903.0`, while App Store Connect reported a previously approved version `2.117905.0` and closed the older train for new build submissions.

## Patch

- Bump iOS marketing version to `2.117906.0`.
- Bump iOS build number to `21`.
- No source-code or checkout behavior changes.

## Scope

Changed files:

- `ios/App/App.xcodeproj/project.pbxproj`
- `docs/migration/g49c-ios-version-train-bump.md`

## Safety

- No Base44 publish.
- No Builder publish.
- No PaymentIntent or Order creation.
- No provider call other than the App Store Connect upload attempt after rebuild.
- No customer data, Stripe keys, or private signing material recorded.
