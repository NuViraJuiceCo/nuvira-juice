import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Send, Plus, Bell, Users, CheckCircle2, AlertCircle, Loader2, FlaskConical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { motion } from 'framer-motion';

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
  const [showConfirm, setShowConfirm] = useState(false);
  const [sending, setSending] = useState(false);
  const [pendingCampaignId, setPendingCampaignId] = useState(null);

  const setField = (key, val) => setForm(p => ({ ...p, [key]: val }));

  const { data: campaigns = [], isLoading } = useQuery({
    queryKey: ['notification-campaigns'],
    queryFn: () => base44.entities.NotificationCampaign.list('-created_date', 30),
    enabled: user?.role === 'admin',
  });

  const handleCreateAndSend = async () => {
    if (!form.title || !form.message) {
      toast.error('Title and message are required.');
      return;
    }
    setSending(true);
    try {
      // Step 1: Create campaign record
      const campaign = await base44.entities.NotificationCampaign.create({
        title: form.title,
        message: form.message,
        audience: form.audience,
        notification_type: form.notification_type,
        deep_link: form.deep_link || null,
        status: 'draft',
        created_by: user?.email,
      });

      if (form.audience !== 'test_only') {
        // Non-test: show confirmation dialog first
        setPendingCampaignId(campaign.id);
        setShowConfirm(true);
        setSending(false);
        return;
      }

      // Test-only: send immediately
      const res = await base44.functions.invoke('sendNotificationCampaign', {
        campaign_id: campaign.id,
        confirm: true,
      });
      toast.success(`Test notification sent to ${user?.email}`);
      queryClient.invalidateQueries({ queryKey: ['notification-campaigns'] });
      setForm({ title: '', message: '', audience: 'test_only', notification_type: 'promotion', deep_link: '' });
    } catch (err) {
      toast.error(`Failed: ${err.message}`);
    } finally {
      setSending(false);
    }
  };

  const handleConfirmedSend = async () => {
    if (!pendingCampaignId) return;
    setSending(true);
    setShowConfirm(false);
    try {
      const res = await base44.functions.invoke('sendNotificationCampaign', {
        campaign_id: pendingCampaignId,
        confirm: true,
      });
      const d = res.data;
      toast.success(`Campaign sent! ${d.sent_count} notifications delivered.`);
      queryClient.invalidateQueries({ queryKey: ['notification-campaigns'] });
      setPendingCampaignId(null);
      setForm({ title: '', message: '', audience: 'test_only', notification_type: 'promotion', deep_link: '' });
    } catch (err) {
      toast.error(`Send failed: ${err.message}`);
    } finally {
      setSending(false);
    }
  };

  if (user?.role !== 'admin') {
    return <div className="p-8 text-center text-muted-foreground">Admin access required.</div>;
  }

  return (
    <div className="pb-20">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border/40" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
        <button onClick={() => navigate(-1)} className="w-9 h-9 bg-secondary rounded-full flex items-center justify-center">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="font-heading text-lg font-bold">Notification Campaigns</h1>
          <p className="text-xs text-muted-foreground">Send in-app notifications to customers</p>
        </div>
      </div>

      <div className="px-4 mt-5">
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
              disabled={sending || !form.title || !form.message}
              className="w-full h-11 rounded-xl font-semibold gap-2"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : form.audience === 'test_only' ? <FlaskConical className="w-4 h-4" /> : <Send className="w-4 h-4" />}
              {sending ? 'Sending...' : form.audience === 'test_only' ? 'Send Test to Me' : 'Review & Send'}
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

      {/* Confirmation Modal */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm p-4">
          <motion.div initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="bg-card rounded-3xl p-6 w-full max-w-sm shadow-2xl">
            <h3 className="font-heading text-lg font-bold mb-2">Confirm Broadcast</h3>
            <p className="text-sm text-muted-foreground mb-4">
              You're about to send <strong>"{form.title}"</strong> to <strong>{AUDIENCE_LABELS[form.audience]}</strong>. This cannot be undone.
            </p>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setShowConfirm(false)} className="flex-1 rounded-xl">Cancel</Button>
              <Button onClick={handleConfirmedSend} disabled={sending} className="flex-1 rounded-xl gap-2">
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Send Now
              </Button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}