// Recovery state is an opaque attempt reference, never a payment secret or
// saved address/cart. Local persistence is not a cross-tab/database mutex.
const ownerPattern = /^[A-Za-z0-9._:-]{1,120}$/;
const attemptPattern = /^[A-Za-z0-9_-]{20,200}$/;
const storageKey = owner => {
  if (!ownerPattern.test(owner || '')) throw new Error('reward_recovery_owner_invalid');
  return `nuvira_reward_checkout_attempt_v1:${owner}`;
};

export function readRewardCheckoutAttempt(storage, owner) {
  const raw = storage.getItem(storageKey(owner));
  if (raw === null) return null;
  let value;
  try { value = JSON.parse(raw); } catch { throw new Error('reward_recovery_storage_invalid'); }
  if (value?.version !== 1 || !attemptPattern.test(value.attempt_key || '')
    || !Number.isSafeInteger(value.created_at) || value.created_at <= 0) {
    throw new Error('reward_recovery_storage_invalid');
  }
  // Age alone never proves provider expiry or points release.
  return { version: 1, attempt_key: value.attempt_key, created_at: value.created_at };
}

export function saveRewardCheckoutAttempt(storage, owner, attemptKey, now = Date.now()) {
  if (!attemptPattern.test(attemptKey || '') || !Number.isSafeInteger(now) || now <= 0) {
    throw new Error('reward_recovery_attempt_invalid');
  }
  const prior = readRewardCheckoutAttempt(storage, owner);
  if (prior && prior.attempt_key !== attemptKey) throw new Error('reward_recovery_prior_attempt');
  const value = prior || { version: 1, attempt_key: attemptKey, created_at: now };
  storage.setItem(storageKey(owner), JSON.stringify(value));
  const saved = readRewardCheckoutAttempt(storage, owner);
  if (saved?.attempt_key !== attemptKey) throw new Error('reward_recovery_storage_unconfirmed');
  return saved;
}

export function clearRewardCheckoutAttempt(storage, owner, attemptKey) {
  const prior = readRewardCheckoutAttempt(storage, owner);
  if (!prior) return true;
  if (prior.attempt_key !== attemptKey) throw new Error('reward_recovery_attempt_changed');
  storage.removeItem(storageKey(owner));
  if (readRewardCheckoutAttempt(storage, owner)) throw new Error('reward_recovery_clear_unconfirmed');
  return true;
}
