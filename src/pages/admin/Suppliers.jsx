import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import AdminOpsHeader from '@/components/admin/AdminOpsHeader';
import { AdminStatusPill } from '@/components/admin/AdminStatusPill';
import { base44 } from '@/api/base44Client';
import { isAdminUser } from '@/lib/admin-access';
import { useAuth } from '@/lib/AuthContext';
import { Mail, MapPin, Phone, Search, Star, Store, Truck } from 'lucide-react';

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function statusKey(value) {
  return (value || '').toString().trim().toLowerCase();
}

function matchesSearch(supplier, search) {
  const query = search.trim().toLowerCase();
  if (!query) return true;
  return [
    supplier.name,
    supplier.contact_name,
    supplier.email,
    supplier.phone,
    supplier.address,
    supplier.location,
    supplier.category,
    supplier.status,
    supplier.payment_terms,
    supplier.notes,
  ].filter(Boolean).join(' ').toLowerCase().includes(query);
}

function StatCard({ icon: Icon, label, value, sublabel, isRefreshing }) {
  return (
    <div className="rounded-xl border border-border/50 bg-card p-3">
      {Icon && <Icon className={`mb-1 h-4 w-4 text-primary ${isRefreshing ? 'animate-spin' : ''}`} />}
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-lg font-bold text-foreground">{value}</p>
      {sublabel && <p className="text-[10px] text-muted-foreground">{sublabel}</p>}
    </div>
  );
}

function SupplierCard({ supplier }) {
  return (
    <article className="rounded-xl border border-border/50 bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{supplier.category || 'Supplier'}</p>
          <h2 className="mt-0.5 text-base font-bold leading-tight text-foreground">{supplier.name || 'Unnamed supplier'}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{supplier.contact_name || 'Contact pending'}</p>
        </div>
        <AdminStatusPill value={supplier.status} label={supplier.status || 'Status pending'} size="md" />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg border border-border/50 bg-background p-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Lead Time</p>
          <p className="mt-1 font-bold text-foreground">{supplier.lead_time_days ? `${supplier.lead_time_days} days` : '-'}</p>
        </div>
        <div className="rounded-lg border border-border/50 bg-background p-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Rating</p>
          <p className="mt-1 font-bold text-foreground">{supplier.rating ? `${Number(supplier.rating).toFixed(1)} / 5` : '-'}</p>
        </div>
      </div>

      <div className="mt-4 space-y-2 border-t border-border/50 pt-3 text-xs text-muted-foreground">
        {supplier.phone && <p className="flex items-center gap-2"><Phone className="h-3.5 w-3.5" /> {supplier.phone}</p>}
        {supplier.email && <p className="flex items-center gap-2"><Mail className="h-3.5 w-3.5" /> {supplier.email}</p>}
        {(supplier.location || supplier.address) && <p className="flex items-start gap-2"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span>{supplier.address || supplier.location}</span></p>}
        {supplier.payment_terms && <p className="font-medium text-foreground/80">Terms: {supplier.payment_terms}</p>}
      </div>

      {supplier.notes && <p className="mt-3 rounded-lg border border-border/50 bg-background p-3 text-xs text-muted-foreground">{supplier.notes}</p>}
    </article>
  );
}

export default function Suppliers() {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [categoryFilter, setCategoryFilter] = useState('all');

  const { data = [], isLoading, isError, error, isFetching } = useQuery({
    queryKey: ['admin-suppliers-read-model'],
    queryFn: () => base44.entities.Supplier.list('name', 200),
    enabled: isAdminUser(user),
    staleTime: 60000,
  });

  const suppliers = Array.isArray(data) ? data : [];
  const categories = useMemo(() => [...new Set(suppliers.map(supplier => supplier.category).filter(Boolean))].sort(), [suppliers]);
  const stats = useMemo(() => {
    const active = suppliers.filter(supplier => statusKey(supplier.status) === 'active').length;
    const negotiating = suppliers.filter(supplier => statusKey(supplier.status) === 'negotiating').length;
    const leadTimes = suppliers.map(supplier => Number(supplier.lead_time_days)).filter(value => Number.isFinite(value) && value > 0);
    const avgLeadTime = leadTimes.length ? Math.round(leadTimes.reduce((sum, value) => sum + value, 0) / leadTimes.length) : 0;
    return { total: suppliers.length, active, negotiating, avgLeadTime };
  }, [suppliers]);

  const filtered = useMemo(() => suppliers.filter(supplier => {
    if (statusFilter !== 'all' && statusKey(supplier.status) !== statusFilter) return false;
    if (categoryFilter !== 'all' && supplier.category !== categoryFilter) return false;
    return matchesSearch(supplier, search);
  }), [categoryFilter, search, statusFilter, suppliers]);

  if (!isAdminUser(user)) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <p className="text-sm text-muted-foreground">Admin access required.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-[calc(7rem+env(safe-area-inset-bottom))] md:pb-10">
      <AdminOpsHeader title="Suppliers" subtitle="Read-only supplier directory" badge="Read-only" />

      <main className="mx-auto mt-4 w-full max-w-[1180px] space-y-4 px-4">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <StatCard icon={Store} label="Suppliers" value={formatNumber(stats.total)} isRefreshing={isFetching} />
          <StatCard label="Active" value={formatNumber(stats.active)} />
          <StatCard icon={Star} label="Negotiating" value={formatNumber(stats.negotiating)} />
          <StatCard icon={Truck} label="Avg Lead Time" value={stats.avgLeadTime ? `${stats.avgLeadTime}d` : '-'} />
        </div>

        <section className="rounded-xl border border-border bg-card p-4">
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-[1fr_170px_190px]">
            <label className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="Search supplier, contact, category, terms..."
                className="h-10 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
            <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)} className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground">
              <option value="active">Active</option>
              <option value="all">All status</option>
              <option value="negotiating">Negotiating</option>
              <option value="inactive">Inactive</option>
            </select>
            <select value={categoryFilter} onChange={event => setCategoryFilter(event.target.value)} className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground">
              <option value="all">All categories</option>
              {categories.map(category => <option key={category} value={category}>{category}</option>)}
            </select>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Supplier edits, onboarding, and procurement actions remain outside this read-only directory until their exact write contracts are promoted.
          </p>
        </section>

        {isLoading ? (
          <div className="flex justify-center py-16">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : isError ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
            <p className="text-sm font-semibold text-destructive">Unable to load suppliers</p>
            <p className="mt-1 text-xs text-muted-foreground">{error?.message || 'Try again later.'}</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-border/50 bg-card p-8 text-center">
            <p className="text-sm font-semibold text-foreground">No suppliers found</p>
            <p className="mt-1 text-xs text-muted-foreground">Adjust the filters or confirm supplier records have synced.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {filtered.map(supplier => <SupplierCard key={supplier.id || supplier.name} supplier={supplier} />)}
          </div>
        )}
      </main>
    </div>
  );
}
