import React from 'react';

// Route code can load without covering the website navigation. This is not an
// authentication fallback and never stands in for verified account data.
export default function PublicRouteLoading() {
  return (
    <section className="min-h-[40vh] flex items-center justify-center px-6 py-16" role="status" aria-live="polite" data-public-route-loading="true">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary/20 border-t-primary motion-reduce:animate-none" aria-hidden="true" />
        <span>Loading page content...</span>
      </div>
    </section>
  );
}
