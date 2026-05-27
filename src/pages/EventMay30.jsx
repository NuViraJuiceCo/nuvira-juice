import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bell, CheckCircle2, Gift, Send, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import SEO from '@/components/SEO';
import {
  getEventPushPermission,
  getEventPushSupportStatus,
  getExistingEventPushSubscription,
  subscribeToEventPushNotifications,
} from '@/lib/eventPushNotifications';

const EVENT_KEY = 'may30_event_visit';
const EVENT_IDEMPOTENCY_PREFIX = 'event_visit_bonus_may30_';
const EVENT_NOTIFICATION_TITLE = 'Welcome To NuVira';
const EVENT_NOTIFICATION_BODY = 'Your 250 point event visit bonus has been added.';

function entryMatchesEventBonus(entry) {
  const eventKey = String(entry?.event_key || '').trim();
  const idempotencyKey = String(entry?.idempotency_key || '').trim();
  const description = String(entry?.description || '').toLowerCase();
  return eventKey === EVENT_KEY ||
    idempotencyKey.startsWith(EVENT_IDEMPOTENCY_PREFIX) ||
    description.includes(EVENT_KEY) ||
    description.includes('may 30 event visit bonus');
}

function notificationMatchesEventBonus(notification) {
  const idempotencyKey = String(notification?.idempotency_key || '').trim();
  return idempotencyKey.startsWith(EVENT_IDEMPOTENCY_PREFIX) ||
    (notification?.title === EVENT_NOTIFICATION_TITLE && notification?.message === EVENT_NOTIFICATION_BODY);
}

function ResultPanel({ result }) {
  if (!result) return null;

  if (result.skipped && result.already_claimed) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-green-800">
        <div className="flex items-center gap-2 font-semibold text-sm">
          <CheckCircle2 className="w-4 h-4" />
          Event bonus already claimed
        </div>
        <p className="text-xs mt-1">Your May 30 visit bonus is already on your rewards account.</p>
      </div>
    );
  }

  if (result.skipped) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-800">
        <p className="font-semibold text-sm">Event bonus is not active yet.</p>
        <p className="text-xs mt-1">Check with the NuVira team at the event if this continues.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-green-800">
      <div className="flex items-center gap-2 font-semibold text-sm">
        <CheckCircle2 className="w-4 h-4" />
        250 points added
      </div>
      <p className="text-xs mt-1">
        Your event visit bonus has been added. You will also see it in your notifications.
      </p>
    </div>
  );
}

