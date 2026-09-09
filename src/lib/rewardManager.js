import { base44 } from '@/api/base44Client';
import { canonicalRewardSelection } from '@/lib/rewardSelection';

export async function selectActiveReward(reward, userEmail, { validateOnly = false } = {}) {
  if (!reward?.id || !userEmail) throw new Error('Please sign in and choose an available reward.');
  const response = await base44.functions.invoke('claimReward', {
    email: userEmail,
    reward_id: reward.id,
    reward_title: reward.title,
    reward_type: reward.reward_type,
    validate_only: validateOnly,
  });
  if (validateOnly && (response?.data?.validated_only !== true || response?.data?.writes_performed !== false)) {
    throw new Error('Reward validation is being updated. Please try again shortly.');
  }
  return canonicalRewardSelection(response?.data, reward);
}

/**
 * Validates if an active reward is still valid based on backend state.
 * Returns the validated reward if valid, or null if invalid/expired.
 */
export async function validateActiveReward(reward, userEmail) {
  if (!reward || !userEmail) return null;

  try {
    // Read-only authoritative catalog/balance check, not a localStorage promise.
    return await selectActiveReward(reward, userEmail, { validateOnly: true });
  } catch (err) {
    console.warn('Reward validation failed:', err.message);
    // On error, err on the side of caution and return null
    return null;
  }
}

/**
 * Clears an invalid active reward from localStorage.
 */
export function clearInvalidReward(userEmail) {
  if (userEmail) {
    localStorage.removeItem(`activeReward_${userEmail}`);
  }
}

/**
 * Gets the current active reward from localStorage if it exists,
 * but does NOT validate it. Use validateActiveReward() first.
 */
export function getStoredActiveReward(userEmail) {
  if (!userEmail) return null;
  try {
    const stored = localStorage.getItem(`activeReward_${userEmail}`);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

/**
 * Clears all stale rewards for a user when they log out.
 */
export function clearAllRewardsOnLogout(userEmail) {
  if (userEmail) {
    localStorage.removeItem(`activeReward_${userEmail}`);
  }
}
