/**
 * Generate subscription orders based on plan type
 * Weekly Fresh: 1 delivery of 3 bottles (1 AURA, 1 RE-NU, 1 OASIS)
 * Monthly Ritual: 4 weekly deliveries of 3 bottles each (1 of each flavor per delivery)
 * VIP Wellness: 4 weekly deliveries of 6 bottles each (2 of each flavor per delivery)
 */

export function getSubscriptionComposition(planName) {
  const compositions = {
    'Weekly Fresh': {
      deliveries_per_cycle: 1,
      bottles_per_delivery: [
        { flavor: 'AURA', quantity: 1 },
        { flavor: 'RE-NU', quantity: 1 },
        { flavor: 'OASIS', quantity: 1 },
      ],
    },
    'Monthly Ritual': {
      deliveries_per_cycle: 4,
      bottles_per_delivery: [
        { flavor: 'AURA', quantity: 1 },
        { flavor: 'RE-NU', quantity: 1 },
        { flavor: 'OASIS', quantity: 1 },
      ],
    },
    'VIP Wellness': {
      deliveries_per_cycle: 4,
      bottles_per_delivery: [
        { flavor: 'AURA', quantity: 2 },
        { flavor: 'RE-NU', quantity: 2 },
        { flavor: 'OASIS', quantity: 2 },
      ],
    },
  };

  return compositions[planName] || compositions['Weekly Fresh'];
}

/**
 * Get delivery dates for a subscription based on plan frequency
 * Monthly plans: deliveries at beginning of each week (Mon-Fri)
 */
export function getSubscriptionDeliveryDates(planName, startDate = new Date()) {
  const composition = getSubscriptionComposition(planName);
  const deliveries = [];

  let current = new Date(startDate);

  for (let i = 0; i < composition.deliveries_per_cycle; i++) {
    // Ensure delivery is on a weekday (Mon-Fri), shift to next Monday if needed
    while (current.getDay() === 0 || current.getDay() === 6) {
      current.setDate(current.getDate() + 1);
    }
    deliveries.push(new Date(current));
    current.setDate(current.getDate() + 7); // Add 7 days for next delivery
  }

  return deliveries;
}