export default function EventMay30() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [result, setResult] = useState(null);
  const [pushStatus, setPushStatus] = useState({
    loading: true,
    supported: false,
    reason: null,
    permission: 'unsupported',
    subscribed: false,
  });
  const [pushTestResult, setPushTestResult] = useState(null);

  const { data: existingClaim, isLoading: isLoadingClaimStatus } = useQuery({
    queryKey: ['may30-event-claim-status', user?.email],
    enabled: !!user?.email,
    staleTime: 0,
    queryFn: async () => {
      const [pointRows, notifications] = await Promise.all([
        base44.entities.UserPoints.filter({ customer_email: user.email }, '-created_date', 20),
        base44.entities.Notification.filter({ customer_email: user.email }, '-created_date', 20).catch(() => []),
      ]);
      const claimedByPoints = pointRows.some((row) =>
        Array.isArray(row.points_history) && row.points_history.some(entryMatchesEventBonus)
      );
      const claimedByNotification = notifications.some(notificationMatchesEventBonus);
      return { claimed: claimedByPoints || claimedByNotification };
    },
  });

  const hasClaimed = Boolean(result && (!result.skipped || result.already_claimed)) || Boolean(existingClaim?.claimed);

  useEffect(() => {
    if (existingClaim?.claimed && !result) {
      setResult({
        success: true,
        skipped: true,
        already_claimed: true,
        reason: 'existing_event_bonus_detected',
        points_awarded: 0,
        event_key: EVENT_KEY,
        notification_created: false,
        push_attempted: false,
        push_sent: false,
        push_skipped_reason: 'duplicate_redemption',
      });
    }
  }, [existingClaim?.claimed, result]);

  useEffect(() => {
    let mounted = true;

    async function loadPushStatus() {
      const support = getEventPushSupportStatus();
      const permission = await getEventPushPermission();
      const existing = support.supported ? await getExistingEventPushSubscription().catch(() => null) : null;

      if (!mounted) return;
      setPushStatus({
        loading: false,
        supported: support.supported,
        reason: support.reason,
        permission,
        subscribed: Boolean(existing),
      });
    }

    loadPushStatus();
    return () => {
      mounted = false;
    };
  }, []);

  const redeem = useMutation({
    mutationFn: async () => {
      const response = await base44.functions.invoke('redeemMay30EventBonus', {
        event_key: EVENT_KEY,
      });
      const data = response?.data || response || {};
      console.info('[EventMay30] redeemMay30EventBonus response', {
        success: data.success,
        skipped: data.skipped,
        already_claimed: data.already_claimed,
        points_awarded: data.points_awarded,
        reason: data.reason || null,
      });
      if (data.error) throw new Error(data.message || data.error);
      return data;
    },
    onSuccess: async (data) => {
      setResult(data);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['account-dashboard', user?.email] }),
        queryClient.invalidateQueries({ queryKey: ['notifications', user?.email] }),
        queryClient.invalidateQueries({ queryKey: ['unread-notifications'] }),
        queryClient.invalidateQueries({ queryKey: ['may30-event-claim-status', user?.email] }),
      ]);
      if (data.already_claimed) {
        toast.info('Event bonus already claimed.');
      } else if (data.skipped) {
        toast.info('Event bonus is not active yet.');
      } else {
        toast.success('250 points added.');
      }
    },
    onError: () => {
      toast.error('Unable to redeem event bonus.');
    },
  });

  const enablePush = useMutation({
    mutationFn: subscribeToEventPushNotifications,
    onSuccess: async (data) => {
      setPushTestResult(null);
      setPushStatus(current => ({
        ...current,
        loading: false,
        supported: data.success ? true : current.supported,
        permission: data.status || current.permission,
        subscribed: data.success,
        reason: data.reason || null,
      }));
      if (data.success) {
        toast.success('Event push enabled.');
      } else {
        toast.info('Push is not available on this device/browser.');
      }
    },
    onError: () => {
      toast.error('Unable to enable push on this device.');
    },
  });

  const testPush = useMutation({
    mutationFn: async () => {
      const response = await base44.functions.invoke('sendMay30PushTest', {});
      const data = response?.data || response || {};
      console.info('[EventMay30] sendMay30PushTest response', {
        success: data.success,
        push_attempted: data.push_attempted,
        push_sent: data.push_sent,
        push_skipped_reason: data.push_skipped_reason || null,
        token_count: data.token_count || 0,
      });
      if (data.error) throw new Error(data.message || data.error);
      return data;
    },
    onSuccess: (data) => {
      setPushTestResult(data);
      if (data.push_sent) {
        toast.success('Test push sent.');
      } else {
        toast.info(`Push test skipped: ${data.push_skipped_reason || 'not sent'}.`);
      }
    },
    onError: () => {
      toast.error('Unable to send test push.');
    },
  });

  return (
    <div className="min-h-screen bg-background">
      <SEO title="May 30 Event Bonus" description="Claim your NuVira May 30 event visit rewards bonus." />

      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border/40 flex items-center gap-3 px-4 py-3">
        <Link to="/events">
          <button className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-muted transition-colors" aria-label="Back to events">
            <ArrowLeft className="w-4 h-4" />
          </button>
        </Link>
        <span className="font-heading text-base font-semibold">May 30 Event</span>
      </div>

      <main className="px-4 py-6 space-y-5 max-w-xl mx-auto">
        <section className="rounded-2xl border border-border/50 bg-card overflow-hidden">
          <div className="bg-primary px-5 py-6 text-primary-foreground">
            <div className="w-11 h-11 rounded-2xl bg-white/15 flex items-center justify-center mb-4">
              <Sparkles className="w-5 h-5" />
            </div>
            <p className="text-xs font-semibold uppercase tracking-wider text-primary-foreground/75">Event check-in</p>
            <h1 className="font-heading text-3xl font-bold mt-1">Welcome To NuVira</h1>
            <p className="text-sm text-primary-foreground/80 mt-2 leading-relaxed">
              Check in at the May 30 event and add your one-time 250 point visit bonus.
            </p>
          </div>

          <div className="p-5 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-secondary/50 p-3">
                <Gift className="w-4 h-4 text-primary mb-2" />
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Bonus</p>
                <p className="text-xl font-bold">250 pts</p>
              </div>
              <div className="rounded-xl bg-secondary/50 p-3">
                <Bell className="w-4 h-4 text-primary mb-2" />
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Notice</p>
                <p className="text-sm font-semibold">In app</p>
              </div>
            </div>

            <div className="rounded-xl border border-border/50 bg-secondary/30 p-3 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold">Event push</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {pushStatus.loading
                      ? 'Checking this device...'
                      : pushStatus.subscribed
                        ? 'This device is ready for event push.'
                        : pushStatus.supported
                          ? 'Enable push before claiming if you want the event alert on this device.'
                          : 'This device cannot receive event push here.'}
                  </p>
                </div>
                {pushStatus.subscribed && (
                  <span className="text-[10px] font-semibold rounded-full bg-green-100 px-2 py-0.5 text-green-700">Ready</span>
                )}
              </div>
              {!pushStatus.loading && !pushStatus.subscribed && (
                <button
                  type="button"
                  onClick={() => enablePush.mutate()}
                  disabled={!pushStatus.supported || enablePush.isPending}
                  className="h-9 rounded-lg border border-primary/30 px-3 text-xs font-semibold text-primary disabled:opacity-50"
                >
                  {enablePush.isPending ? 'Enabling...' : 'Enable Event Push'}
                </button>
              )}
              {!pushStatus.loading && pushStatus.subscribed && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => enablePush.mutate()}
                    disabled={enablePush.isPending}
                    className="inline-flex h-9 items-center gap-2 rounded-lg border border-primary/30 px-3 text-xs font-semibold text-primary disabled:opacity-50"
                  >
                    <Bell className="h-3.5 w-3.5" />
                    {enablePush.isPending ? 'Refreshing...' : 'Refresh Push'}
                  </button>
                  <button
                    type="button"
                    onClick={() => testPush.mutate()}
                    disabled={testPush.isPending}
                    className="inline-flex h-9 items-center gap-2 rounded-lg border border-primary/30 px-3 text-xs font-semibold text-primary disabled:opacity-50"
                  >
                    <Send className="h-3.5 w-3.5" />
                    {testPush.isPending ? 'Sending...' : 'Send Test Push'}
                  </button>
                </div>
              )}
              {pushTestResult && (
                <p className="text-[10px] text-muted-foreground">
                  {pushTestResult.push_sent
                    ? 'Test push was handed to Firebase for this device.'
                    : `Test push skipped: ${pushTestResult.push_skipped_reason || 'not sent'}.`}
                </p>
              )}
              {!pushStatus.loading && !pushStatus.supported && (
                <p className="text-[10px] text-muted-foreground">
                  On iPhone, use the NuVira app shell or an installed Home Screen app.
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={() => redeem.mutate()}
              disabled={redeem.isPending || isLoadingClaimStatus || hasClaimed}
              className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-semibold text-sm active:scale-[0.99] transition-transform disabled:opacity-60"
            >
              {redeem.isPending
                ? 'Adding points...'
                : isLoadingClaimStatus
                  ? 'Checking bonus...'
                  : hasClaimed
                    ? 'Bonus Claimed'
                    : 'Claim Event Bonus'}
            </button>

            <ResultPanel result={result} />

            <div className="flex justify-center gap-4 pt-1">
              <Link to="/rewards" className="text-xs font-semibold text-primary underline underline-offset-4">View rewards</Link>
              <Link to="/notifications" className="text-xs font-semibold text-primary underline underline-offset-4">View notifications</Link>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
