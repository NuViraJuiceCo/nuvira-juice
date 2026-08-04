import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { isAdminUser } from '@/lib/admin-access';
import { useNavigate } from 'react-router-dom';
import { Send, Plus, Bell, BellOff, Users, CheckCircle2, AlertCircle, Loader2, FlaskConical, Smartphone, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { motion } from 'framer-motion';
import AdminOpsHeader from '@/components/admin/AdminOpsHeader';
import { unwrapBase44Result } from '@/lib/base44-result';
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

const UiButton = /** @type {any} */ (Button);
const UiInput = /** @type {any} */ (Input);
const UiLabel = /** @type {any} */ (Label);

function unwrapBase44Data(response, fallback = null) {
  return unwrapBase44Result(response, fallback);
}

async function readAdminPushDiagnostics() {
  try {
    const response = await base44.functions.invoke('getAdminPushDiagnostics', {});
    return unwrapBase44Data(response, null);
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
  const queryClient = useQueryClient();

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
  const [campaignSendResult, setCampaignSendResult] = useState(null);
  const [isSendingCampaign, setIsSendingCampaign] = useState(false);

  const setField = (key, val) => setForm(p => ({ ...p, [key]: val }));

  const refreshAdminPushStatus = async () => {
    setAdminPushStatus(prev => ({ ...prev, loading: true, action: null }));
    const nextStatus = await readAdminPushStatus();
    setAdminPushStatus(nextStatus);
    return nextStatus;
  };

  useEffect(() => {
    if (!isAdminUser(user)) return;

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
            diagnostics: null,
          });
        }
      });

    return () => {
      active = false;
    };
  }, [user?.role]);

  const { data: campaigns = [], isLoading } = useQuery({
    queryKey: ['notification-campaigns'],
    queryFn: async () => {
      const res = await base44.functions.invoke('getAdminLaunchReadOnlySummary', {
        resource: 'notification_campaigns',
      });
      const payload = unwrapBase44Data(res, {});
      return Array.isArray(payload?.rows) ? payload.rows : [];
    },
    enabled: isAdminUser(user),
  });

  const {
    data: journeyPreview,
    isLoading: isJourneyLoading,
    refetch: refreshJourneyPreview,
  } = useQuery({
    queryKey: ['customer-journey-automation-preview'],
    queryFn: async () => unwrapBase44Data(
      await base44.functions.invoke('sendNotificationCampaign', { action: 'preview' }),
      {},
    ),
    enabled: isAdminUser(user),
    staleTime: 0,
    refetchInterval: 60000,
  });

  const {
    data: transactionalPreview,
    isLoading: isTransactionalLoading,
    refetch: refreshTransactionalPreview,
  } = useQuery({
    queryKey: ['customer-transactional-communications-preview'],
    queryFn: async () => unwrapBase44Data(
      await base44.functions.invoke('sendOrderStatusNotification', { action: 'elevated_preview' }),
      {},
    ),
    enabled: isAdminUser(user),
    staleTime: 0,
    refetchInterval: 60000,
  });

  const {
    data: rewardsEmailPreview,
    isLoading: isRewardsEmailLoading,
    refetch: refreshRewardsEmailPreview,
  } = useQuery({
    queryKey: ['rewards-email-campaign-preview'],
    queryFn: async () => unwrapBase44Data(
      await base44.functions.invoke('sendNotificationCampaign', { action: 'preview_rewards_email_campaign' }),
      {},
    ),
    enabled: isAdminUser(user),
    staleTime: 0,
  });

  const handleEnableAdminPush = async () => {
    setAdminPushStatus(prev => ({ ...prev, action: 'enable' }));
    try {
      const result = await subscribeToEventPushNotifications({
        vapidPublicKey: adminPushStatus.diagnostics?.providers?.web_push_public_key,
      });
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
      const data = unwrapBase44Data(res, {});
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
    const title = form.title.trim();
    const message = form.message.trim();
    const audienceLabel = AUDIENCE_LABELS[form.audience] || form.audience;

    if (!title || !message) {
      toast.error('Add a campaign title and message before sending.');
      return;
    }

    let maxRecipientAck = null;
    if (form.audience !== 'test_only') {
      const confirmed = window.confirm(
        `Send this campaign to ${audienceLabel}?\n\nTitle: ${title}\n\nThis will create in-app notifications and attempt push delivery for subscribed customers in this audience.`
      );
      if (!confirmed) return;

      const recipientAck = window.prompt(
        `Maximum eligible recipients you approve for this ${audienceLabel} send?\n\nIf the live eligible audience is larger than this number, the backend will stop the send.`
      );
      if (recipientAck === null) return;
      maxRecipientAck = Number(recipientAck);
      if (!Number.isInteger(maxRecipientAck) || maxRecipientAck < 1) {
        toast.error('Enter a whole-number recipient maximum before sending a broad campaign.');
        return;
      }
    }

    setIsSendingCampaign(true);
    setCampaignSendResult(null);

    try {
      const campaignResponse = await base44.entities.NotificationCampaign.create({
        title,
        message,
        audience: form.audience,
        notification_type: form.notification_type,
        deep_link: form.deep_link || null,
        status: 'draft',
        sent_count: 0,
        failed_count: 0,
        skipped_count: 0,
        recipients_total: 0,
        eligible_count: 0,
        skipped_reasons: {},
        created_by: user?.email || null,
      });
      const campaign = unwrapBase44Data(campaignResponse, {});
      const campaignId = campaign?.id;
      if (!campaignId) {
        throw new Error('Campaign was created but no campaign id was returned. Refresh campaigns and try again.');
      }

      const response = await base44.functions.invoke('sendNotificationCampaign', {
        campaign_id: campaignId,
        confirm: true,
        ...(form.audience !== 'test_only'
          ? {
              broad_send_confirmation: `send_${form.audience}_campaign`,
              max_recipient_ack: maxRecipientAck,
            }
          : {}),
      });
      const data = unwrapBase44Data(response, {});
      setCampaignSendResult(data);
      await queryClient.invalidateQueries({ queryKey: ['notification-campaigns'] });

      if (data.success) {
        const sent = Number(data.sent_count || 0);
        const pushSent = Number(data.push_sent_count || 0);
        toast.success(`${form.audience === 'test_only' ? 'Test campaign' : 'Campaign'} sent to ${sent} recipient${sent === 1 ? '' : 's'}${pushSent ? `; ${pushSent} push delivery${pushSent === 1 ? '' : 'ies'}` : ''}.`);
        setForm({
          title: '',
          message: '',
          audience: 'test_only',
          notification_type: 'promotion',
          deep_link: '',
        });
      } else {
        toast.error(data.error || data.message || 'Campaign send did not complete.');
      }
    } catch (err) {
      toast.error(`Unable to send campaign: ${err.message}`);
      setCampaignSendResult({
        success: false,
        error: err.message,
      });
    } finally {
      setIsSendingCampaign(false);
    }
  };

  if (!isAdminUser(user)) {
    return <div className="p-8 text-center text-muted-foreground">Admin access required.</div>;
  }

  return (
    <div className="pb-20">
      <AdminOpsHeader
        title="Notification Campaigns"
        subtitle="Admin alerts and customer campaign sends"
        badge="Live"
        badgeTone="success"
        onBack={() => navigate(-1)}
        actions={<Bell className="h-4 w-4 text-muted-foreground" />}
      />

      <div className="px-4 mt-5">
        <div className="bg-card border border-border/50 rounded-2xl p-4 mb-6">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <Bell className="w-5 h-5" />
              </div>
              <div>
                <h2 className="font-semibold text-sm">Customer Journey Automations</h2>
                <p className="text-xs text-muted-foreground mt-1">Website activity, cart recovery, loyalty, reorder, win-back, and review milestones.</p>
              </div>
            </div>
            <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-secondary text-muted-foreground shrink-0">
              {journeyPreview?.policy?.customer_sends_enabled ? 'Live' : 'Sends locked'}
            </span>
          </div>
          {isJourneyLoading ? (
            <div className="h-24 mt-4 rounded-xl bg-secondary/40 animate-pulse" />
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2 mt-4">
                <div className="rounded-xl border border-border/50 bg-secondary/30 px-3 py-2"><p className="text-[10px] text-muted-foreground">Tracked events</p><p className="text-sm font-semibold">{journeyPreview?.summary?.journey_events || 0}</p></div>
                <div className="rounded-xl border border-border/50 bg-secondary/30 px-3 py-2"><p className="text-[10px] text-muted-foreground">Open carts</p><p className="text-sm font-semibold">{journeyPreview?.summary?.active_or_checkout_carts || 0}</p></div>
                <div className="rounded-xl border border-border/50 bg-secondary/30 px-3 py-2"><p className="text-[10px] text-muted-foreground">Converted</p><p className="text-sm font-semibold">{journeyPreview?.summary?.converted_carts || 0}</p></div>
              </div>
              <p className="mt-3 text-[11px] text-muted-foreground">Resend: {journeyPreview?.provider?.events?.length || 0}/9 events · {journeyPreview?.provider?.templates?.length || 0}/8 templates · {journeyPreview?.provider?.automations?.length || 0}/8 automations. Guardrails: explicit consent, launch cutoff, idempotency, recipient caps, and a provider kill switch.</p>
              <UiButton type="button" variant="outline" onClick={() => refreshJourneyPreview()} className="w-full h-10 rounded-xl gap-2 mt-4"><RotateCw className="w-4 h-4" />Refresh journey status</UiButton>
            </>
          )}
        </div>

        <div className="bg-card border border-border/50 rounded-2xl p-4 mb-6">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0"><Smartphone className="w-5 h-5" /></div>
              <div><h2 className="font-semibold text-sm">Order Email + Push Experience</h2><p className="text-xs text-muted-foreground mt-1">Coordinated transactional milestones with channel deduplication and quiet hours.</p></div>
            </div>
            <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-secondary text-muted-foreground shrink-0">{transactionalPreview?.readiness?.production_sends_enabled ? 'Live' : 'Sends locked'}</span>
          </div>
          {isTransactionalLoading ? <div className="h-24 mt-4 rounded-xl bg-secondary/40 animate-pulse" /> : (
            <>
              <div className="grid grid-cols-3 gap-2 mt-4">
                <div className="rounded-xl border border-border/50 bg-secondary/30 px-3 py-2"><p className="text-[10px] text-muted-foreground">Milestones</p><p className="text-sm font-semibold">{transactionalPreview?.policy?.length || 0}</p></div>
                <div className="rounded-xl border border-border/50 bg-secondary/30 px-3 py-2"><p className="text-[10px] text-muted-foreground">Email</p><p className="text-sm font-semibold">{transactionalPreview?.readiness?.email_enabled ? 'Ready' : 'Locked'}</p></div>
                <div className="rounded-xl border border-border/50 bg-secondary/30 px-3 py-2"><p className="text-[10px] text-muted-foreground">Push</p><p className="text-sm font-semibold">{transactionalPreview?.readiness?.push_enabled ? 'Ready' : 'Locked'}</p></div>
              </div>
              <p className="mt-3 text-[11px] text-muted-foreground">Email: confirmations, receipts, exceptions, cancellations, refunds, and payment issues. Push only: scheduled for juicing and in production. Policy {transactionalPreview?.policy_version || 'not deployed'}.</p>
              {transactionalPreview?.readiness?.blockers?.length > 0 && <p className="mt-2 text-[11px] text-muted-foreground">Activation holds: {transactionalPreview.readiness.blockers.map(formatStatusReason).join(' · ')}</p>}
              <UiButton type="button" variant="outline" onClick={() => refreshTransactionalPreview()} className="w-full h-10 rounded-xl gap-2 mt-4"><RotateCw className="w-4 h-4" />Refresh order communication status</UiButton>
            </>
          )}
        </div>

        <div className="bg-card border border-border/50 rounded-2xl p-4 mb-6">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3"><div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0"><Send className="w-5 h-5" /></div><div><h2 className="font-semibold text-sm">POS Rewards Email</h2><p className="text-xs text-muted-foreground mt-1">Consent-frozen campaign with signed unsubscribe and exact audience gates.</p></div></div>
            <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-secondary text-muted-foreground shrink-0">{rewardsEmailPreview?.production_send_enabled ? 'Send armed' : 'Send locked'}</span>
          </div>
          {isRewardsEmailLoading ? <div className="h-20 mt-4 rounded-xl bg-secondary/40 animate-pulse" /> : (
            <>
              <div className="grid grid-cols-3 gap-2 mt-4">
                <div className="rounded-xl border border-border/50 bg-secondary/30 px-3 py-2"><p className="text-[10px] text-muted-foreground">Eligible</p><p className="text-sm font-semibold">{rewardsEmailPreview?.summary?.eligible_count || 0}</p></div>
                <div className="rounded-xl border border-border/50 bg-secondary/30 px-3 py-2"><p className="text-[10px] text-muted-foreground">Named</p><p className="text-sm font-semibold">{rewardsEmailPreview?.summary?.complete_name_count || 0}</p></div>
                <div className="rounded-xl border border-border/50 bg-secondary/30 px-3 py-2"><p className="text-[10px] text-muted-foreground">Draft</p><p className="text-sm font-semibold capitalize">{rewardsEmailPreview?.latest_campaign?.status || 'None'}</p></div>
              </div>
              <p className="mt-3 text-[11px] text-muted-foreground">Subject: <span className="font-semibold text-foreground">{rewardsEmailPreview?.subject || 'Your NuVira Rewards Are Ready'}</span><span className="block mt-1">Resend after-send tracking: {rewardsEmailPreview?.resend_webhook_registered ? 'ready' : 'registration pending'}. No send can occur while the production switch is locked.</span></p>
              <UiButton type="button" variant="outline" onClick={() => refreshRewardsEmailPreview()} className="w-full h-10 rounded-xl gap-2 mt-4"><RotateCw className="w-4 h-4" />Refresh email status</UiButton>
            </>
          )}
        </div>

        <div className="bg-card border border-border/50 rounded-2xl p-4 mb-6">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <Smartphone className="w-5 h-5" />
              </div>
              <div>
                <h2 className="font-semibold text-sm">Admin Order Alerts</h2>
                <p className="text-xs text-muted-foreground mt-1">
                  Enables paid-order push alerts for this admin device. Customer campaigns use the same saved push subscriptions.
                </p>
              </div>
            </div>
            <span className={`text-[10px] font-bold px-2 py-1 rounded-full shrink-0 ${
              adminPushStatus.subscribed
                ? 'bg-primary/10 text-primary'
                : adminPushStatus.permission === 'denied'
                  ? 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-200'
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
                <p className={`text-sm font-semibold ${adminPushStatus.diagnostics.ready ? 'text-primary' : 'text-cyan-700'}`}>
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
                  : 'border-cyan-200 bg-cyan-50 dark:border-cyan-900/60 dark:bg-cyan-950/30'
            }`}>
              <p className={`text-xs font-semibold ${adminPushTestResult.push_sent ? 'text-primary' : 'text-cyan-900 dark:text-cyan-100'}`}>
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
              <UiButton
                type="button"
                variant="outline"
                onClick={handleDisableAdminPush}
                disabled={adminPushStatus.action === 'disable'}
                className="flex-1 h-10 rounded-xl gap-2"
              >
                {adminPushStatus.action === 'disable' ? <Loader2 className="w-4 h-4 animate-spin" /> : <BellOff className="w-4 h-4" />}
                Disable
              </UiButton>
            ) : (
              <UiButton
                type="button"
                onClick={handleEnableAdminPush}
                disabled={!adminPushStatus.supported || adminPushStatus.permission === 'denied' || adminPushStatus.action === 'enable'}
                className="flex-1 h-10 rounded-xl gap-2"
              >
                {adminPushStatus.action === 'enable' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4" />}
                Enable
              </UiButton>
            )}
            <UiButton
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
            </UiButton>
            <UiButton
              type="button"
              variant="outline"
              onClick={refreshAdminPushStatus}
              disabled={adminPushStatus.loading || Boolean(adminPushStatus.action)}
              className="w-10 h-10 rounded-xl p-0"
              aria-label="Refresh admin push status"
              title="Refresh admin push status"
            >
              {adminPushStatus.loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCw className="w-4 h-4" />}
            </UiButton>
          </div>
        </div>

        <div className="bg-primary/5 border border-primary/20 rounded-2xl p-4 mb-6 flex items-start gap-3">
          <CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-primary">Controlled campaign tools</p>
            <p className="text-xs text-muted-foreground mt-1">
              Admin tests are available. Broader sends remain protected by consent, audience-size acknowledgement, backend locks, and customer notification preferences.
            </p>
          </div>
        </div>

        {/* Compose Card */}
        <div className="bg-card border border-border/50 rounded-2xl p-4 mb-6">
          <h2 className="font-semibold text-sm mb-4 flex items-center gap-2">
            <Plus className="w-4 h-4 text-primary" /> New Campaign
          </h2>
          <div className="space-y-3">
            <div>
              <UiLabel className="text-xs text-muted-foreground">Title *</UiLabel>
              <UiInput value={form.title} onChange={e => setField('title', e.target.value)} placeholder="e.g. Fresh Summer Drop 🌿" className="rounded-xl h-10 mt-1" maxLength={60} />
            </div>
            <div>
              <UiLabel className="text-xs text-muted-foreground">Message *</UiLabel>
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
                <UiLabel className="text-xs text-muted-foreground">Audience</UiLabel>
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
                <UiLabel className="text-xs text-muted-foreground">Type</UiLabel>
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
              <UiLabel className="text-xs text-muted-foreground">Deep Link (opens when tapped)</UiLabel>
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
              <div className="flex items-start gap-2.5 rounded-xl border border-cyan-200 bg-cyan-50 p-3 dark:border-cyan-900/60 dark:bg-cyan-950/30">
                <AlertCircle className="w-4 h-4 text-cyan-600 mt-0.5 shrink-0 dark:text-cyan-300" />
                <p className="text-xs text-cyan-700 dark:text-cyan-100">
                  <strong>Broad send:</strong> This will notify eligible customers in the "{AUDIENCE_LABELS[form.audience]}" segment who have the matching notification preference enabled. You'll see a confirmation before it sends.
                </p>
              </div>
            )}

            {campaignSendResult && (
              <div className={`rounded-xl border px-3 py-2 ${
                campaignSendResult.success
                  ? 'border-primary/20 bg-primary/5'
                  : 'border-red-200 bg-red-50 dark:border-red-900/60 dark:bg-red-950/30'
                }`}>
                <p className={`text-xs font-semibold ${campaignSendResult.success ? 'text-primary' : 'text-red-700 dark:text-red-100'}`}>
                  {campaignSendResult.success ? 'Campaign sent' : 'Campaign not sent'}
                </p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  {campaignSendResult.success
                    ? `${campaignSendResult.sent_count || 0} notification${Number(campaignSendResult.sent_count || 0) === 1 ? '' : 's'} created; ${campaignSendResult.push_sent_count || 0} push delivery${Number(campaignSendResult.push_sent_count || 0) === 1 ? '' : 'ies'} sent.`
                    : campaignSendResult.message || campaignSendResult.error || 'Send did not complete.'}
                  {Number(campaignSendResult.skipped_count || 0) > 0 && (
                    <span className="block mt-1">
                      {campaignSendResult.skipped_count} skipped; {campaignSendResult.eligible_count || 0} eligible of {campaignSendResult.recipients_total || 0} candidate recipients.
                    </span>
                  )}
                </p>
              </div>
            )}

            <UiButton
              onClick={handleCreateAndSend}
              disabled={isSendingCampaign}
              className="w-full h-11 rounded-xl font-semibold gap-2"
            >
              {isSendingCampaign ? <Loader2 className="w-4 h-4 animate-spin" /> : form.audience === 'test_only' ? <FlaskConical className="w-4 h-4" /> : <Send className="w-4 h-4" />}
              {isSendingCampaign ? 'Sending...' : form.audience === 'test_only' ? 'Send Test Campaign' : 'Send Campaign'}
            </UiButton>
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
