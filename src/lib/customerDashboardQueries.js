import { isCurrentAuthQueryClient } from './authQuerySession.js';

export const CUSTOMER_DASHBOARD_STALE_TIME = 30 * 1000;
const EMPTY_ROWS = [];
const TERMINAL_ORDER_STATUSES = ['delivered', 'picked_up', 'cancelled', 'refunded', 'failed'];

// All consumers cache the full, identity-resolved response. Selectors belong to
// observers, never the query function: otherwise Orders can overwrite Account's
// object with an array. The auth boundary replaces this in-memory client on any
// principal change; no account data is persisted or shared across sessions.
export function customerDashboardQueryOptions(api, user) {
  return {
    queryKey: ['account-dashboard', user?.email],
    queryFn: async () => (await api.functions.invoke('getCustomerAccountDashboardData', {})).data || {},
    enabled: !!user?.email,
    staleTime: CUSTOMER_DASHBOARD_STALE_TIME,
    gcTime: 5 * 60 * 1000,
    refetchOnMount: true,
  };
}

export const customerDashboardOrders = data => data?.all_orders_raw || EMPTY_ROWS;
export const customerDashboardSubscriptions = data => data?.all_subscriptions || EMPTY_ROWS;

// TanStack passes the RAW cache value here, not the observer's selected array.
export function customerDashboardOrderPollInterval(query) {
  return customerDashboardOrders(query.state.data)
    .some(order => !TERMINAL_ORDER_STATUSES.includes(order?.status)) ? 60000 : false;
}

// Call after relevant writes/confirmed receipts. An old session's late mutation
// must never touch the new session's cache. Checkout also marks the read stale on
// entry/exit without fetching, covering abandoned/ambiguous payment attempts.
export async function invalidateCustomerDashboard(queryClient, { refetchType = 'active' } = {}) {
  if (!isCurrentAuthQueryClient(queryClient)) return;
  // Discard any pre-mutation response still in flight. Merely marking it stale
  // lets a slow success reset isInvalidated and cache the old balance as fresh.
  await queryClient.cancelQueries({ queryKey: ['account-dashboard'] });
  if (!isCurrentAuthQueryClient(queryClient)) return;
  return queryClient.invalidateQueries({ queryKey: ['account-dashboard'], refetchType });
}
