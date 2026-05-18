import { isWithinInterval, addDays, parseISO, setYear } from 'date-fns';

export const BIRTHDAY_REWARD_PRODUCT_ID = '__birthday_reward__';

/**
 * Returns true if today is within 30 days after the user's birthday,
 * BUT only for birthdays that occur AFTER the user's signup date.
 * This prevents users from claiming the reward immediately after setting their birthday.
 */
export function isBirthdayRewardActive(birthday, signupDate) {
  if (!birthday) return false;
  try {
    const today = new Date();
    const bday = parseISO(birthday);
    const signup = signupDate ? new Date(signupDate) : null;

    // Check a given year's birthday window
    const isWindowActive = (yearBday) => {
      // Skip if this birthday occurred on or before signup (first eligible birthday must be after signup)
      if (signup && yearBday <= signup) return false;
      const windowEnd = addDays(yearBday, 30);
      return isWithinInterval(today, { start: yearBday, end: windowEnd });
    };

    // Check current year window
    const thisYearBday = setYear(bday, today.getFullYear());
    if (isWindowActive(thisYearBday)) return true;

    // Also check previous year's window (handles Jan birthdays rolling into new year)
    const lastYearBday = setYear(bday, today.getFullYear() - 1);
    if (isWindowActive(lastYearBday)) return true;

    return false;
  } catch {
    return false;
  }
}

/**
 * Hook-like helper to manage birthday reward in cart.
 */
export function useBirthdayReward(items, addItem, removeItem) {
  const rewardInCart = items.some(i => i.product_id === BIRTHDAY_REWARD_PRODUCT_ID);

  const addBirthdayReward = () => {
    addItem(
      {
        id: BIRTHDAY_REWARD_PRODUCT_ID,
        title: '🎂 Birthday Juice (Free)',
        price: 0,
        category: 'juice',
        size: '12oz',
        image_url: null,
        is_available: true,
      },
      1,
      { isBirthdayReward: true }
    );
  };

  const removeBirthdayReward = () => {
    removeItem(BIRTHDAY_REWARD_PRODUCT_ID);
  };

  return { rewardInCart, addBirthdayReward, removeBirthdayReward };
}