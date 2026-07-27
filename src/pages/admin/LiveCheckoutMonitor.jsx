import React, { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { isAdminUser } from '@/lib/admin-access';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CheckCircle, XCircle, Clock, RefreshCw } from 'lucide-react';
import AdminOpsHeader from '@/components/admin/AdminOpsHeader';

function StatusBadge({ value }) {
  if (!value) return <span className="text-xs text-muted-foreground">—</span>;
  const isPass = value.startsWith('PASS');
  const isFail = value.startsWith('FAIL');
  const isPending = value.startsWith('PENDING') || value.startsWith('Manual');
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
      isPass ? 'bg-green-100 text-green-800' :
      isFail ? 'bg-red-100 text-red-800' :
      'bg-cyan-100 text-cyan-800'
    }`}>
      {isPass ? <CheckCircle className="w-3 h-3" /> : isFail ? <XCircle className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
      {value}
    </span>
  );
}

function Row({ label, value, mono }) {
  if (value === null || value === undefined) return null;
  return (
    <div className="flex justify-between items-start gap-4 py-2 border-b border-border/40 last:border-0">
      <span className="text-xs text-muted-foreground shrink-0 w-48">{label}</span>
      <span className={`text-xs text-right break-all ${mono ? 'font-mono' : ''}`}>
        {typeof value === 'boolean' ? (value ? '✅ true' : '❌ false') :
         typeof value === 'object' ? JSON.stringify(value, null, 2) :
         String(value)}
      </span>
    </div>
  );
}

export default function LiveCheckoutMonitor() {
  const { user } = useAuth();
  const [orderNumber, setOrderNumber] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const autoRefreshRef = useRef(null);

  const runCheck = async (num) => {
    const target = num || orderNumber;
    if (!target.trim()) return;
    setLoading(true);
    try {
      const res = await base44.functions.invoke('monitorLiveCheckoutTest', { order_number: target.trim() });
      setResult(res.data);
    } catch (err) {
      setResult({ error: err.message });
    } finally {
      setLoading(false);
    }
  };

  const toggleAutoRefresh = () => {
    if (autoRefresh) {
      clearInterval(autoRefreshRef.current);
      setAutoRefresh(false);
    } else {
      setAutoRefresh(true);
      autoRefreshRef.current = setInterval(() => runCheck(orderNumber), 10000);
    }
  };

  useEffect(() => () => clearInterval(autoRefreshRef.current), []);

  if (!isAdminUser(user)) {
    return <div className="p-8 text-muted-foreground">Admin access required</div>;
  }

  const c = result?.checks;
  const verdict = result?.verdict;

  return (
    <div className="min-h-screen bg-background pb-[calc(7rem+env(safe-area-inset-bottom))] md:pb-10">
      <AdminOpsHeader
        title="Live Checkout Monitor"
        subtitle="Read-only. No repairs or manual sync during test window."
        badge="Read-only"
      />
      <div className="max-w-3xl mx-auto p-6 space-y-6">
        {/* Input */}
        <div className="flex gap-2">
          <Input
            value={orderNumber}
            onChange={e => setOrderNumber(e.target.value.toUpperCase())}
            placeholder="e.g. NV-MONL4I2M"
            className="rounded-xl font-mono"
            onKeyDown={e => e.key === 'Enter' && runCheck()}
          />
          <Button onClick={() => runCheck()} disabled={loading || !orderNumber.trim()} className="rounded-xl gap-2 shrink-0">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Checking…' : 'Check'}
          </Button>
          <Button
            variant={autoRefresh ? 'destructive' : 'outline'}
            onClick={toggleAutoRefresh}
            disabled={!orderNumber.trim()}
            className="rounded-xl shrink-0 text-xs"
          >
            {autoRefresh ? 'Stop Auto' : 'Auto (10s)'}
          </Button>
        </div>

        {result?.error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
            Error: {result.error}
          </div>
        )}

        {verdict && (
          <div className={`rounded-xl p-4 border ${verdict.result === 'PASS' ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
            <div className="flex items-center gap-2 mb-1">
              {verdict.result === 'PASS'
                ? <CheckCircle className="w-5 h-5 text-green-600" />
                : <XCircle className="w-5 h-5 text-red-600" />}
              <span className={`font-bold ${verdict.result === 'PASS' ? 'text-green-900' : 'text-red-900'}`}>
                {verdict.result} — {verdict.message}
              </span>
            </div>
            {verdict.failures?.map((f, i) => (
              <p key={i} className="text-xs text-red-700 ml-7">• {f}</p>
            ))}
            <p className="text-xs text-muted-foreground mt-2">Captured at: {result.captured_at}</p>
          </div>
        )}

        {c && (
          <div className="space-y-4">
            {/* Timeline */}
            <Section title="📋 Timeline">
              <Row label="CheckoutSession stored at" value={c.stripe_session_stored_at} />
              <Row label="Order created at" value={c.order_created_time} />
              <Row label="Last sync attempt" value={c.sync_logs?.[c.sync_logs.length - 1]?.created_at} />
              <Row label="Monitor captured at" value={result.captured_at} />
            </Section>

            {/* Verdict checks */}
            <Section title="✅ Pass/Fail Checks">
              <CheckRow label="Order in Customer App" value={c.payment_status_check} raw={c.order_exists_in_customer_app} />
              <CheckRow label="Payment captured" value={c.payment_status_check} raw={c.payment_captured} />
              <CheckRow label="Address complete" value={c.address_check} raw={c.address_complete} />
              <CheckRow label="Stripe IDs real" value={c.stripe_id_check} raw={!c.fake_ids_detected} />
              <CheckRow label="No duplicates" value={c.duplicate_check} raw={c.order_count_for_number === 1} />
              <CheckRow label="Source sync" value={c.hub_sync_check} raw={c.last_sync_status === 'success'} />
            </Section>

            {/* Order fields */}
            <Section title="📦 Order Details">
              <Row label="order_number" value={c.order_number} mono />
              <Row label="customer_name" value={c.customer_name} />
              <Row label="customer_email" value={c.customer_email} mono />
              <Row label="status" value={c.status} />
              <Row label="payment_captured" value={c.payment_captured} />
              <Row label="subtotal" value={c.subtotal != null ? `$${c.subtotal}` : null} />
              <Row label="delivery_fee" value={c.delivery_fee != null ? `$${c.delivery_fee}` : null} />
              <Row label="total" value={c.total != null ? `$${c.total}` : null} />
              <Row label="fulfillment_type" value={c.fulfillment_type} />
              <Row label="estimated_delivery_date" value={c.estimated_delivery_date} />
              <Row label="is_preorder" value={c.is_preorder} />
            </Section>

            {/* Address */}
            <Section title="📍 Address Fields">
              <Row label="address_line1" value={c.address_fields?.address_line1} mono />
              <Row label="address_city" value={c.address_fields?.address_city} />
              <Row label="address_state" value={c.address_fields?.address_state} />
              <Row label="address_postal_code" value={c.address_fields?.address_postal_code} mono />
            </Section>

            {/* Stripe IDs */}
            <Section title="💳 Stripe IDs">
              <Row label="stripe_checkout_session_id" value={c.checkout_session_id} mono />
              <Row label="stripe_payment_intent_id" value={c.payment_intent_id} mono />
              <Row label="fake_ids_detected" value={c.fake_ids_detected} />
            </Section>

            {/* Items */}
            <Section title="🛒 Line Items">
              {c.items?.length === 0
                ? <p className="text-xs text-muted-foreground">No items</p>
                : c.items?.map((item, i) => (
                  <div key={i} className="text-xs py-1 border-b border-border/30 last:border-0 flex justify-between">
                    <span>{item.quantity}x {item.title}</span>
                    <span className="font-mono">${item.price}</span>
                  </div>
                ))}
            </Section>

            {/* Source sync logs */}
            <Section title="🔄 OrderSyncLog (all attempts)">
              {c.sync_logs?.length === 0
                ? <p className="text-xs text-cyan-700 font-semibold">⚠️ No sync attempts logged yet</p>
                : c.sync_logs?.map((log, i) => (
                  <div key={i} className={`text-xs p-2 rounded-lg mb-2 ${log.status === 'success' ? 'bg-green-50' : log.status === 'error' ? 'bg-red-50' : 'bg-cyan-50'}`}>
                    <div className="flex justify-between mb-1">
                      <span className="font-semibold uppercase">{log.status}</span>
                      <span className="text-muted-foreground">{log.created_at} · {log.triggered_by}</span>
                    </div>
                    <p className="text-muted-foreground break-words">{log.description}</p>
                  </div>
                ))}
            </Section>

            {/* Email orders (merge check) */}
            <Section title="👤 Same-Email Orders (merge check)">
              <p className="text-xs text-muted-foreground mb-2">
                Total orders for {c.customer_email}: {c.total_orders_for_email}
              </p>
              {c.email_orders?.map((o, i) => (
                <div key={i} className="text-xs py-1 border-b border-border/30 last:border-0 flex justify-between">
                  <span className="font-mono">{o.order_number}</span>
                  <span>${o.total} · {new Date(o.created_date).toLocaleString()}</span>
                </div>
              ))}
            </Section>
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <h3 className="text-sm font-semibold mb-3">{title}</h3>
      {children}
    </div>
  );
}

function CheckRow({ label, value, raw }) {
  return (
    <div className="flex justify-between items-center py-2 border-b border-border/40 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <StatusBadge value={value} />
    </div>
  );
}
