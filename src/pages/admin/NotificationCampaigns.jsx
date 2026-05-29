import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Send, Plus, Bell, BellOff, Users, CheckCircle2, AlertCircle, Loader2, FlaskConical, Smartphone, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { motion } from 'framer-motion';
import AdminOpsHeader from '@/components/admin/AdminOpsHeader';
import {
  getEventPushPermission,
  getEventPushSupportStatus,
  getExistingEventPushSubscription,
  subscribeToEventPushNotifications,
  unsubscribeFromEventPushNotifications,
} from '@/lib/eventPushNotifications';

const AUDIENCE_LABELS = {
  test_only: 'Test Only (admin)',
  all_customers: 'All Customers',
  active_subscribers: 'Active Subscribers',
  one_time_customers: 'One-Time Customers',
  lapsed_customers: 'Lapsed Customers (30+ days)',
};

const TYPE_LABELS = {
  promotion: 'Promotion',
  new_drop: 'New Drop',
  order_update: 'Order Update',
  general: 'General Announcement',
};

const DEEP_LINK_OPTIONS = [
  { label: 'None', value: '' },
  { label: 'Shop', value: '/shop' },
  { label: 'Rewards', value: '/rewards' },
  { label: 'My Subscriptions', value: '/account/subscriptions' },
  { label: 'My Orders', value: '/account/orders' },
  { label: 'Account', value: '/account' },
  { label: 'Subscribe', value: '/subscribe' },
];

const CAMPAIGN_SENDS_ENABLED = false;

async function readAdminPushDiagnostics() {
  try {
    const response = await base44.functions.invoke('getAdminPushDiagnostics', {});
    return response?.data || response || null;
  } catch (err) {
    return {
      success: false,
      ready: false,
      blocked_reasons: ['diagnostics_unavailable'],
      error: err.message,
    };
  }
}

async function readAdminPushStatus() {
  const support = getEventPushSupportStatus();
  const diagnostics = await readAdminPushDiagnostics();
  if (!support.supported) {
    return {
      loading: false,
      supported: false,
      subscribed: false,
      permission: 'unsupported',
      mode: support.mode || null,
      reason: support.reason || 'push_unavailable',
      action: null,
      diagnostics,
    };
  }

  const [permission, subscription] = await Promise.all([
    getEventPushPermission().catch(() => 'default'),
    getExistingEventPushSubscription().catch(() => null),
  ]);

  return {
    loading: false,
    supported: true,
    subscribed: Boolean(subscription),
    permission,
    mode: support.mode || null,
    reason: null,
    action: null,
    diagnostics,
  };
}

function adminPushStatusLabel(status) {
  if (status.loading) return 'Checking';
  if (!status.supported) return 'Unavailable';
  if (status.permission === 'denied') return 'Blocked';
  if (status.subscribed) return 'Enabled';
  return 'Ready';
}

