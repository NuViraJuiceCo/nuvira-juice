import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { onboardingQueryOptions } from '@/lib/onboardingQuery';

export function usePublicInquiryStartup() {
  const { user, isLoadingAuth, isLoadingPublicSettings } = useAuth();
  // Observe the App's existing principal-scoped check; never start another read.
  const profile = useQuery({
    ...onboardingQueryOptions(user?.email),
    enabled: false,
  });
  const checkingSession = isLoadingAuth || isLoadingPublicSettings;
  const checkingProfile = Boolean(user?.email && !profile.data?.onboarding_complete);
  const disabled = checkingSession || checkingProfile;
  // Keep drafts impossible until the startup epoch change and any onboarding
  // redirect have settled. A failed unconfirmed profile can later retry, so it
  // is not safe to enable a draft merely because that read has stopped loading.
  const message = checkingSession
    ? 'Checking your session before enabling the form...'
    : checkingProfile && profile.isError
      ? 'Please reload to finish checking your account before sending a message.'
      : checkingProfile ? 'Checking your account setup before enabling the form...' : '';
  return { disabled, message };
}
