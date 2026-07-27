import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import AdminOpsHeader from '@/components/admin/AdminOpsHeader';
import { AdminStatusPill } from '@/components/admin/AdminStatusPill';
import { base44 } from '@/api/base44Client';
import { isAdminUser } from '@/lib/admin-access';
import { useAuth } from '@/lib/AuthContext';
import { ClipboardList, DollarSign, Package, Search, ShoppingCart } from 'lucide-react';

function formatDate(value) {
  if (!value) return '-';
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return value;
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatMoney(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `$${parsed.toFixed(2)}` : '-';
}

function formatQuantity(value, unit) {
  if (value === null || value === undefined || value === '') return '-';
  return unit ? `${value} ${unit}` : value;
}

function statusKey(value) {
  return (value || '').toString().trim().toLowerCase();
}

function matchesSearch(po, search) {
  const query = search.trim().toLowerCase();
  if (!query) return true;
  return [
    po.po_number,
    po.supplier,
    po.status,
    po.notes,
    ...(Array.isArray(po.items) ? po.items.map(item => item.ingredient) : []),
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

function PurchaseOrderCard({ po }) {
  const items = Array.isArray(po.items) ? po.items : [];
  return (
    <article className="rounded-xl border border-border/50 bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Purchase Order</p>
          <h2 className="mt-0.5 text-base font-bold text-foreground">{po.po_number || 'PO number pending'}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{po.supplier || 'Supplier pending'}</p>
        </div>
        <AdminStatusPill value={po.status} label={po.status || 'Status pending'} size="md" />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
        <div className="rounded-lg border border-border/50 bg-background p-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Order Date</p>
          <p className="mt-1 font-bold text-foreground">{formatDate(po.order_date)}</p>
        </div>
        <div className="rounded-lg border border-border/50 bg-background p-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Expected</p>
          <p className="mt-1 font-bold text-foreground">{formatDate(po.expected_date)}</p>
        </div>
        <div className="rounded-lg border border-border/50 bg-background p-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Total</p>
          <p className="mt-1 font-bold text-foreground">{formatMoney(po.total_amount)}</p>
        </div>
      </div>

      <div className="mt-4 space-y-1.5">
        {items.length === 0 ? (
          <p className="rounded-lg border border-border/50 bg-background p-3 text-xs text-muted-foreground">No line items returned.</p>
        ) : items.slice(0, 8).map(item => (
          <div key={`${po.id || po.po_number}-${item.ingredient}-${item.quantity}-${item.unit}`} className="flex items-center justify-between gap-3 rounded-lg border border-border/40 bg-background px-3 py-2 text-xs">
            <span className="min-w-0 truncate font-semibold text-foreground">{item.ingredient || 'Ingredient pending'}</span>
            <span className="shrink-0 text-muted-foreground">{formatQuantity(item.quantity, item.unit)}{item.unit_cost ? ` · ${formatMoney(item.unit_cost)}` : ''}</span>
          </div>
        ))}
        {items.length > 8 && <p className="text-[10px] text-muted-foreground">Showing 8 of {items.length} line items.</p>}
      </div>

      {po.notes && <p className="mt-4 rounded-lg border border-border/50 bg-background p-3 text-xs text-muted-foreground">{po.notes}</p>}
    </article>
  );
}

export default function PurchaseOrders() {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('open');

  const { data = [], isLoading, isError, error, isFetching } = useQuery({
    queryKey: ['admin-purchase-orders-read-model'],
    queryFn: () => base44.entities.PurchaseOrder.list('-created_date', 200),
    enabled: isAdminUser(user),
    staleTime: 60000,
  });

  const purchaseOrders = Array.isArray(data) ? data : [];
  const stats = useMemo(() => {
    const openStatuses = new Set(['draft', 'ordered', 'in transit']);
    const open = purchaseOrders.filter(po => openStatuses.has(statusKey(po.status)));
    const totalAmount = purchaseOrders.reduce((sum, po) => sum + (Number(po.total_amount) || 0), 0);
    return {
      total: purchaseOrders.length,
      open: open.length,
      delivered: purchaseOrders.filter(po => statusKey(po.status) === 'delivered').length,
      totalAmount,
    };
  }, [purchaseOrders]);

  const filtered = useMemo(() => purchaseOrders.filter(po => {
    const key = statusKey(po.status);
    if (statusFilter === 'open' && !['draft', 'ordered', 'in transit'].includes(key)) return false;
    if (statusFilter !== 'all' && statusFilter !== 'open' && key !== statusFilter) return false;
    return matchesSearch(po, search);
  }), [purchaseOrders, search, statusFilter]);

  if (!isAdminUser(user)) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <p className="text-sm text-muted-foreground">Admin access required.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-[calc(7rem+env(safe-area-inset-bottom))] md:pb-10">
      <AdminOpsHeader title="Purchase Orders" subtitle="Read-only procurement context" badge="Read-only" />

      <main className="mx-auto mt-4 w-full max-w-[1180px] space-y-4 px-4">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <StatCard icon={ClipboardList} label="PO Count" value={stats.total.toLocaleString()} isRefreshing={isFetching} />
          <StatCard icon={ShoppingCart} label="Open" value={stats.open.toLocaleString()} />
          <StatCard icon={Package} label="Delivered" value={stats.delivered.toLocaleString()} />
          <StatCard icon={DollarSign} label="Recorded Value" value={formatMoney(stats.totalAmount)} />
        </div>

        <section className="rounded-xl border border-border bg-card p-4">
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-[1fr_180px]">
            <label className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="Search PO number, supplier, ingredient..."
                className="h-10 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
            <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)} className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground">
              <option value="open">Open</option>
              <option value="all">All statuses</option>
              <option value="draft">Draft</option>
              <option value="ordered">Ordered</option>
              <option value="in transit">In Transit</option>
              <option value="delivered">Delivered</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            This page does not create, receive, cancel, or mutate purchase orders. Use it to confirm supplier coverage before production.
          </p>
        </section>

        {isLoading ? (
          <div className="flex justify-center py-16">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : isError ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
            <p className="text-sm font-semibold text-destructive">Unable to load purchase orders</p>
            <p className="mt-1 text-xs text-muted-foreground">{error?.message || 'Try again later.'}</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-border/50 bg-card p-8 text-center">
            <p className="text-sm font-semibold text-foreground">No purchase orders found</p>
            <p className="mt-1 text-xs text-muted-foreground">Adjust the filters or confirm procurement records have synced.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {filtered.map(po => <PurchaseOrderCard key={po.id || po.po_number} po={po} />)}
          </div>
        )}
      </main>
    </div>
  );
}
