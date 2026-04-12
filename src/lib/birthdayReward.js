import { isWithinInterval, addDays, parseISO, setYear } from 'date-fns';

export const BIRTHDAY_REWARD_PRODUCT_ID = '__birthday_reward__';

/**
 * Returns true if today is within 30 days after the user's birthday (any year).
 */
export function isBirthdayRewardActive(birthday) {
  if (!birthday) return false;
  try {
    const today = new Date();
    const bday = parseISO(birthday);
    // Set birthday to current year
    const thisYearBday = setYear(bday, today.getFullYear());
    const windowEnd = addDays(thisYearBday, 30);

    // Check current year window
    if (isWithinInterval(today, { start: thisYearBday, end: windowEnd })) return true;

    // Also check previous year's window (handles Jan birthdays rolling into new year)
    const lastYearBday = setYear(bday, today.getFullYear() - 1);
    const lastYearWindowEnd = addDays(lastYearBday, 30);
    if (isWithinInterval(today, { start: lastYearBday, end: lastYearWindowEnd })) return true;

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