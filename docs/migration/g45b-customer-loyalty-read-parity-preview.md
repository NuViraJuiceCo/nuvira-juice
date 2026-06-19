# G45B: Customer Loyalty Read-Parity Preview

## 1. Current Rewards data path

G45B extends `base44/functions/previewNativeOrderCutoverReadiness/entry.ts` with an admin-authenticated, read-only preview mode:

```text
preview_mode=CUSTOMER_LOYALTY_READ_PARITY
```

Supported modes:

1. `EXACT_CUSTOMER_LOYALTY_PARITY`
2. `BOUNDED_LOYALTY_READINESS_SCAN`

This does not change the live Rewards page. The customer-facing `/rewards` path remains the mixed source documented in G45A:

- `src/pages/Rewards.jsx` reads customer account data through `getCustomerAccountDashboardData`.
- `getCustomerAccountDashboardData` reads `UserPoints` for displayed balance, lifetime points, redeemed points, and points record data.
- `Rewards.jsx` reads `RewardTier` directly for the active reward catalog.
- `DEFAULT_REWARDS` remains a static fallback catalog when no active `RewardTier` rows are available.
- Active reward state remains browser `localStorage`-backed and is not server-authoritative.
- `claimReward` remains an existing write path and is not invoked by this preview.

## 2. Native UserPoints findings

`UserPoints` is the current native display source for customer loyalty balance:

- `customer_email`
- `total_points`
- `lifetime_points`
- `redeemed_points`
- `points_history[]`
- `claimed_rewards[]`

G45B evaluates `UserPoints` only through exact admin-safe identifiers or bounded admin scans. It does not return customer email, name, phone, address, raw records, or raw history notes.

Exact preview identifiers:

- `user_points_id`
- `user_profile_id`, only as an exact profile id that can resolve internally to an owned points row
- `authenticated_user_id`, only as an exact internal user/profile id where supported

Unsupported identity forms:

- partial email
- customer name
- phone
- fuzzy account matching

## 3. Counter/history limitations

G45B reports points counters separately from points-history reconstruction:

- `direct_points_balance`
- `reconstructable_history_delta`
- `history_reconstructable`
- `history_coverage_complete`
- `balance_history_consistent`
- `history_entry_count`
- `malformed_history_entry_count`
- `duplicate_history_entry_risk`
- `missing_idempotency_key_count`

Important boundary:

```text
balance_history_consistent does not mean native points are authoritative
```

Native authority still requires proven coverage for:

- refunds and cancellations
- subscriptions
- POS points
- manual/admin adjustments
- repair/replay/import/sync history
- reward redemption and point deduction

Because `points_history` is an embedded array and not a separate immutable ledger, G45B classifies history as useful display/parity evidence, not complete source-of-truth proof.

## 4. Tier parity

The customer Rewards UI currently derives tier display from static thresholds in `Rewards.jsx`, not from a separate authoritative tier ledger. G45B mirrors this as:

```text
tier_definition_source=rewards_page_static_tiers
```

The preview reports:

- whether a stored tier field is present on the points row
- the derived display tier
- whether a stored tier, if present, agrees with the derived tier
- whether next-tier progress is safe to calculate for display

A stored/derived mismatch is classified as:

```text
tier_mismatch_manual_review
```

## 5. Reward catalog source

G45B reads `RewardTier` as the native reward catalog source. It reports:

- active reward count
- inactive reward count
- duplicate reward-definition risk
- invalid point-cost risk
- whether the static `DEFAULT_REWARDS` fallback is active

Classifications include:

- `native_catalog_ready`
- `static_fallback_catalog_active`

A customer page must not treat a displayed reward as redeemable unless the authoritative redemption path separately agrees that the reward is active, available, affordable, owned by the customer, and governed by current terms.

## 6. Hub-context limitations

G45B does not add a new broad external Hub call. If no existing safe read-only Hub loyalty context is available, the preview returns:

```text
hub_loyalty_context_unavailable
```

