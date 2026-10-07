import { orderMinimumStatus } from './orderMinimums.js';
import { PROGRAM_BY_KEY, programOptionForDays } from './program-catalog.js';

export function deliveryContinuation({ items = [], pathname = '/', programSelection } = {}) {
  if (pathname === '/cart') {
    return orderMinimumStatus(items).meetsMinimum
      ? { to: '/checkout', label: 'Continue to Checkout' }
      : { to: '/cart', label: 'Continue Building My Order' };
  }
  const program = PROGRAM_BY_KEY[programSelection?.key];
  if (program) {
    const option = programOptionForDays(program, programSelection.days);
    return { to: `/program/${program.key}?days=${option.days}`, label: `Continue with ${program.name}` };
  }
  return items.length
    ? { to: '/cart', label: 'Continue My Order' }
    : { to: '/shop', label: 'Start My Order' };
}
