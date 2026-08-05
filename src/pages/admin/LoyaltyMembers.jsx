import React, { useMemo, useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { isAdminUser } from '@/lib/admin-access';
import { base44 } from '@/api/base44Client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Mail, Phone, Search, ShoppingBag, SlidersHorizontal, Sparkles } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import AdminOpsHeader from '@/components/admin/AdminOpsHeader';

const FILTERS = [
  { value: 'all', label: 'All members' },
  { value: 'balance', label: 'Balance issues' },
  { value: 'contact', label: 'Contact pending' },
  { value: 'current', label: 'Current' },
];

function money(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value || 0));
}

function date(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleDateString();
}

function resultData(result) {
  return result?.data || result || {};
}

function requestId() {
  return globalThis.crypto?.randomUUID?.() || `loyalty-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function LoyaltyMembers() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState(null);
  const [profileForm, setProfileForm] = useState({ first_name: '', last_name: '', phone: '' });
  const [adjustment, setAdjustment] = useState({ amount: '', reason: '' });

  const { data, isLoading, error } = useQuery({
    queryKey: ['loyalty-members-v2'],
    queryFn: async () => resultData(await base44.functions.invoke('auditCustomerAppLoyaltyAfterPhase2', { action: 'list' })),
    enabled: isAdminUser(user),
  });
  const members = data?.rows || [];
  const summary = data?.summary || {};

  const filteredMembers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return members.filter(member => {
      const balanceIssue = member.anomalies?.includes('cache_mismatch');
      const contactPending = member.anomalies?.includes('missing_name') || member.anomalies?.includes('missing_phone');
      if (filter === 'balance' && !balanceIssue) return false;
      if (filter === 'contact' && !contactPending) return false;
      if (filter === 'current' && (balanceIssue || contactPending)) return false;
      if (!query) return true;
      return [member.full_name, member.customer_email, member.phone, member.last_order_number]
        .some(value => String(value || '').toLowerCase().includes(query));
    });
  }, [filter, members, searchQuery]);

  const openMember = member => {
    setSelected(member);
    setProfileForm({ first_name: member.first_name || '', last_name: member.last_name || '', phone: member.phone || '' });
    setAdjustment({ amount: '', reason: '' });
  };

  const profileMutation = useMutation({
    mutationFn: async request => {
      const payload = resultData(await base44.functions.invoke('auditCustomerAppLoyaltyAfterPhase2', request));
      if (payload.success !== true) throw new Error(payload.error || 'Profile update failed');
      return payload;
    },
    onSuccess: async () => {
      toast.success('Customer profile updated');
      await queryClient.invalidateQueries({ queryKey: ['loyalty-members-v2'] });
      setSelected(null);
    },
    onError: mutationError => toast.error(mutationError.message || 'Profile update failed'),
  });

  const adjustmentMutation = useMutation({
    mutationFn: async request => {
      const payload = resultData(await base44.functions.invoke('auditCustomerAppLoyaltyAfterPhase2', request));
      if (payload.success !== true) throw new Error(payload.error || 'Points adjustment failed');
      return payload;
    },
    onSuccess: async () => {
      toast.success('Audited points adjustment posted');
      await queryClient.invalidateQueries({ queryKey: ['loyalty-members-v2'] });
      setSelected(null);
    },
    onError: mutationError => toast.error(mutationError.message || 'Points adjustment failed'),
  });

  if (!isAdminUser(user)) {
    return <div className="min-h-screen bg-background flex items-center justify-center"><p className="text-muted-foreground">Access denied. Admin only.</p></div>;
  }

  return (
    <div className="min-h-screen bg-background">
      <AdminOpsHeader
        title="Loyalty Members"
        subtitle="Order-backed balances, customer identity, and audited adjustments"
        badge="Live ledger"
        backTo="/admin/operations"
      />

      <main className="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Members', summary.member_count || 0, Sparkles],
            ['Outstanding points', Number(summary.total_outstanding_points || 0).toLocaleString(), SlidersHorizontal],
            ['Contact pending', summary.contact_pending_count ?? summary.profile_incomplete_count ?? 0, Phone],
            ['Balance issues', summary.balance_issue_count ?? summary.cache_mismatch_count ?? 0, CheckCircle2],
          ].map(([label, value, Icon]) => (
            <div key={label} className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
              <div className="flex items-center justify-between text-muted-foreground"><span className="text-xs font-semibold uppercase tracking-wide">{label}</span><Icon className="h-4 w-4" /></div>
              <p className="mt-3 text-2xl font-black text-foreground">{value}</p>
            </div>
          ))}
        </section>

        <section className="rounded-2xl border border-border/60 bg-card p-3 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search name, email, phone, or order number"
                value={searchQuery}
                onChange={event => setSearchQuery(event.target.value)}
                className="h-11 pl-9"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {FILTERS.map(option => (
                <Button key={option.value} size="sm" variant={filter === option.value ? 'default' : 'outline'} onClick={() => setFilter(option.value)}>
                  {option.label}
                </Button>
              ))}
            </div>
          </div>
        </section>

        {isLoading && <div className="py-16 text-center text-sm text-muted-foreground">Loading authoritative loyalty records…</div>}
        {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error.message || 'Unable to load loyalty members.'}</div>}
        {!isLoading && !error && filteredMembers.length === 0 && <div className="py-16 text-center text-sm text-muted-foreground">No members match this view.</div>}

        <section className="grid gap-3 lg:grid-cols-2">
          {filteredMembers.map(member => {
            const balanceIssue = member.anomalies?.includes('cache_mismatch');
            const contactPending = member.anomalies?.includes('missing_name') || member.anomalies?.includes('missing_phone');
            const statusLabel = balanceIssue ? 'Balance issue' : contactPending ? 'Contact pending' : 'Current';
            return (
              <button key={member.customer_email} type="button" onClick={() => openMember(member)} className="rounded-2xl border border-border/60 bg-card p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-bold text-foreground">{member.full_name}</p>
                      <Badge variant={balanceIssue ? 'destructive' : contactPending ? 'outline' : 'secondary'}>{statusLabel}</Badge>
                    </div>
                    <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                      <p className="flex items-center gap-2 truncate"><Mail className="h-3.5 w-3.5" />{member.customer_email}</p>
                      <p className="flex items-center gap-2"><Phone className="h-3.5 w-3.5" />{member.phone || 'Not provided yet'}</p>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xl font-black text-primary">{Number(member.total_points || 0).toLocaleString()}</p>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">available points</p>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 border-t border-border/50 pt-3 text-xs">
                  <div><p className="text-muted-foreground">Orders</p><p className="mt-1 font-bold">{member.order_count}</p></div>
                  <div><p className="text-muted-foreground">Spend</p><p className="mt-1 font-bold">{money(member.lifetime_spend)}</p></div>
                  <div><p className="text-muted-foreground">Last order</p><p className="mt-1 truncate font-bold">{member.last_order_number || '—'}</p></div>
                </div>
              </button>
            );
          })}
        </section>
      </main>

      <Dialog open={Boolean(selected)} onOpenChange={open => !open && setSelected(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selected?.full_name}</DialogTitle>
            <DialogDescription>{selected?.customer_email} · Joined {date(selected?.joined_at)}</DialogDescription>
          </DialogHeader>
          {selected && (
            <div className="space-y-6">
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl bg-muted/50 p-3"><p className="text-xs text-muted-foreground">Available</p><p className="mt-1 text-lg font-black">{selected.total_points}</p></div>
                <div className="rounded-xl bg-muted/50 p-3"><p className="text-xs text-muted-foreground">Lifetime</p><p className="mt-1 text-lg font-black">{selected.lifetime_points}</p></div>
                <div className="rounded-xl bg-muted/50 p-3"><p className="text-xs text-muted-foreground">Redeemed</p><p className="mt-1 text-lg font-black">{selected.redeemed_points}</p></div>
              </div>

              <section className="space-y-3">
                <div><h3 className="font-bold">Customer profile</h3><p className="text-xs text-muted-foreground">Fill verified information without changing the account email.</p></div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input value={profileForm.first_name} onChange={event => setProfileForm(current => ({ ...current, first_name: event.target.value }))} placeholder="First name" />
                  <Input value={profileForm.last_name} onChange={event => setProfileForm(current => ({ ...current, last_name: event.target.value }))} placeholder="Last name" />
                  <Input className="sm:col-span-2" value={profileForm.phone} onChange={event => setProfileForm(current => ({ ...current, phone: event.target.value }))} placeholder="Phone number" />
                </div>
                <Button disabled={profileMutation.isPending} onClick={() => profileMutation.mutate({ action: 'update_profile', customer_email: selected.customer_email, ...profileForm })}>Save profile</Button>
              </section>

              <section className="space-y-3 border-t border-border pt-5">
                <div><h3 className="font-bold">Audited points adjustment</h3><p className="text-xs text-muted-foreground">Use a positive number to add points or a negative number to remove them. Every adjustment is permanently traceable.</p></div>
                <Input type="number" step="1" value={adjustment.amount} onChange={event => setAdjustment(current => ({ ...current, amount: event.target.value }))} placeholder="Points adjustment, for example 250 or -100" />
                <Textarea value={adjustment.reason} onChange={event => setAdjustment(current => ({ ...current, reason: event.target.value }))} placeholder="Required reason tied to an order, correction, or customer-service decision" />
                <Button
                  variant="outline"
                  disabled={adjustmentMutation.isPending || !Number(adjustment.amount) || adjustment.reason.trim().length < 8}
                  onClick={() => {
                    const amount = Math.trunc(Number(adjustment.amount));
                    adjustmentMutation.mutate({
                      action: 'adjust_points',
                      customer_email: selected.customer_email,
                      amount,
                      reason: adjustment.reason,
                      request_id: requestId(),
                      confirmation: `ADJUST ${selected.customer_email} ${amount}`,
                    });
                  }}
                >
                  Post adjustment
                </Button>
              </section>

              <section className="space-y-3 border-t border-border pt-5">
                <div className="flex items-center gap-2"><ShoppingBag className="h-4 w-4" /><h3 className="font-bold">Recent ledger activity</h3></div>
                {selected.recent_transactions?.length ? selected.recent_transactions.map(transaction => (
                  <div key={transaction.id || transaction.idempotency_key} className="flex items-start justify-between gap-4 rounded-xl border border-border/60 p-3 text-sm">
                    <div><p className="font-semibold">{transaction.description}</p><p className="mt-1 text-xs text-muted-foreground">{date(transaction.occurred_at)}{transaction.order_number ? ` · ${transaction.order_number}` : ''}</p></div>
                    <p className={`font-black ${transaction.amount >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{transaction.amount >= 0 ? '+' : ''}{transaction.amount}</p>
                  </div>
                )) : <p className="rounded-xl bg-muted/50 p-4 text-sm text-muted-foreground">No ledger transactions have been recorded yet. Existing balances will receive a reconciliation entry during migration.</p>}
              </section>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