This must not be interpreted as Hub/native parity. Hub fallback and Hub source-of-truth holds remain active for unsupported loyalty contexts.

## 7. localStorage limitation

The active reward displayed in the customer flow is still browser `localStorage` state. G45B reports:

```text
client_reward_state_not_server_authoritative
```

This means local active reward state cannot be used as proof of server-side redemption, ownership, point deduction, or discount authority.

## 8. Read-native candidate rules

A future native-primary Rewards read response may be considered only when:

- authenticated ownership filtering precedes the read
- exactly one native loyalty account exists
- direct balance exists
- no duplicate loyalty identity exists
- no impossible or negative state exists
- history is usable enough for read parity, while still not treated as authoritative
- tier display rules are deterministic
- stored/derived tier either agree or one canonical rule is documented
- reward catalog source is deterministic
- customer-visible rewards are active and valid
- no repair/replay/import/sync hold is visible
- refund/subscription/POS contributions remain explicitly classified or held
- no customer-visible diagnostics are returned

Even for a read candidate:

- redemption remains unchanged
- point writes remain unchanged
- native points are not globally authoritative
- Hub fallback remains active

## 9. Redemption/write hard stops

G45B reports but never invokes loyalty write paths. Response flags remain false:

- `redemption_write_ready:false`
- `point_mutation_ready:false`
- `refund_reversal_ready:false`
- `subscription_points_ready:false`
- `pos_points_ready:false`
- `notification_expansion_ready:false`
- `hub_write_suppression_ready:false`

Hard stops:

- no `UserPoints` mutation
- no `RewardTier` mutation
- no reward claim or redemption
- no points deduction or grant
- no tier update
- no referral creation
- no provider call
- no notification
- no Hub mutation
- no sync/repair/replay
- no CommandLog or OrderSyncLog creation

## 10. Response safety

Every G45B response includes the read-only safety contract:

- `dry_run:true`
- `writes_performed:false`
- `pii_returned:false`
- `raw_payloads_returned:false`
- `provider_call_impact:false`
- `notifications_sent:false`
- `hub_mutation_performed:false`
- `point_mutation_performed:false`
- `reward_redeemed:false`
- `customer_tier_updated:false`
- `referral_created:false`
- `command_log_created:false`

Broad scan summaries return only safe subject references and aggregate readiness fields. They do not return customer email, name, phone, address, raw points history notes, raw Hub payloads, raw Stripe/Shopify payloads, payment method data, or authentication/session fields.

## 11. Tests

Added harness:

```text
scripts/migration/run-g45b-customer-loyalty-read-parity-tests.mjs
```

Coverage includes:

- admin auth boundary
- exact `UserPoints` lookup
- duplicate loyalty identity hold
- balance/history consistency and mismatch
- malformed/missing history handling
- tier match/mismatch
- native catalog and static fallback classification
- duplicate/inactive reward catalog handling
- Hub context unavailable classification
- localStorage non-authority classification
- refund/subscription/POS holds
- repair/replay hold
- native-read candidate classification
- redemption/write hard stops
- no PII/raw payloads
- no points mutation
- no reward redemption
- no providers
- no notifications
- no Hub mutation
- no logs/queues created
- bounded scan one-read-per-source behavior

## 12. Recommendation

Use G45B only as read parity evidence. Do not call Rewards/Loyalty fully migrated and do not switch point authority.

Recommended next sequence:

1. Merge and publish only `previewNativeOrderCutoverReadiness`.
2. Boundary verify the new `CUSTOMER_LOYALTY_READ_PARITY` mode.
3. Run one exact preview for a known safe test/owner account using exact ids.
4. Run one bounded readiness scan.
5. Run no-write verification.
6. Plan G45C only if exact identity, balance/tier display, and catalog determinism are strong enough for a default-off native-read patch.

Redemption, point mutation, refund reversals, subscription points, POS points, notifications, repair/replay, and Hub write suppression remain held.
