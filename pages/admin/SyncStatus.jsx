import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { AlertCircle, CheckCircle, Clock, RotateCcw, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

export default function SyncStatus() {
  const { user } = useAuth();
  const [recoveryInProgress, setRecoveryInProgress] = useState(null);

  // Run stuck order detection (must be called before conditional)
  const { data: syncStatus, isLoading, refetch } = useQuery({
    queryKey: ['sync-status'],
    queryFn: async () => {
      const res = await base44.functions.invoke('detectStuckOrders', {});
      return res.data;
    },
    refetchInterval: 5 * 60 * 1000, // Refresh every 5 minutes
    staleTime: 2 * 60 * 1000, // Data stale after 2 minutes
  });

  // Redirect if not admin
  if (user?.role !== 'admin') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Admin access required</p>
      </div>
    );
  }

  const handleRecovery = async (orderNumber) => {
    setRecoveryInProgress(orderNumber);
    try {
      const res = await base44.functions.invoke('recoverStuckOrder', { order_number: orderNumber });
      if (res.data.success) {
        toast.success(`✅ Order ${orderNumber} synced to Hub. It should appear in Production Planning within 2-5 seconds.`);
        refetch();
      } else {
        toast.error(`❌ Recovery failed. Escalate to Hub team with order: ${orderNumber}`);
      }
    } catch (err) {
      toast.error(`Recovery error: ${err.message}`);
    } finally {
      setRecoveryInProgress(null);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen p-6 bg-background">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-2 text-primary" />
              <p className="text-muted-foreground">Checking sync status...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-6 bg-background">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="font-heading text-3xl font-bold mb-2">Order Sync Status</h1>
          <p className="text-muted-foreground">Monitor paid orders syncing to Hub</p>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-green-50 border border-green-200 rounded-xl p-4">
            <div className="flex items-center gap-3">
              <CheckCircle className="w-6 h-6 text-green-600" />
              <div>
                <p className="text-sm text-green-700 font-semibold">Normal</p>
                <p className="text-2xl font-bold text-green-900">{syncStatus?.results.normal_count || 0}</p>
              </div>
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <div className="flex items-center gap-3">
              <Clock className="w-6 h-6 text-amber-600" />
              <div>
                <p className="text-sm text-amber-700 font-semibold">Delayed (5+ min)</p>
                <p className="text-2xl font-bold text-amber-900">{syncStatus?.results.delayed_count || 0}</p>
              </div>
            </div>
          </div>

          <div className="bg-red-50 border border-red-200 rounded-xl p-4">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-6 h-6 text-red-600" />
              <div>
                <p className="text-sm text-red-700 font-semibold">Stuck (10+ min)</p>
                <p className="text-2xl font-bold text-red-900">{syncStatus?.results.stuck_count || 0}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Status Message */}
        <div className={`rounded-xl p-4 ${
          syncStatus?.results.stuck_count > 0 ? 'bg-red-50 border border-red-200' :
          syncStatus?.results.delayed_count > 0 ? 'bg-amber-50 border border-amber-200' :
          'bg-green-50 border border-green-200'
        }`}>
          <p className="text-sm font-semibold mb-1">
            {syncStatus?.message}
          </p>
          <p className="text-xs text-muted-foreground">
            Last check: {new Date(syncStatus?.checked_at).toLocaleTimeString()}
          </p>
        </div>

        {/* Refresh Button */}
        <div className="flex justify-end">
          <Button
            onClick={() => refetch()}
            variant="outline"
            className="gap-2"
            disabled={isLoading}
          >
            <RefreshCw className="w-4 h-4" />
            Refresh Now
          </Button>
        </div>

        {/* Delayed Orders Table */}
        {syncStatus?.delayed_orders?.length > 0 && (
          <div>
            <h2 className="font-semibold text-lg mb-3 text-amber-900">⚠️ Delayed Orders</h2>
            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-amber-50 border-b border-border">
                  <tr>
                    <th className="px-4 py-2 text-left font-semibold">Order #</th>
                    <th className="px-4 py-2 text-left font-semibold">Customer</th>
                    <th className="px-4 py-2 text-left font-semibold">Total</th>
                    <th className="px-4 py-2 text-left font-semibold">Delivery Date</th>
                    <th className="px-4 py-2 text-left font-semibold">Age (min)</th>
                    <th className="px-4 py-2 text-left font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {syncStatus.delayed_orders.map((order) => (
                    <tr key={order.order_number} className="border-b border-border hover:bg-muted/50">
                      <td className="px-4 py-3 font-mono font-semibold">{order.order_number}</td>
                      <td className="px-4 py-3">
                        <div className="text-xs">{order.customer_name}</div>
                        <div className="text-xs text-muted-foreground">{order.customer_email}</div>
                      </td>
                      <td className="px-4 py-3">${order.total.toFixed(2)}</td>
                      <td className="px-4 py-3 text-xs">{order.delivery_date}</td>
                      <td className="px-4 py-3 font-semibold">{order.age_minutes}</td>
                      <td className="px-4 py-3">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRecovery(order.order_number)}
                          disabled={recoveryInProgress === order.order_number}
                          className="text-xs gap-1"
                        >
                          <RotateCcw className="w-3 h-3" />
                          {recoveryInProgress === order.order_number ? 'Syncing...' : 'Sync Now'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Stuck Orders Table */}
        {syncStatus?.stuck_orders?.length > 0 && (
          <div>
            <h2 className="font-semibold text-lg mb-3 text-red-900">🚨 Stuck Orders (Requires Action)</h2>
            <div className="bg-card rounded-xl border border-red-300 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-red-50 border-b border-red-300">
                  <tr>
                    <th className="px-4 py-2 text-left font-semibold">Order #</th>
                    <th className="px-4 py-2 text-left font-semibold">Customer</th>
                    <th className="px-4 py-2 text-left font-semibold">Total</th>
                    <th className="px-4 py-2 text-left font-semibold">Delivery Date</th>
                    <th className="px-4 py-2 text-left font-semibold">Age (min)</th>
                    <th className="px-4 py-2 text-left font-semibold">Stripe Session</th>
                    <th className="px-4 py-2 text-left font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {syncStatus.stuck_orders.map((order) => (
                    <tr key={order.order_number} className="border-b border-red-300 bg-red-50/50 hover:bg-red-50">
                      <td className="px-4 py-3 font-mono font-bold text-red-700">{order.order_number}</td>
                      <td className="px-4 py-3">
                        <div className="text-xs font-semibold">{order.customer_name}</div>
                        <div className="text-xs text-muted-foreground">{order.customer_email}</div>
                      </td>
                      <td className="px-4 py-3 font-semibold">${order.total.toFixed(2)}</td>
                      <td className="px-4 py-3 text-xs font-mono">{order.delivery_date}</td>
                      <td className="px-4 py-3 font-bold text-red-700">{order.age_minutes}</td>
                      <td className="px-4 py-3 text-xs font-mono truncate" title={order.stripe_session_id}>
                        {order.stripe_session_id?.substring(0, 15)}...
                      </td>
                      <td className="px-4 py-3">
                        <Button
                          size="sm"
                          onClick={() => handleRecovery(order.order_number)}
                          disabled={recoveryInProgress === order.order_number}
                          className="gap-1"
                        >
                          <RotateCcw className="w-3 h-3" />
                          {recoveryInProgress === order.order_number ? 'Syncing...' : 'Recover'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Info Box */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <h3 className="font-semibold text-blue-900 mb-2">How This Works</h3>
          <ul className="text-sm text-blue-800 space-y-1">
            <li>✅ <strong>Normal</strong>: Order synced to Hub or within 2-minute creation window</li>
            <li>⚠️ <strong>Delayed</strong>: Order 5+ minutes old but not yet in Hub (monitoring)</li>
            <li>🚨 <strong>Stuck</strong>: Order 10+ minutes old and not in Hub (action required)</li>
            <li>Click "Sync Now" or "Recover" to manually retry; order will sync via approved Hub path</li>
          </ul>
        </div>
      </div>
    </div>
  );
}