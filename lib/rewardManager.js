import { base44 } from '@/api/base44Client';

/**
 * Validates if an active reward is still valid based on backend state.
 * Returns the validated reward if valid, or null if invalid/expired.
 */
export async function validateActiveReward(reward, userEmail) {
  if (!reward || !userEmail) return null;

  try {
    // Fetch user's loyalty/points data to verify reward eligibility
    const response = await base44.functions.invoke('getCustomerAccountDashboardData', {});
    const dashData = response.data || {};
    const pointsData = dashData.points_record || null;
    const totalPoints = pointsData?.total_points || 0;

    // Verify the reward type is still applicable and user has enough points
    if (reward.points_required && totalPoints < reward.points_required) {
      return null; // User no longer has enough points
    }

    // Check if this is a free delivery reward tied to a subscription
    if (reward.reward_type === 'free_delivery') {
      const subs = await base44.entities.Subscription.filter(
        { customer_email: userEmail, status: 'active' },
        'created_date',
        1
      );
      // If reward was subscription-based and subscription is now canceled, invalidate
      if (!subs || subs.length === 0) {
        return null;
      }
    }

    // Reward is still valid
    return reward;
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