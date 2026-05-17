import { QueryClient } from '@tanstack/react-query';


export const queryClientInstance = new QueryClient({
	defaultOptions: {
		queries: {
			// Global defaults — prevent aggressive refetching on route navigation
			staleTime: 2 * 60 * 1000,      // 2 min: cached data is fresh, no background refetch on nav
			gcTime: 10 * 60 * 1000,         // 10 min: keep cache in memory across route changes
			refetchOnWindowFocus: false,     // never refetch just because user switches tabs
			refetchOnMount: 'always',        // only refetch on mount if stale (respects staleTime)
			retry: 1,
		},
	},
});