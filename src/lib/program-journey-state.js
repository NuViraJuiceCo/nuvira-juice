import { useQuery } from '@tanstack/react-query';
import { invokeCustomerGateway } from '@/api/base44Client';

export function useActiveProgramJourney(enabled = true) {
  const query = useQuery({
    queryKey: ['program-journeys'],
    queryFn: async () => (await invokeCustomerGateway('manageProgramJourney', { action: 'list' })).data,
    enabled: Boolean(enabled),
    staleTime: 60 * 1000,
  });
  const data = enabled && !query.isError ? query.data : undefined;
  const journeys = data?.journeys || [];
  const journey = journeys.find((row) => row.status === 'in_progress')
    || journeys.find((row) => row.status === 'ready')
    || null;

  return { ...query, data, journey, journeys };
}
