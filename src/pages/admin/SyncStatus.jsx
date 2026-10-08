import React from 'react';
import { Link } from 'react-router-dom';
import AdminOpsHeader from '@/components/admin/AdminOpsHeader';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { isAdminUser } from '@/lib/admin-access';
import { Button } from '@/components/ui/button';

export default function SyncStatus() {
  const { user } = useAuth();

  if (!isAdminUser(user)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Admin access required</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-[calc(7rem+env(safe-area-inset-bottom))] md:pb-10">
      <AdminOpsHeader
        title="Order Sync Status"
        subtitle="Current read-only sync guidance"
        badge="Read-only"
      />

      <div className="px-4 mt-5 max-w-3xl mx-auto space-y-4">
        <section className="rounded-xl border border-cyan-200 bg-cyan-50 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-cyan-700 mt-0.5 shrink-0" />
            <div>
              <h2 className="text-sm font-bold text-cyan-900 dark:text-cyan-100">Legacy recovery actions stay controlled</h2>
              <p className="text-xs text-cyan-800 mt-1 leading-relaxed dark:text-cyan-200">
                Stuck-order recovery can write sync logs and retry source sync. Recovery remains locked here. Review the affected order first; an exact paid-order recovery needs explicit approval.
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-border/50 bg-card p-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-primary mt-0.5 shrink-0" />
            <div>
              <h2 className="text-sm font-bold text-foreground">Review current source records</h2>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                Shopify shows source orders and alerts. The review queue lists operational exceptions. Neither link starts synchronization or recovery.
              </p>
              <Button asChild className="mt-4 rounded-xl">
                <Link to="/admin/shopify">Review Shopify records</Link>
              </Button>
              <Button asChild variant="outline" className="mt-4 ml-2"><Link to="/admin/review-queue">Review exceptions</Link></Button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