function formatStatusReason(reason) {
  return String(reason || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export default function NotificationCampaigns() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    title: '',
    message: '',
    audience: 'test_only',
    notification_type: 'promotion',
    deep_link: '',
  });
  const [adminPushStatus, setAdminPushStatus] = useState({
    loading: true,
    supported: false,
    subscribed: false,
    permission: 'default',
    mode: null,
    reason: null,
    action: null,
    diagnostics: null,
  });
  const [adminPushTestResult, setAdminPushTestResult] = useState(null);

  const setField = (key, val) => setForm(p => ({ ...p, [key]: val }));

  const refreshAdminPushStatus = async () => {
    setAdminPushStatus(prev => ({ ...prev, loading: true, action: null }));
    const nextStatus = await readAdminPushStatus();
    setAdminPushStatus(nextStatus);
    return nextStatus;
  };

  useEffect(() => {
    if (user?.role !== 'admin') return;

    let active = true;
    setAdminPushStatus(prev => ({ ...prev, loading: true }));
    readAdminPushStatus()
      .then((nextStatus) => {
        if (active) setAdminPushStatus(nextStatus);
      })
      .catch(() => {
        if (active) {
          setAdminPushStatus({
            loading: false,
            supported: false,
            subscribed: false,
            permission: 'unsupported',
            mode: null,
            reason: 'status_check_failed',
            action: null,
          });
        }
      });

    return () => {
      active = false;
    };
  }, [user?.role]);

  const { data: campaigns = [], isLoading } = useQuery({
    queryKey: ['notification-campaigns'],
    queryFn: () => base44.entities.NotificationCampaign.list('-created_date', 30),
    enabled: user?.role === 'admin',
  });

  const handleEnableAdminPush = async () => {
    setAdminPushStatus(prev => ({ ...prev, action: 'enable' }));
    try {
      const result = await subscribeToEventPushNotifications();
      await refreshAdminPushStatus();

      if (result.success) {
        toast.success('Admin order push enabled on this device.');
      } else {
        toast.error(`Unable to enable admin push: ${result.reason || result.status || 'not available'}.`);
      }
    } catch (err) {
      await refreshAdminPushStatus();
      toast.error(`Unable to enable admin push: ${err.message}`);
    }
  };

  const handleDisableAdminPush = async () => {
    setAdminPushStatus(prev => ({ ...prev, action: 'disable' }));
    try {
      await unsubscribeFromEventPushNotifications();
      await refreshAdminPushStatus();
      toast.success('Admin order push disabled on this device.');
    } catch (err) {
      await refreshAdminPushStatus();
      toast.error(`Unable to disable admin push: ${err.message}`);
    }
  };

  const handleSendAdminPushTest = async () => {
    setAdminPushStatus(prev => ({ ...prev, action: 'test' }));
    setAdminPushTestResult(null);
    try {
      const res = await base44.functions.invoke('sendAdminPushTestNotification', {
        client_request_id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      });
      const data = res?.data || res || {};
      setAdminPushTestResult(data);
      await refreshAdminPushStatus();

      if (data.push_sent) {
        toast.success('Admin push test sent.');
      } else {
        toast.info(`Push test skipped: ${data.push_skipped_reason || data.reason || 'not sent'}.`);
      }
    } catch (err) {
      await refreshAdminPushStatus();
      setAdminPushTestResult({
        success: false,
        push_sent: false,
        push_skipped_reason: 'admin_push_test_error',
      });
      toast.error(`Unable to send admin push test: ${err.message}`);
    }
  };

  const handleCreateAndSend = async () => {
    toast.error('Notification campaign creation and customer sends are disabled during the May 30 launch freeze.');
  };

  if (user?.role !== 'admin') {
    return <div className="p-8 text-center text-muted-foreground">Admin access required.</div>;
  }

  return (
    <div className="pb-20">
      <AdminOpsHeader
        title="Notification Campaigns"
        subtitle="Customer campaign sends frozen for launch"
        badge="Frozen"
        badgeTone="warning"
        onBack={() => navigate(-1)}
        actions={<Bell className="h-4 w-4 text-muted-foreground" />}
      />

      <div className="px-4 mt-5">
        <div className="bg-card border border-border/50 rounded-2xl p-4 mb-6">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <Smartphone className="w-5 h-5" />
              </div>
              <div>
                <h2 className="font-semibold text-sm">Admin Order Alerts</h2>
                <p className="text-xs text-muted-foreground mt-1">
                  Enables paid-order push alerts for this admin device. Customer campaign sends stay frozen.
                </p>
              </div>
            </div>
            <span className={`text-[10px] font-bold px-2 py-1 rounded-full shrink-0 ${
              adminPushStatus.subscribed
                ? 'bg-primary/10 text-primary'
                : adminPushStatus.permission === 'denied'
                  ? 'bg-red-100 text-red-700'
                  : 'bg-secondary text-muted-foreground'
            }`}>
              {adminPushStatusLabel(adminPushStatus)}
            </span>
          </div>

          {!adminPushStatus.loading && adminPushStatus.reason && (
            <p className="text-xs text-muted-foreground mt-3">
              {formatStatusReason(adminPushStatus.reason)}
            </p>
          )}

          {adminPushStatus.diagnostics && (
            <div className="grid grid-cols-3 gap-2 mt-4">
              <div className="rounded-xl border border-border/50 bg-secondary/30 px-3 py-2">
                <p className="text-[10px] text-muted-foreground">Saved</p>
                <p className="text-sm font-semibold">{adminPushStatus.diagnostics.active_subscription_count || 0}</p>
              </div>
              <div className="rounded-xl border border-border/50 bg-secondary/30 px-3 py-2">
                <p className="text-[10px] text-muted-foreground">Transport</p>
                <p className="text-sm font-semibold truncate">
                  {adminPushStatus.diagnostics.active_token_types?.length
                    ? adminPushStatus.diagnostics.active_token_types.join(', ')
                    : 'None'}
                </p>
              </div>
              <div className="rounded-xl border border-border/50 bg-secondary/30 px-3 py-2">
                <p className="text-[10px] text-muted-foreground">Backend</p>
                <p className={`text-sm font-semibold ${adminPushStatus.diagnostics.ready ? 'text-primary' : 'text-amber-700'}`}>
                  {adminPushStatus.diagnostics.ready ? 'Ready' : 'Check'}
                </p>
              </div>
            </div>
          )}

          {adminPushStatus.diagnostics?.blocked_reasons?.length > 0 && (
            <p className="text-xs text-muted-foreground mt-3">
              {adminPushStatus.diagnostics.blocked_reasons.map(formatStatusReason).join(' + ')}
            </p>
          )}

          {adminPushTestResult && (
            <div className={`mt-4 rounded-xl border px-3 py-2 ${
              adminPushTestResult.push_sent
                ? 'border-primary/20 bg-primary/5'
                : 'border-amber-200 bg-amber-50'
            }`}>
              <p className={`text-xs font-semibold ${adminPushTestResult.push_sent ? 'text-primary' : 'text-amber-900'}`}>
                {adminPushTestResult.push_sent ? 'Test sent' : 'Test skipped'}
              </p>
              <p className="text-[11px] text-muted-foreground mt-1">
                {adminPushTestResult.push_sent
                  ? `${adminPushTestResult.push_sent_count || 1} sent from ${adminPushTestResult.push_token_count || 0} saved token(s).`
                  : formatStatusReason(adminPushTestResult.push_skipped_reason || adminPushTestResult.reason || 'not_sent')}
              </p>
            </div>
          )}

          <div className="flex gap-2 mt-4">
            {adminPushStatus.subscribed ? (
              <Button
                type="button"
                variant="outline"
                onClick={handleDisableAdminPush}
                disabled={adminPushStatus.action === 'disable'}
                className="flex-1 h-10 rounded-xl gap-2"
              >
                {adminPushStatus.action === 'disable' ? <Loader2 className="w-4 h-4 animate-spin" /> : <BellOff className="w-4 h-4" />}
                Disable
              </Button>
            ) : (
              <Button
                type="button"
                onClick={handleEnableAdminPush}
                disabled={!adminPushStatus.supported || adminPushStatus.permission === 'denied' || adminPushStatus.action === 'enable'}
                className="flex-1 h-10 rounded-xl gap-2"
              >
                {adminPushStatus.action === 'enable' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4" />}
                Enable
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={handleSendAdminPushTest}
              disabled={adminPushStatus.action === 'test' || (
                !adminPushStatus.subscribed
                && (adminPushStatus.diagnostics?.active_subscription_count || 0) === 0
              )}
              className="flex-1 h-10 rounded-xl gap-2"
            >
              {adminPushStatus.action === 'test' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Test
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={refreshAdminPushStatus}
              disabled={adminPushStatus.loading || Boolean(adminPushStatus.action)}
              className="w-10 h-10 rounded-xl p-0"
              aria-label="Refresh admin push status"
              title="Refresh admin push status"
            >
              {adminPushStatus.loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCw className="w-4 h-4" />}
            </Button>
          </div>
        </div>

        {!CAMPAIGN_SENDS_ENABLED && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-6 flex items-start gap-3">
            <AlertCircle className="w-4 h-4 text-amber-700 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-amber-900">Campaign sending disabled</p>
              <p className="text-xs text-amber-800 mt-1">
                Notification campaign creation and sends are frozen for May 30 launch operations unless explicitly re-enabled.
              </p>
            </div>
          </div>
        )}

        {/* Compose Card */}
        <div className="bg-card border border-border/50 rounded-2xl p-4 mb-6">
          <h2 className="font-semibold text-sm mb-4 flex items-center gap-2">
            <Plus className="w-4 h-4 text-primary" /> New Campaign
          </h2>
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground">Title *</Label>
              <Input value={form.title} onChange={e => setField('title', e.target.value)} placeholder="e.g. Fresh Summer Drop 🌿" className="rounded-xl h-10 mt-1" maxLength={60} />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Message *</Label>
              <textarea
                value={form.message}
                onChange={e => setField('message', e.target.value)}
                placeholder="e.g. New seasonal flavors just dropped. Grab yours before they're gone."
                className="w-full mt-1 rounded-xl border border-input bg-background px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                rows={3}
                maxLength={200}
              />
              <p className="text-[10px] text-muted-foreground text-right">{form.message.length}/200</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground">Audience</Label>
                <select
                  value={form.audience}
                  onChange={e => setField('audience', e.target.value)}
                  className="w-full mt-1 h-10 rounded-xl border border-input bg-background px-3 text-sm"
                >
                  {Object.entries(AUDIENCE_LABELS).map(([val, label]) => (
                    <option key={val} value={val}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Type</Label>
                <select
                  value={form.notification_type}
                  onChange={e => setField('notification_type', e.target.value)}
                  className="w-full mt-1 h-10 rounded-xl border border-input bg-background px-3 text-sm"
                >
                  {Object.entries(TYPE_LABELS).map(([val, label]) => (
                    <option key={val} value={val}>{label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Deep Link (opens when tapped)</Label>
              <select
                value={form.deep_link}
                onChange={e => setField('deep_link', e.target.value)}
                className="w-full mt-1 h-10 rounded-xl border border-input bg-background px-3 text-sm"
              >
                {DEEP_LINK_OPTIONS.map(({ label, value }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>

            {form.audience !== 'test_only' && (
              <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-xl p-3">
                <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                <p className="text-xs text-amber-700">
                  <strong>Broad send:</strong> This will notify all customers in the "{AUDIENCE_LABELS[form.audience]}" segment. You'll see a confirmation before it sends.
                </p>
              </div>
            )}

            <Button
              onClick={handleCreateAndSend}
              disabled={!CAMPAIGN_SENDS_ENABLED}
              className="w-full h-11 rounded-xl font-semibold gap-2"
            >
              {form.audience === 'test_only' ? <FlaskConical className="w-4 h-4" /> : <Send className="w-4 h-4" />}
              Campaign Sends Frozen
            </Button>
          </div>
        </div>

        {/* Campaign History */}
        <h2 className="font-semibold text-sm mb-3 flex items-center gap-2">
          <Bell className="w-4 h-4 text-primary" /> Campaign History
        </h2>
        {isLoading ? (
          <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-16 bg-secondary/50 rounded-xl animate-pulse" />)}</div>
        ) : campaigns.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No campaigns yet.</p>
        ) : (
          <div className="space-y-2">
            {campaigns.map((c, i) => (
              <motion.div key={c.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                className="bg-card border border-border/50 rounded-xl p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{c.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{c.message}</p>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-1 rounded-full shrink-0 ${
                    c.status === 'sent' ? 'bg-primary/10 text-primary' : 'bg-secondary text-muted-foreground'
                  }`}>{c.status}</span>
                </div>
                <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1"><Users className="w-3 h-3" />{AUDIENCE_LABELS[c.audience] || c.audience}</span>
                  {c.sent_count > 0 && <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-primary" />{c.sent_count} sent</span>}
                  {c.sent_at && <span>{format(new Date(c.sent_at), 'MMM d, h:mm a')}</span>}
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
