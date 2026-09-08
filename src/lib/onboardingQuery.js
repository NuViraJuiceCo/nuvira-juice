import { base44 } from '@/api/base44Client';

export const ONBOARDING_READ_TIMEOUT_MS = 8000;

export function onboardingQueryOptions(email) {
  return {
    queryKey: ['user-onboarding-check', email],
    queryFn: async () => {
      let timer;
      try {
        const profiles = await Promise.race([
          base44.entities.UserProfile.filter({ customer_email: email }, undefined, 1),
          new Promise((_, reject) => {
            timer = globalThis.setTimeout(() => reject(new Error('profile_read_timeout')), ONBOARDING_READ_TIMEOUT_MS);
          }),
        ]);
        return profiles[0] || null;
      } finally {
        globalThis.clearTimeout(timer);
      }
    },
    // This cache lives only inside the verified principal's query session.
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnMount: false,
    retry: false,
  };
}
