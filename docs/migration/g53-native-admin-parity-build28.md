# G53 native admin parity Build 28

## Goal

Package the current deployed Customer App web/admin experience into the iOS shell after the controlled G53 production/compliance and fulfillment/delivery live pilots.

## Version

- Marketing version: `2.117911.0`
- Build number: `28`
- Bundle identifier: `com.base69d48d0c39891f7945481152.app`

## Scope

Build 28 is a local release candidate until its full source is committed, reviewed, and reproduced from a clean approved commit.

The candidate may be compiled for the simulator and archived locally. It must not be uploaded to App Store Connect from the current dirty working tree.

## Required release boundary

- Web/native bundle parity passes.
- Critical regressions pass.
- Simulator Release build passes.
- Archive signing is valid if a local archive is produced.
- The physical iPhone is online for clean-install and upgrade smoke testing.
- The complete source is committed and the release is reproduced from that exact approved commit.
- TestFlight distribution precedes any App Store release.

## Safety

- No payment authorization.
- No customer notification.
- No provider mutation.
- No customer order, inventory, refund, or subscription mutation.
- No App Store upload from uncommitted source.
