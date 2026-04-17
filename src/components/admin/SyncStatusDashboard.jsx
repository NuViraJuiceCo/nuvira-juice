import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Activity, CheckCircle2, AlertCircle, Clock, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { motion } from 'framer-motion';
import { format } from 'date-fns';

export default function SyncStatusDashboard() {
  const { data: syncLogs = [], refetch, isLoading } = useQuery({
    queryKey: ['sync-logs'],
    queryFn: () => base44.entities.ShopifySyncLog.filter({}, '-created_date', 50),
    refetchInterval: 10000, // Auto-refresh every 10 seconds
  });

  const recentLogs = syncLogs.slice(0, 20);
  
  // Aggregate stats
  const successCount = recentLogs.filter(l => l.status === 'success').length;
  const errorCount = recentLogs.filter(l => l.status === 'error').length;
  const totalRecords = recentLogs.reduce((sum, l) => sum + (l.records_synced || 0), 0);
  const failedRecords = recentLogs.reduce((sum, l) => sum + (l.records_failed || 0), 0);

  const statusIcon = {
    success: <CheckCircle2 className="w-4 h-4 text-green-500" />,
    error: <AlertCircle className="w-4 h-4 text-red-500" />,
    partial: <Clock className="w-4 h-4 text-amber-500" />,
  };

  const statusColor = {
    success: 'bg-green-500/10 border-green-500/30 text-green-600',
    error: 'bg-red-500/10 border-red-500/30 text-red-600',
    partial: 'bg-amber-500/10 border-amber-500/30 text-amber-600',
  };

  const syncTypeLabel = {
    orders: 'Orders',
    products: 'Products',
    inventory: 'Inventory',
    manual: 'Manual',
    webhook: 'Webhook',
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold">Hub Sync Status</h2>
        </div>
        <Button
          onClick={() => refetch()}
          disabled={isLoading}
          variant="outline"
          size="sm"
          className="gap-2"
        >
          <RotateCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-3.5">
          <p className="text-xs text-muted-foreground mb-1">Successful Syncs</p>
          <p className="text-2xl font-bold text-green-600">{successCount}</p>
        </div>
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3.5">
          <p className="text-xs text-muted-foreground mb-1">Failed Syncs</p>
          <p className="text-2xl font-bold text-red-600">{errorCount}</p>
        </div>
        <div className="bg-primary/10 border border-primary/30 rounded-xl p-3.5">
          <p className="text-xs text-muted-foreground mb-1">Records Synced</p>
          <p className="text-2xl font-bold text-primary">{totalRecords}</p>
        </div>
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3.5">
          <p className="text-xs text-muted-foreground mb-1">Failed Records</p>
          <p className="text-2xl font-bold text-amber-600">{failedRecords}</p>
        </div>
      </div>

      {/* Activity Log */}
      <div className="bg-card border border-border/50 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border/40 bg-secondary/40">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Recent Activity</p>
        </div>
        <div className="divide-y divide-border/30 max-h-96 overflow-y-auto">
          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {!isLoading && recentLogs.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-6">No sync activity yet</p>
          )}
          {recentLogs.map((log) => (
            <motion.div
              key={log.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className={`px-4 py-3 flex items-center gap-3 ${statusColor[log.status]}`}
            >
              <div>{statusIcon[log.status]}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold">{syncTypeLabel[log.sync_type] || log.sync_type}</span>
                  <span className="text-[10px] text-muted-foreground">({log.triggered_by})</span>
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {log.records_synced || 0} synced · {log.records_failed || 0} failed
                  {log.error_details && (
                    <span className="block mt-1 text-[9px] opacity-80">{log.error_details}</span>
                  )}
                </p>
              </div>
              <span className="text-[10px] text-muted-foreground shrink-0">
                {log.created_date ? format(new Date(log.created_date), 'HH:mm:ss') : '—'}
              </span>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Health Status */}
      <div className="bg-card border border-border/50 rounded-xl p-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">System Health</p>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span>Hub Connectivity</span>
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${errorCount === 0 ? 'bg-green-500/20 text-green-600' : 'bg-red-500/20 text-red-600'}`}>
              {errorCount === 0 ? '✓ Healthy' : '⚠ Issues'}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span>Last Sync</span>
            <span className="text-xs text-muted-foreground">
              {recentLogs[0]?.created_date ? format(new Date(recentLogs[0].created_date), 'MMM d, HH:mm') : '—'}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span>Sync Success Rate</span>
            <span className="text-xs font-semibold text-primary">
              {recentLogs.length > 0 ? Math.round((successCount / recentLogs.length) * 100) : 0}%
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}