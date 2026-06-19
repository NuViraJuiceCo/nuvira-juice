# G45C: Customer Rewards Limited Native-First Reads

## 1. Executive summary

G45C adds a default-off, limited native-first read selector for the customer Rewards surface. It targets the actual live path:

```text
src/pages/Rewards.jsx -> getCustomerAccountDashboardData -> points_record
```

The Rewards UI is unchanged. `Customer App` dashboard behavior is unchanged while the feature is disabled or the kill switch is active.

G45C does not make loyalty points globally authoritative. It only prepares a controlled customer-read path for exact safe loyalty accounts after G45B confirmed read-only parity candidates and G45B-VERIFY1 completed no-write verification.

## 2. Current Rewards data path

The current customer Rewards page remains mixed-source:

- `src/pages/Rewards.jsx` invokes `getCustomerAccountDashboardData`.
- `getCustomerAccountDashboardData` resolves the authenticated customer's identity aliases, then reads `UserPoints` by exact owned customer email identity.
- `Rewards.jsx` reads active `RewardTier` rows directly for reward catalog display.
- `DEFAULT_REWARDS` remains the static fallback catalog if no active `RewardTier` rows are available.
- Active reward state remains browser `localStorage` state and is not server-authoritative.
- `claimReward` and checkout reward application are not changed.

G45C patches only `base44/functions/getCustomerAccountDashboardData/entry.ts`.

## 3. Feature controls

G45C adds these source-controlled gates:

```text
ENABLE_CUSTOMER_REWARDS_LIMITED_NATIVE_FIRST_READS
CUSTOMER_REWARDS_LIMITED_NATIVE_FIRST_KILL_SWITCH
CUSTOMER_REWARDS_LIMITED_NATIVE_FIRST_USER_POINTS_ALLOWLIST
```

Default behavior:

- enable gate unset/false: current response is preserved.
- kill switch true: current response is preserved.
- allowlist empty or nonmatching: current response is preserved.

The allowlist uses exact internal `UserPoints` ids. It does not accept customer email, name, phone, or fuzzy account identifiers.

## 4. Ownership isolation

Ownership filtering happens before allowlist evaluation:

1. the function authenticates the customer,
2. resolves owned identity emails through `UserProfile`,
3. reads `UserPoints` only for those owned identities,
4. evaluates allowlisted `UserPoints` ids only within the owned rows.

An allowlisted id belonging to another customer cannot be selected because cross-customer rows are never eligible unless they are returned by the authenticated ownership-filtered identity reads.

## 5. Limited native read eligibility

A loyalty account may use the G45C native read path only when all of these are true:

- feature gate enabled,
- kill switch disabled,
- exactly one owned `UserPoints` row matches the exact allowlist,
- exactly one owned loyalty identity is present,
- direct point counters exist and are finite,
- point counters are not negative or impossible,
- embedded history is reconstructable enough for read parity,
- direct balance and reconstructed history agree,
- derived Rewards tier is deterministic,
- stored tier, when present, agrees with the derived tier,
- active `RewardTier` catalog is present and deterministic,
- reward point costs are valid,
- duplicate active reward definitions are absent,
- no repair/replay/backfill/manual-review hold is detected.

If any condition fails, the function returns the current fallback response.

## 6. Customer-safe output

For an eligible allowlisted account, G45C returns only the customer-safe loyalty fields needed by the current Rewards UI:

- `total_points`
- `lifetime_points`
- `redeemed_points`
- `current_tier`
- `points_to_next_tier`
- `tier_progress_percent`

The enabled native read path strips loyalty-specific unsafe fields from `points_record`:

- internal `UserPoints` id,
- `customer_email`,
- raw `points_history`,
- `claimed_rewards`,
- native-read diagnostics,
- fallback/review reasons,
- source-of-truth labels.

The broader dashboard identity/profile response contract is otherwise unchanged for non-loyalty fields.

## 7. Fallback rules

G45C preserves the current response when:

- feature disabled,
- kill switch active,
- allowlist empty or nonmatching,
- identity ambiguous,
- duplicate owned `UserPoints` records exist,
- balance is missing, invalid, negative, or impossible,
- balance/history mismatch exists,
- tier mismatch exists,
- native reward catalog is empty, duplicated, or invalid,
- repair/replay/backfill/manual-review evidence exists,
- account is not the authenticated customer's owned loyalty account.

## 8. Write and authority holds

G45C does not change or approve any loyalty write behavior.

Hard holds remain:

- `redemption_write_ready:false`
- `point_mutation_ready:false`
- `refund_reversal_ready:false`
- `subscription_points_ready:false`
- `pos_points_ready:false`
- `notification_expansion_ready:false`
- `hub_write_suppression_ready:false`

No changes are made to:

- `claimReward`,
- point deduction,
- point grants,
- refunds or reversals,
- subscription points,
- POS points,
- referral issuance,
- notifications,
- Hub writes,
- checkout reward application,
- browser `localStorage` reward state.

## 9. Test coverage

Added harness:

```text
scripts/migration/run-g45c-customer-rewards-limited-native-first-reads-tests.mjs
```

Coverage includes:

1. feature disabled preserves current Rewards response,
2. kill switch preserves current response,
3. nonallowlisted account preserves fallback,
4. ownership filtering precedes allowlist evaluation,
5. cross-customer account cannot be returned,
6. exact safe account receives native balance,
7. exact safe account receives native tier,
8. tier progress remains compatible,
9. deterministic native catalog displays safely,
10. inactive/expired rewards are excluded,
11. duplicate loyalty identity preserves fallback,
12. invalid/negative balance preserves fallback,
13. balance/history mismatch preserves fallback,
14. tier mismatch preserves fallback,
15. repair/replay hold preserves fallback,
16. Hub context unavailable does not become parity,
17. localStorage remains client-only and non-authoritative,
18. no customer-visible G45C diagnostics,
19. no raw loyalty history or loyalty PII in enabled native-read payload,
20. no point mutation,
21. no reward redemption,
22. no referral creation,
23. no provider calls,
24. no notifications,
25. no Hub mutation,
26. non-loyalty dashboard fields remain unchanged.

## 10. No-write policy

G45C is read-only PR prep.

It does not:

- mutate `UserPoints`,
- mutate `RewardTier`,
- create/update/delete records,
- grant/deduct/reverse points,
- claim/redeem rewards,
- create referrals,
- call Stripe, Shopify, Hub, or providers,
- send notifications,
- run sync/repair/replay,
- create logs or queues.

## 11. Rollback and activation plan

Rollback before activation is trivial: keep the enable gate disabled or the kill switch active.

After merge:

1. publish only `getCustomerAccountDashboardData`,
2. keep the feature disabled,
3. boundary verify authenticated Rewards/dashboard behavior,
4. smoke the current Rewards page,
5. request separate `G45C-LIVE1` approval for one exact proven `UserPoints` id only.

Do not expand from the G45B bounded scan candidates automatically. The G45B scan was truncated and is not fleet-wide source-of-truth evidence.

## 12. Recommendation

Close and merge G45C if checks remain clean. Publish only the changed backend function after merge, keep the feature disabled, and run disabled customer Rewards smoke before any exact activation.

Do not migrate redemption, point writes, refund points, subscription points, POS points, notifications, or Hub write suppression in G45C.
