import { QueryClient } from '@tanstack/react-query';

export function responseStatus(error) {
	return Number(error?.response?.status || error?.status || error?.data?.status || 0);
}

export function retryRead(failureCount, error) {
	const status = responseStatus(error);
	if (status >= 400 && status < 500) return false;
	return failureCount < 2;
}

export function createQueryClient() {
	return new QueryClient({
		defaultOptions: {
			queries: {
				// Global defaults — prevent aggressive refetching on route navigation
				staleTime: 2 * 60 * 1000,      // 2 min: cached data is fresh, no background refetch on nav
				gcTime: 10 * 60 * 1000,         // 10 min: keep cache in memory across route changes
				refetchOnWindowFocus: false,     // never refetch just because user switches tabs
				refetchOnMount: 'always',        // always refresh when an observer mounts
				// Read models occasionally cross a short-lived provider or bridge boundary.
				// Retry only network/5xx failures; never repeat authorization or validation failures.
				retry: retryRead,
				retryDelay: attemptIndex => Math.min(500 * (2 ** attemptIndex), 2000),
			},
		},
	});
}
