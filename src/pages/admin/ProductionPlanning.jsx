import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  FlaskConical,
  Package,
  RefreshCw,
} from 'lucide-react';
import { AdminStatusLegend, AdminStatusPill } from '@/components/admin/AdminStatusPill';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';

const MAX_RANGE_DAYS = 31;
const presetOptions = [
  { value: 'today', label: 'Today' },
  { value: 'this_week', label: 'This Week' },
  { value: 'next_7_days', label: 'Next 7 Days' },
];

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

function daysInclusive(from, to) {
  if (!from || !to) return 0;
  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T00:00:00.000Z`);
  return Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) + 1;
}

function formatDate(value) {
  if (!value) return 'Date pending';
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return value;
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatDateTime(value) {
  if (!value) return null;
  try {
    return new Date(value).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return value;
  }
}

function formatNumber(value, maximumFractionDigits = 2) {
  const number = Number(value || 0);
  return number.toLocaleString(undefined, { maximumFractionDigits });
}

function formatLabel(value) {
  if (!value) return 'Not set';
  return value
    .toString()
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function validateRange(from, to) {
  if (!from || !to) return 'Choose a start and end date.';
  if (to < from) return 'End date must be on or after start date.';
  if (daysInclusive(from, to) > MAX_RANGE_DAYS) return `Date range must be ${MAX_RANGE_DAYS} days or fewer.`;
  return null;
}

function StatCard({ icon: Icon, label, value, sublabel, tone = 'default', isRefreshing }) {
  const toneClass = {
    default: 'border-border/50 bg-card',
    warning: 'border-amber-100 bg-amber-50/60',
    danger: 'border-red-100 bg-red-50/60',
    info: 'border-blue-100 bg-blue-50/60',
  }[tone] || 'border-border/50 bg-card';

  return (
    <div className={`rounded-xl border p-3 ${toneClass}`}>
      {Icon && <Icon className={`w-4 h-4 text-primary mb-1 ${isRefreshing ? 'animate-spin' : ''}`} />}
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</p>
      <p className="text-lg font-bold text-foreground">{value ?? 0}</p>
      {sublabel && <p className="text-[10px] text-muted-foreground">{sublabel}</p>}
    </div>
  );
}

function StatusBadge({ status }) {
  const label = status === 'short' ? 'Procurement Needed' : formatLabel(status);
  const tone = status === 'short' ? 'warning' : undefined;
  return <AdminStatusPill value={status} label={label} tone={tone} size="md" />;
}

function ProductGroupList({ groups }) {
  if (!Array.isArray(groups) || groups.length === 0) {
    return <p className="text-xs text-muted-foreground">No product groups returned for this date.</p>;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
      {groups.map(group => (
        <div
          key={`${group.product_name || 'product'}-${group.product_category || 'category'}`}
          className="rounded-lg border border-border/50 bg-background p-3"
        >
          <p className="text-sm font-semibold text-foreground">{group.product_name || 'Unnamed product'}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{group.product_category || 'Uncategorized'}</p>
          <div className="grid grid-cols-3 gap-2 mt-3">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Planned</p>
              <p className="text-xs font-bold">{formatNumber(group.planned_units, 0)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Produced</p>
              <p className="text-xs font-bold">{formatNumber(group.produced_units, 0)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Batches</p>
              <p className="text-xs font-bold">{formatNumber(group.batch_count, 0)}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function DateGroup({ group }) {
  return (
    <section className="rounded-xl border border-border/50 bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Production Date</p>
          <h2 className="text-sm font-bold text-foreground mt-0.5">{formatDate(group.production_date)}</h2>
        </div>
        <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-secondary text-secondary-foreground border border-border/50">
          Read-only planning
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <StatCard label="Batches" value={formatNumber(group.batch_count, 0)} />
        <StatCard label="Planned Units" value={formatNumber(group.planned_units, 0)} />
        <StatCard label="Produced Units" value={formatNumber(group.produced_units, 0)} />
        <StatCard label="Ingredients" value={formatNumber(group.ingredient_count, 0)} />
        <StatCard label="Shortages" value={formatNumber(group.shortage_count, 0)} tone={Number(group.shortage_count || 0) > 0 ? 'danger' : 'default'} />
      </div>

      <ProductGroupList groups={group.product_groups} />
    </section>
  );
}

function IngredientTable({ ingredients }) {
  return (
    <div className="hidden lg:block bg-card border border-border rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Ingredient</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Required</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Available</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Procurement Need</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Source Products</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Production Dates</th>
            </tr>
          </thead>
          <tbody>
            {ingredients.map(item => (
              <tr key={`${item.ingredient || 'ingredient'}-${item.unit || 'unit'}`} className="border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors align-top">
                <td className="px-4 py-3.5 font-medium text-foreground">{item.ingredient || 'Unnamed ingredient'}</td>
                <td className="px-4 py-3.5 text-muted-foreground">{formatNumber(item.required_quantity)} {item.unit || ''}</td>
                <td className="px-4 py-3.5 text-muted-foreground">{item.available_stock === null ? 'No data' : `${formatNumber(item.available_stock)} ${item.unit || ''}`}</td>
                <td className="px-4 py-3.5 text-muted-foreground">{formatNumber(item.shortage_amount)} {item.unit || ''}</td>
                <td className="px-4 py-3.5"><StatusBadge status={item.status} /></td>
                <td className="px-4 py-3.5 text-muted-foreground max-w-[220px]">{(item.source_products || []).join(', ') || '-'}</td>
                <td className="px-4 py-3.5 text-muted-foreground max-w-[180px]">{(item.production_dates || []).map(formatDate).join(', ') || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function IngredientCards({ ingredients }) {
  return (
    <div className="lg:hidden space-y-3">
      {ingredients.map(item => (
        <div key={`${item.ingredient || 'ingredient'}-${item.unit || 'unit'}`} className="bg-card border border-border rounded-xl p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-semibold text-foreground text-sm">{item.ingredient || 'Unnamed ingredient'}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{item.unit || 'Unit pending'}</p>
            </div>
            <StatusBadge status={item.status} />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg bg-secondary/50 p-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Required</p>
              <p className="text-xs font-bold">{formatNumber(item.required_quantity)}</p>
            </div>
            <div className="rounded-lg bg-secondary/50 p-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Available</p>
              <p className="text-xs font-bold">{item.available_stock === null ? 'No data' : formatNumber(item.available_stock)}</p>
            </div>
            <div className="rounded-lg bg-secondary/50 p-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Shortage</p>
              <p className="text-xs font-bold">{formatNumber(item.shortage_amount)}</p>
            </div>
          </div>

          <div className="space-y-1.5 pt-2 border-t border-border/30">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Source Products</p>
            <p className="text-xs text-foreground">{(item.source_products || []).join(', ') || '-'}</p>
          </div>
          <div className="space-y-1.5">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Production Dates</p>
            <p className="text-xs text-foreground">{(item.production_dates || []).map(formatDate).join(', ') || '-'}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ProductionPlanning() {
  const { user } = useAuth();
  const today = useMemo(() => todayDate(), []);
  const [preset, setPreset] = useState('next_7_days');
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(addDays(today, 6));
  const [appliedDateFrom, setAppliedDateFrom] = useState(today);
  const [appliedDateTo, setAppliedDateTo] = useState(addDays(today, 6));
  const isCustom = preset === 'custom';
  const rangeError = validateRange(dateFrom, dateTo);
  const requestDateFrom = isCustom ? appliedDateFrom : null;
  const requestDateTo = isCustom ? appliedDateTo : null;

  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ['admin-production-planning-summary', preset, requestDateFrom, requestDateTo],
    queryFn: async () => {
      const payload = isCustom
        ? { preset: 'custom', date_from: appliedDateFrom, date_to: appliedDateTo }
        : { preset };
      const res = await base44.functions.invoke('getAdminProductionPlanningSummary', payload);
      const result = res?.data || res;
      if (result?.error) throw new Error(result.error);
      return result || { summary: {}, dates: [], ingredients: [] };
    },
    enabled: user?.role === 'admin',
    staleTime: 60000,
  });

  if (user?.role !== 'admin') {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <p className="text-muted-foreground text-sm">Admin access required.</p>
      </div>
    );
  }

  const summary = data?.summary || {};
  const dateGroups = data?.dates || [];
  const ingredients = data?.ingredients || [];
  const hasResults = dateGroups.length > 0 || ingredients.length > 0;
  const showError = isError && !data && !isFetching;
  const contextLabel = (() => {
    if (isCustom) {
      const hasCurrentResponse = data?.date_from === appliedDateFrom && data?.date_to === appliedDateTo;
      const from = hasCurrentResponse ? data.date_from : appliedDateFrom;
      const to = hasCurrentResponse ? data.date_to : appliedDateTo;
      return `${formatDate(from)} - ${formatDate(to)}`;
    }
    if (data?.date_from && data?.date_to) {
      return `${formatDate(data.date_from)} - ${formatDate(data.date_to)}`;
    }
    return presetOptions.find(option => option.value === preset)?.label || 'Next 7 Days';
  })();

  return (
    <div className="min-h-screen bg-background pb-10">
      <div className="bg-primary px-4 pt-10 pb-5">
        <Link to="/admin/operations" className="w-9 h-9 bg-white/20 rounded-full flex items-center justify-center mb-3">
          <ArrowLeft className="w-4 h-4 text-white" />
        </Link>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="font-heading text-2xl font-bold text-primary-foreground">Production Planning</h1>
            <p className="text-primary-foreground/70 text-xs mt-0.5">Read-only ingredient demand</p>
          </div>
          <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-white/20 text-white">Read-only</span>
        </div>
      </div>

      <div className="px-4 mt-4 space-y-4">
        <div className="rounded-xl border border-border/50 bg-card p-4 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-primary" />
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Planning date range</p>
                <p className="text-xs font-semibold text-foreground mt-0.5">{contextLabel}</p>
                <AdminStatusLegend className="mt-2" />
              </div>
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Generated</p>
              <p className="text-xs text-foreground">{formatDateTime(data?.generated_at) || 'Pending'}</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {presetOptions.map(option => (
              <button
                key={option.value}
                type="button"
                onClick={() => setPreset(option.value)}
                className={`h-9 px-3 rounded-lg border text-xs font-semibold transition-colors ${
                  preset === option.value
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background text-muted-foreground border-border hover:text-foreground'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Custom From</span>
              <input
                type="date"
                value={dateFrom}
                onChange={event => setDateFrom(event.target.value)}
                className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Custom To</span>
              <input
                type="date"
                value={dateTo}
                onChange={event => setDateTo(event.target.value)}
                className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
              />
            </label>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              disabled={Boolean(rangeError)}
              onClick={() => {
                if (rangeError) return;
                setAppliedDateFrom(dateFrom);
                setAppliedDateTo(dateTo);
                setPreset('custom');
              }}
              className={`h-9 px-3 rounded-lg border text-xs font-semibold transition-colors ${
                rangeError
                  ? 'bg-muted text-muted-foreground border-border cursor-not-allowed'
                  : preset === 'custom' && appliedDateFrom === dateFrom && appliedDateTo === dateTo
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background text-muted-foreground border-border hover:text-foreground'
              }`}
            >
              Apply Range
            </button>
          </div>

          {rangeError && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              {rangeError}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-6 gap-2">
          <StatCard icon={CalendarDays} label="Production Dates" value={formatNumber(summary.production_date_count, 0)} isRefreshing={isFetching} />
          <StatCard icon={Package} label="Batches" value={formatNumber(summary.batch_count, 0)} />
          <StatCard label="Planned Units" value={formatNumber(summary.planned_units, 0)} />
          <StatCard icon={FlaskConical} label="Ingredients" value={formatNumber(summary.ingredient_count, 0)} />
          <StatCard icon={AlertTriangle} label="Procurement Needs" value={formatNumber(summary.shortage_count, 0)} tone={Number(summary.shortage_count || 0) > 0 ? 'danger' : 'default'} />
          <StatCard
            icon={RefreshCw}
            label="Missing Recipes / Yields"
            value={formatNumber((Number(summary.missing_recipe_count) || 0) + (Number(summary.missing_yield_count) || 0), 0)}
            sublabel={`${formatNumber(summary.missing_recipe_count, 0)} recipes · ${formatNumber(summary.missing_yield_count, 0)} yields`}
          />
        </div>

        <div className="rounded-xl border border-border/50 bg-card p-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-foreground">Hub Production Planning view</p>
            <p className="text-[10px] text-muted-foreground">Read-only production batch demand and ingredient coverage. Make-to-order shortfalls are procurement needs, not inventory deduction approval.</p>
          </div>
          <RefreshCw className={`w-4 h-4 text-primary ${isFetching ? 'animate-spin' : ''}`} />
        </div>

        {showError && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
            <p className="text-sm font-semibold text-destructive">Unable to load production planning summary</p>
            <p className="text-xs text-muted-foreground mt-1">{error?.message || 'Try again later.'}</p>
          </div>
        )}

        {data?.truncated && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
            Results are capped. Narrow the date range for a more complete planning view.
          </p>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : !showError && !hasResults ? (
          <div className="rounded-xl border border-border/50 bg-card p-8 text-center">
            <p className="text-sm font-semibold text-foreground">No production planning demand found</p>
            <p className="text-xs text-muted-foreground mt-1">Try another preset or a valid custom date range.</p>
          </div>
        ) : !showError ? (
          <div className="space-y-5">
            <section className="space-y-3">
              <div>
                <h2 className="text-sm font-bold text-foreground">Date-Grouped Production Summary</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Grouped production demand without raw batch records or order sources</p>
              </div>
              {dateGroups.length > 0 ? (
                <div className="space-y-3">
                  {dateGroups.map(group => (
                    <DateGroup key={group.production_date || 'date-pending'} group={group} />
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-border/50 bg-card p-4 text-xs text-muted-foreground">
                  No date groups returned for this range.
                </div>
              )}
            </section>

            <section className="space-y-3">
              <div>
                <h2 className="text-sm font-bold text-foreground">Ingredient Demand</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Sanitized ingredient requirements, stock coverage, and make-to-order procurement needs. No inventory is deducted here.</p>
              </div>
              {ingredients.length > 0 ? (
                <>
                  <IngredientTable ingredients={ingredients} />
                  <IngredientCards ingredients={ingredients} />
                </>
              ) : (
                <div className="rounded-xl border border-border/50 bg-card p-4 text-xs text-muted-foreground">
                  No ingredient demand rows returned for this range.
                </div>
              )}
            </section>
          </div>
        ) : null}
      </div>
    </div>
  );
}
