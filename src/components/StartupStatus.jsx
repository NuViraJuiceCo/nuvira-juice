import React from 'react';
import { BRAND_IMAGES } from '@/lib/brandImages';

export default function StartupStatus({ phase = 'page' }) {
  const message = phase === 'auth'
    ? 'Confirming your sign-in...'
    : phase === 'profile' ? 'Loading your account...' : 'Opening NuVira...';
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-background px-6" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-5 text-center">
        <img src={BRAND_IMAGES.wordmark} alt="NuVira Juice Company" className="h-16 w-44 object-contain" />
        <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-primary/20 border-t-primary motion-reduce:animate-none" aria-hidden="true" />
        <p className="text-sm font-medium text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}
