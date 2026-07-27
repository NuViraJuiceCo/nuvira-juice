import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { resolveCustomerIdentities } from '@/lib/identityResolver';
import { toast } from 'sonner';
import { Bell, BellOff } from 'lucide-react';

const PREFS = [
  { key: 'order_updates',        label: 'Order Updates',         desc: 'Order confirmation and status changes' },
  { key: 'delivery_updates',     label: 'Delivery Updates',      desc: 'Out for delivery and delivered' },
  { key: 'subscription_updates', label: 'Subscription Updates',  desc: 'Renewals, payments, and billing alerts' },
  { key: 'production_reminders', label: 'Production Reminders',  desc: 'When your juices are being prepared' },
  { key: 'promotions',           label: 'Promotions',            desc: 'New drops, offers, events, announcements' },
  { key: 'rewards_credits',      label: 'Rewards & Credits',     desc: 'Points earned, credits applied' },
];

export default function NotificationPreferencesPanel() {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState({
    order_updates: true, delivery_updates: true, subscription_updates: true,
    production_reminders: true, promotions: true, rewards_credits: true,
  });
  const [prefId, setPrefId] = useState(null);
  const [prefOwnerEmail, setPrefOwnerEmail] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user?.email) return;
    resolveCustomerIdentities(user).then(async (identities) => {
      for (const email of identities) {
        const res = await base44.entities.NotificationPreference.filter({ customer_email: email });
        if (res[0]) {
          const rec = res[0];
          setPrefId(rec.id);
          setPrefOwnerEmail(rec.customer_email || email);
          setPrefs({
            order_updates:        rec.order_updates        ?? true,
            delivery_updates:     rec.delivery_updates     ?? true,
            subscription_updates: rec.subscription_updates ?? true,
            production_reminders: rec.production_reminders ?? true,
            promotions:           rec.promotions           ?? true,
            rewards_credits:      rec.rewards_credits      ?? true,
          });
          return;
        }
      }
    });
  }, [user?.email]);

  const toggle = (key) => setPrefs(p => ({ ...p, [key]: !p[key] }));

  const handleSave = async () => {
    if (!user?.email) return;
    setSaving(true);
    try {
      const canonicalEmail = String(user.email).trim().toLowerCase();
      let targetPrefId = prefOwnerEmail === canonicalEmail ? prefId : null;

      if (!targetPrefId) {
        const ownPrefs = await base44.entities.NotificationPreference.filter({ customer_email: canonicalEmail });
        targetPrefId = ownPrefs[0]?.id || null;
      }

      if (targetPrefId) {
        await base44.entities.NotificationPreference.update(targetPrefId, prefs);
        setPrefId(targetPrefId);
      } else {
        const created = await base44.entities.NotificationPreference.create({
          customer_email: canonicalEmail,
          ...prefs,
        });
        setPrefId(created.id);
      }
      setPrefOwnerEmail(canonicalEmail);
      toast.success('Notification preferences saved.');
    } catch (err) {
      console.error('[NotificationPreferencesPanel] Save failed:', err);
      toast.error('Failed to save preferences.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Notification Preferences</h2>
      <p className="text-xs text-muted-foreground mb-4">
        Order, delivery, and subscription alerts are always on to keep you informed. Toggle promotions and other updates to your preference.
      </p>
      <div className="space-y-2 mb-4">
        {PREFS.map(({ key, label, desc }) => {
          const enabled = prefs[key];
          const isOperational = ['order_updates', 'delivery_updates', 'subscription_updates'].includes(key);
          return (
            <div key={key} className="flex items-center justify-between gap-3 py-3 border-b border-border/30 last:border-0">
              <div className="flex items-start gap-2.5 flex-1 min-w-0">
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${enabled ? 'nuvira-icon-badge' : 'bg-secondary'}`}>
                  {enabled ? <Bell className="w-3.5 h-3.5" /> : <BellOff className="w-3.5 h-3.5 text-muted-foreground" />}
                </div>
                <div>
                  <p className="text-sm font-medium">{label}</p>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                </div>
              </div>
              <button
                onClick={() => !isOperational && toggle(key)}
                className={`w-12 h-6 rounded-full transition-all relative shrink-0 ${
                  isOperational ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                } ${enabled ? 'bg-nuvira-gradient' : 'bg-secondary border border-border'}`}
                title={isOperational ? 'Required for order & delivery alerts' : undefined}
              >
                <div className={`w-4 h-4 rounded-full bg-white shadow-sm absolute top-1 transition-all ${enabled ? 'left-7' : 'left-1'}`} />
              </button>
            </div>
          );
        })}
      </div>
      <button
        onClick={handleSave}
        disabled={saving}
        className="nuvira-gradient-button w-full h-11 rounded-xl font-semibold text-sm active:opacity-90 transition-opacity disabled:opacity-60"
      >
        {saving ? 'Saving...' : 'Save Preferences'}
      </button>
    </div>
  );
}
