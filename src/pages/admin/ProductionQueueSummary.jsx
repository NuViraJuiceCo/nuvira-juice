import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { AlertTriangle, ArrowLeft, CalendarDays, CheckCircle2, Database, Lock, Package, RefreshCw } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';

function todayDate() {
  const today = new Date();
  const year = today.getFullYear();
  const month = `${today.getMonth() + 1}`.padStart(2, '0');
  const day = `${today.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(dateStr, days) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function parseLocalDate(str) {
  if (!str) return null;
  const [year, month, day] = str.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function daysInclusive(from, to) {
  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T00:00:00.000Z`);
  return Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) + 1;
}

function formatDate(value) {
  if (!value) return 'Date pending';
  try {
    return format(parseLocalDate(value), 'MMM d, yyyy');
  } catch {
    return value;
  }
}

function formatDateTime(value) {
  if (!value) return null;
  try {
    return format(new Date(value), 'MMM d, yyyy - h:mm a');
  } catch {
    return value;
  }
}

function formatLabel(value) {
  if (!value) return 'Not set';
  return value
    .toString()
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function sourceTypeSummary(sourceTypeCounts) {
  const entries = Object.entries(sourceTypeCounts || {});
  if (entries.length === 0) return 'No source mix';
  return entries
    .map(([source, count]) => `${formatLabel(source)}: ${count}`)
    .join(' · ');
}

function compactOrderNumbers(orderNumbers) {
  if (!Array.isArray(orderNumbers) || orderNumbers.length === 0) return 'No order refs';
  const visible = orderNumbers.slice(0, 8);
  const remaining = orderNumbers.length - visible.length;
  return remaining > 0 ? `${visible.join(', ')} +${remaining} more` : visible.join(', ');
}

function statusClass(status) {
  const key = (status || '').toString().toLowerCase();
  if (key.includes('complete') || key.includes('ready')) return 'bg-green-100 text-green-700';
  if (key.includes('progress') || key.includes('production')) return 'bg-blue-100 text-blue-700';
  if (key.includes('hold') || key.includes('blocked')) return 'bg-amber-100 text-amber-800';
  return 'bg-muted text-muted-foreground';
}

function isDoneStatus(status) {
  const key = (status || '').toString().toLowerCase();
  return ['verified_logged', 'completed', 'archived', 'fulfilled'].includes(key);
}

function isInProgressStatus(status) {
  const key = (status || '').toString().toLowerCase();
  return key === 'in_production' || key.includes('in progress');
}

function isNeedsVerificationStatus(status) {
  const key = (status || '').toString().toLowerCase();
  return key === 'completed_pending_verification' || key.includes('pending verification') || key.includes('needs verification');
}

function isShotCategory(category) {
  return (category || '').toString().toLowerCase() === 'shot';
}

function requestIdFor(prefix, batch) {
  const fallback = Math.random().toString(36).slice(2);
  const randomId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : fallback;
  return `${prefix}_${batch.id || batch.batch_id || 'batch'}_${Date.now()}_${randomId}`;
}

function formatNumber(value) {
  if (value === null || value === undefined || value === '') return '-';
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '-';
  return Math.round(parsed * 1000) / 1000;
}

function InventoryDeductionPanel({ batch, onDeductionSuccess }) {
  const [preview, setPreview] = useState(null);
  const [previewPending, setPreviewPending] = useState(false);
  const [deductPending, setDeductPending] = useState(false);
  const [message, setMessage] = useState(null);

  async function previewDeduction() {
    setPreviewPending(true);
    setMessage(null);

    try {
      const res = await base44.functions.invoke('previewAdminProductionInventoryDeduction', {
        production_batch_id: batch.id,
        batch_id: batch.batch_id,
        expected_status: batch.status,
        request_id: requestIdFor('inventory_preview', batch),
      });
      const result = res?.data || res;
      if (result?.error && result?.success !== true) throw new Error(result.error);
      setPreview(result);
      setMessage({
        type: result?.live_allowed ? 'success' : 'warn',
        text: result?.live_allowed
          ? 'Inventory deduction is allowed for this batch.'
          : 'Inventory deduction is not currently allowed. Review blockers below.',
      });
    } catch {
      setMessage({ type: 'error', text: 'Unable to preview inventory deduction.' });
    } finally {
      setPreviewPending(false);
    }
  }

  async function deductInventory() {
    if (!preview?.live_allowed) return;
    if (!window.confirm(`Deduct inventory for ${batch.batch_id || batch.product_name}? This updates Hub inventory stock and cannot be previewed again as a new deduction.`)) {
      return;
    }

    setDeductPending(true);
    setMessage(null);

    try {
      const res = await base44.functions.invoke('deductAdminProductionInventory', {
        production_batch_id: batch.id,
        batch_id: batch.batch_id,
        expected_status: batch.status,
        request_id: requestIdFor('inventory_deduct', batch),
        reason: 'Admin Production Queue inventory deduction.',
      });
      const result = res?.data || res;
      if (!result?.success) throw new Error(result?.error || 'deduction_failed');
      setMessage({
        type: result.skipped ? 'warn' : 'success',
        text: result.skipped ? 'Inventory deduction was already recorded.' : 'Inventory deduction completed.',
      });
      await onDeductionSuccess?.();
    } catch {
      setMessage({ type: 'error', text: 'Unable to deduct inventory. Hub gates may still be closed.' });
    } finally {
      setDeductPending(false);
    }
  }

  const blockers = Array.isArray(preview?.blockers) ? preview.blockers : [];
  const warnings = Array.isArray(preview?.warnings) ? preview.warnings : [];
  const rows = Array.isArray(preview?.deduction_preview_rows) ? preview.deduction_preview_rows : [];

  return (
    <div className="rounded-lg border border-border/50 bg-background p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-primary" />
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Inventory Deduction</p>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            Preview-first Hub action. No purchase orders or Customer App records are updated.
          </p>
        </div>
        <button
          type="button"
          onClick={previewDeduction}
          disabled={previewPending || !batch.id}
          className="h-8 rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground disabled:opacity-60"
        >
          {previewPending ? 'Previewing...' : 'Preview'}
        </button>
      </div>

      {message && (
        <p className={`text-xs ${
          message.type === 'error'
            ? 'text-destructive'
            : message.type === 'warn'
              ? 'text-amber-700'
              : 'text-green-700'
        }`}>
          {message.text}
        </p>
      )}

      {preview && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg bg-card p-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Rows</p>
              <p className="text-sm font-bold">{preview.deduction_preview_count ?? rows.length}</p>
            </div>
            <div className="rounded-lg bg-card p-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Used</p>
              <p className="text-sm font-bold">{preview.ingredients_used_count ?? '-'}</p>
            </div>
            <div className="rounded-lg bg-card p-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Allowed</p>
              <p className="text-sm font-bold">{preview.live_allowed ? 'Yes' : 'No'}</p>
            </div>
          </div>

          {(blockers.length > 0 || warnings.length > 0) && (
            <div className="space-y-1">
              {blockers.map(blocker => (
                <div key={`blocker-${blocker}`} className="flex items-start gap-2 text-xs text-amber-800">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>{formatLabel(blocker)}</span>
                </div>
              ))}
              {warnings.map(warning => (
                <div key={`warning-${warning}`} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>{formatLabel(warning)}</span>
                </div>
              ))}
            </div>
          )}

          {rows.length > 0 && (
            <div className="space-y-1.5">
              {rows.slice(0, 8).map(row => (
                <div
                  key={`${row.ingredient_name}-${row.inventory_item_id}`}
                  className="rounded-md bg-card px-2 py-1.5 text-xs"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground truncate">{row.ingredient_name || 'Ingredient'}</p>
                      <p className="text-muted-foreground">
                        Deduct {formatNumber(row.quantity_to_deduct)} {row.inventory_unit || row.unit || ''}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-semibold text-foreground">{formatLabel(row.status)}</p>
                      <p className="text-muted-foreground">
                        {formatNumber(row.current_stock)} → {formatNumber(row.projected_stock)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
              {rows.length > 8 && (
                <p className="text-[10px] text-muted-foreground">Showing 8 of {rows.length} preview rows.</p>
              )}
            </div>
          )}

          {preview.live_allowed && (
            <button
              type="button"
              onClick={deductInventory}
              disabled={deductPending}
              className="h-9 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-60"
            >
              {deductPending ? 'Deducting...' : 'Deduct Inventory'}
            </button>
          )}

          {!preview.live_allowed && (
            <div className="flex items-start gap-2 text-xs text-muted-foreground">
              <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>Live deduction remains gated until the Hub preview allows this exact batch.</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function getBatchTab(batch, today) {
  if (isNeedsVerificationStatus(batch.status)) return 'verify';
  if (isInProgressStatus(batch.status)) return 'in_progress';
  if (isDoneStatus(batch.status) || (batch.production_date && batch.production_date < today)) return 'history';
  return 'today';
}

function uniqueOptions(items, field) {
  return [...new Set(items.map(item => item[field]).filter(Boolean))]
    .sort((a, b) => formatLabel(a).localeCompare(formatLabel(b)));
}

function groupByProductionDate(items) {
  return items.reduce((groups, batch) => {
    const date = batch.production_date || 'unscheduled';
    if (!groups[date]) groups[date] = [];
    groups[date].push(batch);
    return groups;
  }, {});
}

function BatchCard({ batch, onDeductionSuccess }) {
  const categoryAccent = isShotCategory(batch.product_category) ? 'border-l-amber-400' : 'border-l-primary';

  return (
    <div className={`rounded-xl border border-border/50 border-l-4 ${categoryAccent} bg-card p-4 space-y-3`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-heading text-lg font-bold text-foreground mt-0.5">{batch.product_name || 'Unnamed product'}</h2>
          <p className="text-xs text-muted-foreground">{batch.product_category || 'Uncategorized'}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {batch.is_locked && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground">
              <Lock className="w-3 h-3" />
              Locked
            </span>
          )}
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${statusClass(batch.status)}`}>
            {formatLabel(batch.status)}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg bg-secondary/50 p-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Needed</p>
          <p className="text-sm font-bold">{batch.planned_units ?? '-'}</p>
        </div>
        <div className="rounded-lg bg-secondary/50 p-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Produced</p>
          <p className="text-sm font-bold">{batch.actual_units ?? '-'}</p>
        </div>
        <div className="rounded-lg bg-secondary/50 p-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Orders</p>
          <p className="text-sm font-bold">{batch.order_count || 0}</p>
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Batch ID</p>
        <p className="text-xs font-medium text-foreground break-words">{batch.batch_id || 'No batch id'}</p>
      </div>

      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Order refs</p>
        <p className="text-xs text-foreground break-words">{compactOrderNumbers(batch.order_numbers)}</p>
      </div>

      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Source mix</p>
        <p className="text-xs text-foreground">{sourceTypeSummary(batch.source_type_counts)}</p>
      </div>

      {batch.updated_date && (
        <p className="text-[10px] text-muted-foreground pt-1 border-t border-border/40">
          Last Hub update: {formatDateTime(batch.updated_date)}
        </p>
      )}

      <InventoryDeductionPanel batch={batch} onDeductionSuccess={onDeductionSuccess} />
    </div>
  );
}

function ProductionDateSection({ date, batches, today, onDeductionSuccess }) {
  const isToday = date === today;
  const isPast = date !== 'unscheduled' && date < today;
  const neededUnits = batches.reduce((total, batch) => total + (Number(batch.planned_units) || 0), 0);
  const producedUnits = batches.reduce((total, batch) => total + (Number(batch.actual_units) || 0), 0);
  const productCount = batches.length;
  const headerClass = isToday
    ? 'bg-primary/10 border-primary/30'
    : isPast
      ? 'bg-muted/40 border-border'
      : 'bg-muted/30 border-border';
  const titleClass = isToday ? 'text-primary' : 'text-foreground';
  const dateLabel = date === 'unscheduled'
    ? 'Production Date Pending'
    : isToday
      ? `Today - ${formatDate(date)}`
      : formatDate(date);

  return (
    <section className="space-y-3">
      <div className={`rounded-xl border p-3 ${headerClass}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className={`text-sm font-bold ${titleClass}`}>{dateLabel}</h2>
            <p className="text-xs text-foreground/70 mt-0.5 font-medium">
              {productCount} product{productCount !== 1 ? 's' : ''} · {neededUnits} needed
              {` · ${producedUnits} produced`}
            </p>
          </div>
          <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-card/70 border border-border text-muted-foreground">
            Hub Production
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {batches.map(batch => (
          <BatchCard
            key={batch.id || batch.batch_id}
            batch={batch}
            onDeductionSuccess={onDeductionSuccess}
          />
        ))}
      </div>
    </section>
  );
}

export default function ProductionQueueSummary() {
  const { user } = useAuth();
  const defaultFrom = useMemo(() => todayDate(), []);
  const defaultTo = useMemo(() => addDays(defaultFrom, 14), [defaultFrom]);
  const [dateFrom, setDateFrom] = useState(defaultFrom);
  const [dateTo, setDateTo] = useState(defaultTo);
  const [tab, setTab] = useState('today');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const rangeDays = dateFrom && dateTo ? daysInclusive(dateFrom, dateTo) : null;
  const rangeInvalid = Boolean(!dateFrom || !dateTo || dateTo < dateFrom || rangeDays > 31);

  const { data, isLoading, isError, error, isFetching, refetch } = useQuery({
    queryKey: ['admin-production-queue-summary', dateFrom, dateTo],
    queryFn: async () => {
      const res = await base44.functions.invoke('getAdminProductionQueueSummary', {
        date_from: dateFrom,
        date_to: dateTo,
        limit: 100,
      });
      const result = res?.data || res;
      if (result?.error) throw new Error(result.error);
      return result || { batches: [] };
    },
    enabled: user?.role === 'admin' && !rangeInvalid,
    staleTime: 60000,
  });

  if (user?.role !== 'admin') {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <p className="text-muted-foreground text-sm">Admin access required.</p>
      </div>
    );
  }

  const allBatches = data?.batches || [];
  const categoryOptions = uniqueOptions(allBatches, 'product_category');
  const statusOptions = uniqueOptions(allBatches, 'status');
  const filteredBatches = allBatches.filter(batch => {
    if (categoryFilter !== 'all' && batch.product_category !== categoryFilter) return false;
    if (statusFilter !== 'all' && batch.status !== statusFilter) return false;
    return getBatchTab(batch, defaultFrom) === tab;
  });
  const groupedBatches = groupByProductionDate(filteredBatches);
  const sortedDates = Object.keys(groupedBatches).sort((a, b) => {
    if (a === 'unscheduled') return 1;
    if (b === 'unscheduled') return -1;
    return a.localeCompare(b);
  });
  const totalNeeded = filteredBatches.reduce((total, batch) => total + (Number(batch.planned_units) || 0), 0);

  const tabs = [
    { id: 'today', label: 'Today & Upcoming' },
    { id: 'in_progress', label: 'In Progress' },
    { id: 'verify', label: 'Needs Verification' },
    { id: 'history', label: 'History' },
  ];

  return (
    <div className="min-h-screen bg-background pb-10">
      <div className="bg-primary px-4 pt-10 pb-5">
        <Link to="/admin/operations" className="w-9 h-9 bg-white/20 rounded-full flex items-center justify-center mb-3">
          <ArrowLeft className="w-4 h-4 text-white" />
        </Link>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="font-heading text-2xl font-bold text-primary-foreground">Production Queue</h1>
            <p className="text-primary-foreground/70 text-xs mt-0.5">Hub production summary with gated inventory actions</p>
          </div>
          <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-white/20 text-white">Ops v1</span>
        </div>
      </div>

      <div className="px-4 mt-4 space-y-4">
        <div className="rounded-xl border border-border/50 bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-primary" />
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Production date range</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">From</span>
              <input
                type="date"
                value={dateFrom}
                onChange={event => setDateFrom(event.target.value)}
                className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">To</span>
              <input
                type="date"
                value={dateTo}
                onChange={event => setDateTo(event.target.value)}
                className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </label>
          </div>
          {rangeInvalid ? (
            <p className="text-xs text-destructive">Choose a valid production date range of 31 days or fewer.</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Showing production batches from {formatDate(dateFrom)} through {formatDate(dateTo)}.
            </p>
          )}
          <p className="text-[10px] text-muted-foreground">
            Hub data · Inventory deduction is preview-first and remains blocked unless the Hub gates allow the exact batch.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-border/50 bg-card p-3">
            <Package className="w-4 h-4 text-primary mb-1" />
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Batches</p>
            <p className="text-lg font-bold">{filteredBatches.length}</p>
          </div>
          <div className="rounded-xl border border-border/50 bg-card p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Needed</p>
            <p className="text-lg font-bold">{totalNeeded}</p>
            <p className="text-[10px] text-muted-foreground">units</p>
          </div>
          <div className="rounded-xl border border-border/50 bg-card p-3">
            <RefreshCw className={`w-4 h-4 text-primary mb-1 ${isFetching ? 'animate-spin' : ''}`} />
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Status</p>
            <p className="text-xs font-semibold">{isFetching ? 'Refreshing' : data?.truncated ? 'Truncated' : 'Current'}</p>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex gap-0 border-b overflow-x-auto scrollbar-none -mx-4 px-4 sm:mx-0 sm:px-0">
            {tabs.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`shrink-0 whitespace-nowrap px-3 py-2.5 text-xs sm:text-sm font-medium border-b-2 transition-colors ${
                  tab === item.id
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Category</span>
              <select
                value={categoryFilter}
                onChange={event => setCategoryFilter(event.target.value)}
                className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="all">All</option>
                {categoryOptions.map(category => (
                  <option key={category} value={category}>{formatLabel(category)}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Status</span>
              <select
                value={statusFilter}
                onChange={event => setStatusFilter(event.target.value)}
                className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="all">All</option>
                {statusOptions.map(status => (
                  <option key={status} value={status}>{formatLabel(status)}</option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : isError ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
            <p className="text-sm font-semibold text-destructive">Unable to load production queue summary</p>
            <p className="text-xs text-muted-foreground mt-1">{error?.message || 'Try again later.'}</p>
          </div>
        ) : !rangeInvalid && allBatches.length === 0 ? (
          <div className="rounded-xl border border-border/50 bg-card p-8 text-center">
            <p className="text-sm font-semibold text-foreground">No upcoming production scheduled</p>
            <p className="text-xs text-muted-foreground mt-1">This date range has no Hub production queue summary yet.</p>
          </div>
        ) : !rangeInvalid && filteredBatches.length === 0 ? (
          <div className="rounded-xl border border-border/50 bg-card p-8 text-center">
            <p className="text-sm font-semibold text-foreground">No production batches match this view</p>
            <p className="text-xs text-muted-foreground mt-1">Try another Hub production tab, category, or status filter.</p>
          </div>
        ) : !rangeInvalid ? (
          <div className="space-y-6">
            {data?.truncated && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                Results are capped at 100 batches. Narrow the date range for a complete view.
              </p>
            )}
            {sortedDates.map(date => (
              <ProductionDateSection
                key={date}
                date={date}
                batches={groupedBatches[date]}
                today={defaultFrom}
                onDeductionSuccess={refetch}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
