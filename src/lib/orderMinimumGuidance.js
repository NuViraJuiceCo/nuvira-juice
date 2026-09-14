import { orderMinimumStatus } from './orderMinimums.js';

// Presentation follows the checkout rule, including earned items and bundles.
export function orderMinimumGuidance(items) {
  const cart = Array.isArray(items) ? items : [];
  const status = orderMinimumStatus(cart);
  const visible = !cart.length || cart.some(item => ['juice', 'shot', 'bundle'].includes(item?.category));
  const valid = orderMinimumStatus([...cart, { category: 'juice', quantity: 3 }]).meetsMinimum;
  if (!valid) return { ...status, visible: true, canBuild: false, title: status.error, progress: 0 };

  const juices = Math.ceil(status.remainingUnits);
  const shots = Math.ceil(status.remainingUnits * 2);
  const juiceText = `${juices} more ${juices === 1 ? 'juice' : 'juices'}`;
  const shotText = `${shots} more ${shots === 1 ? 'shot' : 'shots'}`;
  const shotsOnly = cart.some(item => item.category === 'shot')
    && !cart.some(item => ['juice', 'bundle'].includes(item.category));
  return {
    ...status,
    visible,
    canBuild: !status.meetsMinimum,
    title: status.meetsMinimum ? 'Order count minimum met'
      : !cart.length ? 'Build your first mix'
        : `Choose ${shotsOnly || juices === 1 && shots === 1 ? shotText : juiceText}`,
    alternative: status.meetsMinimum || !cart.length ? null
      : `Or add ${shotsOnly || juices === 1 && shots === 1 ? juiceText : shotText}. Mix and match any flavors.`,
    progress: Math.min(100, Math.max(0, status.units / 3 * 100)),
  };
}
