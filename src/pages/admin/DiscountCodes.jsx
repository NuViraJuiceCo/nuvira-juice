import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgePercent, CheckCircle2, Loader2, Pencil, Plus, Save, X, XCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import AdminOpsHeader from '@/components/admin/AdminOpsHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/lib/AuthContext';
import { isAdminUser } from '@/lib/admin-access';

const EMPTY_FORM = {
  code: '',
  display_name: '',
  discount_kind: 'promotion',
  discount_type: 'percent',
  discount_value: '10',
  minimum_subtotal: '0',
  maximum_discount: '',
  once_per_customer: false,
  starts_at: '',
  ends_at: '',
  active: true,
  internal_notes: '',
};

function normalizeCode(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

function toLocalInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function toIsoOrEmpty(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

function lifecycleLabel(code) {
  if (!code.active) return { label: 'Inactive', tone: 'text-slate-400' };
  const now = Date.now();
  const starts = code.starts_at ? new Date(code.starts_at).getTime() : null;
  const ends = code.ends_at ? new Date(code.ends_at).getTime() : null;
  if (starts && starts > now) return { label: 'Scheduled', tone: 'text-amber-300' };
  if (ends && ends < now) return { label: 'Expired', tone: 'text-rose-300' };
  return { label: 'Active', tone: 'text-emerald-300' };
}

function discountValueLabel(code) {
  return code.discount_type === 'fixed_amount'
    ? `$${Number(code.discount_value || 0).toFixed(2)} off`
    : `${Number(code.discount_value || 0).toFixed(2).replace(/\.00$/, '')}% off`;
}

export default function DiscountCodes() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);

  const { data: codes = [], isLoading } = useQuery({
    queryKey: ['admin-discount-codes'],
    queryFn: () => base44.entities.DiscountCode.list('-created_date', 200),
    enabled: isAdminUser(user),
  });

  const sortedCodes = useMemo(() => [...codes].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return String(a.code).localeCompare(String(b.code));
  }), [codes]);

  if (!isAdminUser(user)) {
    return <div className="min-h-screen bg-background p-6 text-sm text-muted-foreground">Access denied.</div>;
  }

  const resetForm = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const editCode = (code) => {
    setEditingId(code.id);
    setForm({
      code: code.code || '',
      display_name: code.display_name || '',
      discount_kind: code.discount_kind || 'promotion',
      discount_type: code.discount_type || 'percent',
      discount_value: String(code.discount_value ?? ''),
      minimum_subtotal: String(code.minimum_subtotal ?? 0),
      maximum_discount: Number(code.maximum_discount || 0) > 0 ? String(code.maximum_discount) : '',
      once_per_customer: code.once_per_customer === true,
      starts_at: toLocalInput(code.starts_at),
      ends_at: toLocalInput(code.ends_at),
      active: code.active === true,
      internal_notes: code.internal_notes || '',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const saveCode = async () => {
    const code = normalizeCode(form.code);
    const value = Number(form.discount_value);
    const minimum = Number(form.minimum_subtotal || 0);
    const maximum = form.maximum_discount === '' ? 0 : Number(form.maximum_discount);
    const startsAt = toIsoOrEmpty(form.starts_at);
    const endsAt = toIsoOrEmpty(form.ends_at);

    if (!/^[A-Z0-9_-]{3,32}$/.test(code)) {
      toast.error('Use 3-32 letters, numbers, hyphens, or underscores.');
      return;
    }
    if (!form.display_name.trim()) {
      toast.error('Add a customer-facing discount name.');
      return;
    }
    if (!Number.isFinite(value) || value <= 0 || (form.discount_type === 'percent' && value > 100)) {
      toast.error('Enter a valid discount value.');
      return;
    }
    if (!Number.isFinite(minimum) || minimum < 0 || !Number.isFinite(maximum) || maximum < 0) {
      toast.error('Subtotal and maximum discount values must be valid.');
      return;
    }
    if (startsAt && endsAt && new Date(startsAt) >= new Date(endsAt)) {
      toast.error('The end time must be after the start time.');
      return;
    }
    if (codes.some((item) => item.id !== editingId && normalizeCode(item.code) === code)) {
      toast.error('That discount code already exists.');
      return;
    }

    const payload = {
      code,
      display_name: form.display_name.trim(),
      discount_kind: form.discount_kind,
      discount_type: form.discount_type,
      discount_value: value,
      minimum_subtotal: minimum,
      maximum_discount: maximum,
      once_per_customer: form.once_per_customer,
      starts_at: startsAt,
      ends_at: endsAt,
      active: form.active,
      internal_notes: form.internal_notes.trim(),
    };

    setSaving(true);
    try {
      if (editingId) {
        await base44.entities.DiscountCode.update(editingId, payload);
      } else {
        await base44.entities.DiscountCode.create(payload);
      }
      await queryClient.invalidateQueries({ queryKey: ['admin-discount-codes'] });
      toast.success(editingId ? 'Discount code updated.' : 'Discount code created.');
      resetForm();
    } catch (error) {
      toast.error(error?.message || 'Unable to save this discount code.');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (code) => {
    try {
      await base44.entities.DiscountCode.update(code.id, { active: !code.active });
      await queryClient.invalidateQueries({ queryKey: ['admin-discount-codes'] });
      toast.success(`${code.code} ${code.active ? 'deactivated' : 'activated'}.`);
    } catch (error) {
      toast.error(error?.message || 'Unable to update this discount code.');
    }
  };

  return (
    <div className="min-h-screen bg-background pb-[calc(7rem+env(safe-area-inset-bottom))] md:pb-12">
      <AdminOpsHeader
        title="Discount Codes"
        subtitle="Create and schedule checkout offers"
        badge="Live"
        badgeTone="native"
        onBack={() => navigate('/admin/operations')}
      />

      <main className="mx-auto grid w-full max-w-[1440px] gap-5 px-4 py-5 lg:grid-cols-[minmax(320px,430px)_minmax(0,1fr)]">
        <section className="h-fit rounded-lg border border-border bg-card p-4 lg:sticky lg:top-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-foreground">{editingId ? 'Edit code' : 'New code'}</h2>
              <p className="text-xs text-muted-foreground">Changes become available without a store release.</p>
            </div>
            {editingId && (
              <Button type="button" variant="ghost" size="icon" onClick={resetForm} title="Cancel editing">
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>

          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <div>
                <Label htmlFor="discount-code">Code</Label>
                <Input id="discount-code" value={form.code} onChange={(event) => setForm((prev) => ({ ...prev, code: normalizeCode(event.target.value) }))} placeholder="SUMMER10" autoCapitalize="characters" />
              </div>
              <div>
                <Label htmlFor="discount-name">Display name</Label>
                <Input id="discount-name" value={form.display_name} onChange={(event) => setForm((prev) => ({ ...prev, display_name: event.target.value }))} placeholder="Summer 10% off" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="discount-kind">Kind</Label>
                <select id="discount-kind" value={form.discount_kind} onChange={(event) => setForm((prev) => ({ ...prev, discount_kind: event.target.value }))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground">
                  <option value="promotion">Promotion</option>
                  <option value="referral">Referral</option>
                </select>
              </div>
              <div>
                <Label htmlFor="discount-type">Type</Label>
                <select id="discount-type" value={form.discount_type} onChange={(event) => setForm((prev) => ({ ...prev, discount_type: event.target.value }))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground">
                  <option value="percent">Percent</option>
                  <option value="fixed_amount">Fixed amount</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label htmlFor="discount-value">Value</Label>
                <Input id="discount-value" type="number" min="0" step="0.01" value={form.discount_value} onChange={(event) => setForm((prev) => ({ ...prev, discount_value: event.target.value }))} />
              </div>
              <div>
                <Label htmlFor="discount-minimum">Min. subtotal</Label>
                <Input id="discount-minimum" type="number" min="0" step="0.01" value={form.minimum_subtotal} onChange={(event) => setForm((prev) => ({ ...prev, minimum_subtotal: event.target.value }))} />
              </div>
              <div>
                <Label htmlFor="discount-maximum">Max. discount</Label>
                <Input id="discount-maximum" type="number" min="0" step="0.01" value={form.maximum_discount} onChange={(event) => setForm((prev) => ({ ...prev, maximum_discount: event.target.value }))} placeholder="None" />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <div>
                <Label htmlFor="discount-start">Starts</Label>
                <Input id="discount-start" type="datetime-local" value={form.starts_at} onChange={(event) => setForm((prev) => ({ ...prev, starts_at: event.target.value }))} />
              </div>
              <div>
                <Label htmlFor="discount-end">Ends</Label>
                <Input id="discount-end" type="datetime-local" value={form.ends_at} onChange={(event) => setForm((prev) => ({ ...prev, ends_at: event.target.value }))} />
              </div>
            </div>

            <div>
              <Label htmlFor="discount-notes">Internal notes</Label>
              <Input id="discount-notes" value={form.internal_notes} onChange={(event) => setForm((prev) => ({ ...prev, internal_notes: event.target.value }))} placeholder="Optional" />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2.5">
              <div>
                <p className="text-sm font-medium text-foreground">Active</p>
                <p className="text-xs text-muted-foreground">Dates still control the usable window.</p>
              </div>
              <Switch checked={form.active} onCheckedChange={(active) => setForm((prev) => ({ ...prev, active }))} />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2.5">
              <div>
                <p className="text-sm font-medium text-foreground">One use per customer</p>
                <p className="text-xs text-muted-foreground">Blocks the code after a successful purchase on that account.</p>
              </div>
              <Switch checked={form.once_per_customer} onCheckedChange={(once_per_customer) => setForm((prev) => ({ ...prev, once_per_customer }))} />
            </div>

            <Button type="button" onClick={saveCode} disabled={saving} className="w-full">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : editingId ? <Save className="mr-2 h-4 w-4" /> : <Plus className="mr-2 h-4 w-4" />}
              {editingId ? 'Save changes' : 'Create code'}
            </Button>
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-foreground">Configured codes</h2>
              <p className="text-xs text-muted-foreground">{codes.filter((code) => lifecycleLabel(code).label === 'Active').length} active now</p>
            </div>
            <BadgePercent className="h-5 w-5 text-primary" />
          </div>

          {isLoading ? (
            <div className="flex min-h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : sortedCodes.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No discount codes configured.</div>
          ) : (
            <div className="grid gap-3 xl:grid-cols-2">
              {sortedCodes.map((code) => {
                const lifecycle = lifecycleLabel(code);
                return (
                  <article key={code.id} className="rounded-lg border border-border bg-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-mono text-base font-bold text-foreground">{code.code}</p>
                          <span className={`text-xs font-semibold ${lifecycle.tone}`}>{lifecycle.label}</span>
                        </div>
                        <p className="mt-1 text-sm text-foreground">{code.display_name}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {discountValueLabel(code)} · {code.discount_kind === 'referral' ? 'Referral' : 'Promotion'}
                          {Number(code.minimum_subtotal || 0) > 0 ? ` · $${Number(code.minimum_subtotal).toFixed(2)} minimum` : ''}
                          {code.once_per_customer ? ' · One use per customer' : ''}
                        </p>
                      </div>
                      {code.active ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" /> : <XCircle className="h-5 w-5 shrink-0 text-slate-500" />}
                    </div>

                    <div className="mt-4 flex items-center gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => editCode(code)}>
                        <Pencil className="mr-2 h-3.5 w-3.5" /> Edit
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => toggleActive(code)}>
                        {code.active ? 'Deactivate' : 'Activate'}
                      </Button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
