import React from 'react';
import { Link } from 'react-router-dom';
import AdminOpsHeader from '@/components/admin/AdminOpsHeader';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';

export default function SyncStatus() {
  const { user } = useAuth();

  if (user?.role !== 'admin') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Admin access required</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-10">
      <AdminOpsHeader
        title="Order Sync Status"
        subtitle="Legacy recovery tools disabled for launch freeze"
        badge="Disabled tools"
        badgeTone="warning"
      />

      <div className="px-4 mt-5 max-w-3xl mx-auto space-y-4">
        <section className="rounded-xl border border-cyan-200 bg-cyan-50 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-cyan-700 mt-0.5 shrink-0" />
            <div>
              <h2 className="text-sm font-bold text-cyan-900">Manual recovery is disabled</h2>
              <p className="text-xs text-cyan-800 mt-1 leading-relaxed">
                Stuck-order detection and recovery can write sync logs and retry Hub sync. During the May 30 launch freeze,
                use the read-only Sync Health page unless a specific paid order recovery is explicitly approved.
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-border/50 bg-card p-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-primary mt-0.5 shrink-0" />
            <div>
              <h2 className="text-sm font-bold text-foreground">Use read-only bridge visibility</h2>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                Sync Health shows sanitized Hub bridge status without sync, retry, recover, replay, repair, export, or raw-log actions.
              </p>
              <Button asChild className="mt-4 rounded-xl">
                <Link to="/admin/sync-health">Open Sync Health</Link>
              </Button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
