import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { readBirthdayEligibility } from './birthdayCheckoutEligibility';

export function useBirthdayCheckoutEligibility(user) {
  const enabled = Boolean(user?.id && user?.email);
  const query = useQuery({
    queryKey: ['birthday-checkout-eligibility', user?.id, user?.email],
    queryFn: () => readBirthdayEligibility((_name, payload) => base44.functions.invoke('createPaymentIntent', payload)),
    enabled, staleTime: 0, retry: false,
  });
  // Do not keep showing a stale "ready" claim during a recheck or account swap.
  if (!enabled) return { eligible: false, status: 'sign_in_required' };
  if (query.isFetching || query.isPending) return { eligible: false, status: 'checking' };
  return query.error ? { eligible: false, status: 'unconfirmed' } : query.data || { eligible: false, status: 'unconfirmed' };
}
