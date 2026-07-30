import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Trash2 } from 'lucide-react';
import SEO from '@/components/SEO';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/AuthContext';

export default function DeleteAccount() {
  const { user, navigateToLogin } = useAuth();

  return (
    <div className="min-h-screen bg-background px-4 pb-10" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
      <SEO
        title="Delete Your Account"
        description="Delete your NuVira Juice Co. app account and understand which records may be retained for legal, tax, payment, fulfillment, and food-safety compliance."
        canonicalPath="/delete-account"
        noindex
      />

      <div className="mx-auto max-w-2xl">
        <Link to="/account/settings" className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <ArrowLeft className="h-4 w-4" />
          Account Settings
        </Link>

        <div className="rounded-3xl border border-border bg-card p-5 shadow-sm md:p-8">
          <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
            <Trash2 className="h-5 w-5" />
          </div>
          <h1 className="font-heading text-3xl font-bold text-foreground md:text-4xl">Delete your NuVira account</h1>
          <p className="mt-3 text-sm leading-7 text-muted-foreground md:text-base">
            You can delete your NuVira app account from inside the app or website. Sign in, open Account Settings,
            choose Delete My Account, then type DELETE to confirm.
          </p>

          <div className="mt-6 grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-border bg-background/70 p-4">
              <h2 className="text-sm font-bold text-foreground">Deleted app data</h2>
              <p className="mt-2 text-xs leading-6 text-muted-foreground">
                Profile details, notification preferences, saved push tokens, loyalty profile, reward points, and in-app notifications.
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-background/70 p-4">
              <h2 className="text-sm font-bold text-foreground">Records that may be retained</h2>
              <p className="mt-2 text-xs leading-6 text-muted-foreground">
                Order, payment, refund, tax, fulfillment, delivery, sync, audit, and food-safety records where NuVira must retain them.
              </p>
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            {user?.email ? (
              <Button asChild className="h-11 rounded-xl font-semibold">
                <Link to="/account/settings">Open Account Settings</Link>
              </Button>
            ) : (
              <Button
                type="button"
                className="h-11 rounded-xl font-semibold"
                onClick={() => navigateToLogin('/account/settings')}
              >
                Sign In to Delete Account
              </Button>
            )}
            <Button asChild variant="outline" className="h-11 rounded-xl font-semibold">
              <Link to="/contact">Contact Support</Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
