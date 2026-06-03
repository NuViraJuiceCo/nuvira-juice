import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import AdminOpsHeader from '@/components/admin/AdminOpsHeader';
import {
  AlertTriangle,
  CalendarDays,
  FlaskConical,
  Package,
  RefreshCw,
} from 'lucide-react';
import { AdminStatusLegend, AdminStatusPill } from '@/components/admin/AdminStatusPill';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import May30ReadinessPanel from '@/components/admin/May30ReadinessPanel';
import May30EventStockPlanPanel from '@/components/admin/May30EventStockPlanPanel';

const MAX_RANGE_DAYS = 31;
const presetOptions = [
  { value: 'today', label: 'Today' },
  { value: 'this_week', label: 'This Week' },
  { value: 'next_7_days', label: 'Next 7 Days' },
];

const planningReadinessItems = [
  {
    label: 'Product demand',
    status: 'ready',
    detail: 'Date groups show Hub batches plus accepted native May 30 order mirror demand.',
  },
  {
    label: 'Ingredient demand',
    status: 'ready',
    detail: 'Recipe-derived ingredient rows show quantity, stock coverage, and source dates without deducting stock.',
  },
  {
    label: 'Procurement model',
    status: 'ready',
    detail: 'Make-to-order shortfalls are marked as procurement needs, not fatal blockers or automatic purchase orders.',
  },
  {
    label: 'Production handoff',
    status: 'fallback',
    detail: 'Use Production Queue for preview-first start, complete, verify, ingredient correction, and post-verify task packing.',
  },
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
  if (!value || value === 'date_pending') return 'Date pending';
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

function formatQuantity(value, unit, maximumFractionDigits = 2) {
  if (value === null || value === undefined) return null;
  const unitText = unit ? ` ${unit}` : '';
  return `${formatNumber(value, maximumFractionDigits)}${unitText}`;
}

function hasNativeYieldContext(item) {
  return ['customer_app_native', 'may30_pos_event_stock_plan', 'mixed_native_and_event_plan'].includes(item.source);
}

function procurementNeedLabel(item) {
  if (item.procurement_needed_quantity === null || item.procurement_needed_quantity === undefined) {
    if (!hasNativeYieldContext(item)) return 'Hub summary';
    if (item.procurement_basis === 'missing_yield') return 'Yield needed';
    if (item.procurement_basis === 'yield_missing_conversion') return 'Yield conversion needed';
    return 'Not available';
  }

  if (Number(item.procurement_needed_quantity) <= 0) return 'Covered';

  const quantityLabel = formatQuantity(item.procurement_needed_quantity, item.procurement_unit || 'units');
  const caseQuantity = Number(item.procurement_case_quantity || 0);
  if (caseQuantity > 0) {
    return `${quantityLabel} (${formatNumber(caseQuantity, 0)} case${caseQuantity === 1 ? '' : 's'})`;
  }
  return quantityLabel;
}

function yieldContextLabel(item) {
  if (!hasNativeYieldContext(item) && !item.yield_match_found) return 'Hub demand summary';
  if (!item.yield_match_found) return 'Missing yield';
  const parts = [
    item.oz_per_purchase_unit ? `${formatNumber(item.oz_per_purchase_unit)} oz/${item.purchase_unit || 'unit'}` : null,
    item.rounding_rule ? formatLabel(item.rounding_rule) : null,
    item.supplier || null,
  ].filter(Boolean);
  return parts.join(' · ') || 'Yield matched';
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

function draftIdPart(value) {
  return (value || 'pending')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'pending';
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

function sourceLabel(source) {
  if (source === 'customer_app_native') return 'Native Customer App';
  if (source === 'may30_pos_event_stock_plan') return 'May 30 POS Event Stock';
  if (source === 'mixed_native_and_event_plan') return 'Native + POS Event Stock';
  return 'Hub';
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
          <p className="text-xs text-muted-foreground mt-0.5">
            {[group.product_category || 'Uncategorized', group.source ? sourceLabel(group.source) : null]
              .filter(Boolean)
              .join(' · ')}
          </p>
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
              <p className="text-xs font-bold">{group.source === 'customer_app_native' || group.source === 'may30_pos_event_stock_plan' ? 'Plan' : formatNumber(group.batch_count, 0)}</p>
            </div>
          </div>
          {Number(group.source_order_count || 0) > 0 && (
            <p className="text-[10px] text-muted-foreground mt-2">
              {formatNumber(group.source_order_count, 0)} source order{Number(group.source_order_count) === 1 ? '' : 's'}
            </p>
          )}
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
          {group.source === 'customer_app_native'
            ? 'Native mirror'
            : group.source === 'may30_pos_event_stock_plan'
              ? 'POS event stock'
              : 'Read-only planning'}
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

function productionBatchDraftRows(dateGroups, ingredients) {
  const safeDateGroups = Array.isArray(dateGroups) ? dateGroups : [];
  const safeIngredients = Array.isArray(ingredients) ? ingredients : [];

  return safeDateGroups.flatMap(group => {
    const productionDate = group.production_date || 'date_pending';
    return (Array.isArray(group.product_groups) ? group.product_groups : []).map(product => {
      const productName = product.product_name || 'Unnamed product';
      const productKey = draftIdPart(productName);
      const matchingIngredients = safeIngredients.filter(item => {
        const dates = Array.isArray(item.production_dates) ? item.production_dates : [];
        const products = Array.isArray(item.source_products) ? item.source_products : [];
        return dates.includes(productionDate) && products.some(sourceProduct => draftIdPart(sourceProduct) === productKey);
      });
      const blockers = [];
      const warnings = [];
      if (productionDate === 'date_pending') blockers.push('production_date_required');
      if (Number(product.planned_units || 0) <= 0) blockers.push('planned_units_required');
      if (matchingIngredients.some(item => hasNativeYieldContext(item) && !item.yield_match_found)) warnings.push('ingredient_yield_review');
      if (matchingIngredients.some(item => item.status === 'short' || Number(item.procurement_needed_quantity || 0) > 0)) warnings.push('procurement_needed');
      if (matchingIngredients.some(item => item.status === 'no_data')) warnings.push('inventory_context_missing');

      return {
        proposed_batch_id: `DRAFT-${productionDate === 'date_pending' ? 'DATE-PENDING' : productionDate}-${productKey.toUpperCase()}`,
        product_name: productName,
        product_category: product.product_category || 'Product',
        production_date: productionDate,
        planned_units: Number(product.planned_units || 0),
        source_order_count: Number(product.source_order_count || 0),
        source: product.source || group.source || 'planning_summary',
        proposed_status: 'planned',
        ingredient_count: matchingIngredients.length,
        blockers,
        warnings,
      };
    });
  });
}

function ProductionBatchDraftCards({ dateGroups, ingredients }) {
  const drafts = productionBatchDraftRows(dateGroups, ingredients);
  if (drafts.length === 0) return null;

  const readyDrafts = drafts.filter(draft => draft.blockers.length === 0).length;
  const blockedDrafts = drafts.length - readyDrafts;

  return (
    <section className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-800">Native ProductionBatch drafts</p>
          <h2 className="text-sm font-bold text-emerald-950">Proposed batch records from planning demand</h2>
          <p className="text-xs text-emerald-900/80 mt-1">
            Read-only draft fields for the future native batch materialization step. No ProductionBatch, CommandLog, inventory, purchase order, notification, or Hub record is created here.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <AdminStatusPill label={`${readyDrafts} ready draft${readyDrafts === 1 ? '' : 's'}`} tone="native" />
          {blockedDrafts > 0 && <AdminStatusPill label={`${blockedDrafts} need review`} tone="warning" />}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {drafts.map(draft => (
          <div key={`${draft.proposed_batch_id}-${draft.product_name}`} className="rounded-lg border border-emerald-100 bg-white/80 p-3 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-bold text-emerald-950">{draft.product_name}</p>
                <p className="text-[10px] uppercase tracking-wider text-emerald-700">{draft.product_category}</p>
              </div>
              <AdminStatusPill
                label={draft.blockers.length > 0 ? 'Needs review' : 'Draft ready'}
                tone={draft.blockers.length > 0 ? 'warning' : 'native'}
              />
            </div>

            <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 p-2">
              <p className="text-[10px] uppercase tracking-wider text-emerald-800 font-semibold">Proposed batch id</p>
              <p className="text-xs font-mono text-emerald-950 break-all mt-0.5">{draft.proposed_batch_id}</p>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Status</p>
                <p className="font-bold text-foreground">{formatLabel(draft.proposed_status)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Production date</p>
                <p className="font-bold text-foreground">{formatDate(draft.production_date)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Planned units</p>
                <p className="font-bold text-foreground">{formatNumber(draft.planned_units, 0)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Source orders</p>
                <p className="font-bold text-foreground">{formatNumber(draft.source_order_count, 0)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Source</p>
                <p className="font-bold text-foreground">{sourceLabel(draft.source)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Ingredient rows</p>
                <p className="font-bold text-foreground">{formatNumber(draft.ingredient_count, 0)}</p>
              </div>
            </div>

            {(draft.blockers.length > 0 || draft.warnings.length > 0) && (
              <div className="space-y-1.5 border-t border-emerald-100 pt-2">
                {draft.blockers.map(blocker => (
                  <p key={`blocker-${blocker}`} className="text-[11px] text-amber-800 font-semibold">
                    Blocker: {formatLabel(blocker)}
                  </p>
                ))}
                {draft.warnings.map(warning => (
                  <p key={`warning-${warning}`} className="text-[11px] text-muted-foreground">
                    Watch: {formatLabel(warning)}
                  </p>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
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
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Source</th>
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
                <td className="px-4 py-3.5 text-muted-foreground">
                  <p>{formatNumber(item.shortage_amount)} {item.unit || ''}</p>
                  <p className="text-[10px] text-foreground font-semibold mt-1">Buy: {procurementNeedLabel(item)}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{yieldContextLabel(item)}</p>
                </td>
                <td className="px-4 py-3.5"><StatusBadge status={item.status} /></td>
                <td className="px-4 py-3.5 text-muted-foreground">{sourceLabel(item.source)}</td>
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

          <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-2">
            <p className="text-[10px] uppercase tracking-wider text-amber-800 font-semibold">Procurement Need</p>
            <p className="text-xs font-bold text-foreground mt-0.5">{procurementNeedLabel(item)}</p>
            <p className="text-[10px] text-muted-foreground mt-1">{yieldContextLabel(item)}</p>
          </div>

          <div className="space-y-1.5 pt-2 border-t border-border/30">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Source</p>
            <p className="text-xs text-foreground">{sourceLabel(item.source)}</p>
          </div>
          <div className="space-y-1.5">
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
  const nativeOverlay = data?.native_overlay || {};
  const eventStockPlan = nativeOverlay?.event_stock_plan || {};
  const warnings = Array.isArray(data?.warnings) ? data.warnings : [];
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
      <AdminOpsHeader
        title="Production Planning"
        subtitle="Read-only ingredient demand"
        badge="Read-only"
      />

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
                    ? 'bg-nuvira-gradient text-white border-primary'
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
                    ? 'bg-nuvira-gradient text-white border-primary'
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
            <p className="text-xs font-semibold text-foreground">Production Planning view</p>
            <p className="text-[10px] text-muted-foreground">Hub batch and ingredient coverage plus native May 30 order mirrors. Make-to-order shortfalls are procurement needs, not inventory deduction approval.</p>
            {Number(nativeOverlay.order_count || 0) > 0 && (
              <p className="text-[10px] text-emerald-700 mt-1">
                Native May 30 overlay: {formatNumber(nativeOverlay.order_count, 0)} order{Number(nativeOverlay.order_count) === 1 ? '' : 's'} · {formatNumber(nativeOverlay.planned_units, 0)} units · {formatNumber(nativeOverlay.ingredient_count, 0)} ingredient rows · read-only
              </p>
            )}
            {eventStockPlan.included && (
              <p className="text-[10px] text-fuchsia-700 mt-1">
                POS event stock plan included: {formatNumber(eventStockPlan.total_units, 0)} units across {formatNumber(eventStockPlan.event_count, 0)} events · target sell-out · read-only
              </p>
            )}
            {Number(nativeOverlay.built_in_fallback_recipe_count || 0) > 0 && (
              <p className="text-[10px] text-blue-700 mt-1">
                Built-in recipe fallback used for {formatNumber(nativeOverlay.built_in_fallback_recipe_count, 0)} product match{Number(nativeOverlay.built_in_fallback_recipe_count) === 1 ? '' : 'es'} where live Recipe master data was missing.
              </p>
            )}
            {Number(nativeOverlay.missing_recipe_count || 0) + Number(nativeOverlay.ambiguous_recipe_count || 0) + Number(nativeOverlay.missing_inventory_count || 0) + Number(nativeOverlay.missing_yield_count || 0) + Number(nativeOverlay.ambiguous_yield_count || 0) > 0 && (
              <p className="text-[10px] text-amber-700 mt-1">
                Native master-data gaps: {formatNumber(nativeOverlay.missing_recipe_count, 0)} missing recipes · {formatNumber(nativeOverlay.ambiguous_recipe_count, 0)} ambiguous recipes · {formatNumber(nativeOverlay.missing_inventory_count, 0)} missing inventory matches · {formatNumber(nativeOverlay.missing_yield_count, 0)} missing yields · {formatNumber(nativeOverlay.ambiguous_yield_count, 0)} ambiguous yields
              </p>
            )}
            {Number(nativeOverlay.skipped_missing_date_count || 0) > 0 && (
              <p className="text-[10px] text-blue-700 mt-1">
                Native orders needing date assignment: {formatNumber(nativeOverlay.skipped_missing_date_count, 0)}. These appear under Date pending so production and procurement demand stay visible.
              </p>
            )}
          </div>
          <RefreshCw className={`w-4 h-4 text-primary ${isFetching ? 'animate-spin' : ''}`} />
        </div>

        <May30ReadinessPanel
          title="Production planning visibility"
          description="This view is the planning layer: it tells operations what to make and what to procure before any production lifecycle action runs."
          items={planningReadinessItems}
          actions={[
            { label: 'Production Queue', to: '/admin/production-queue' },
            { label: 'Inventory Status', to: '/admin/inventory-status' },
            { label: 'Admin Orders', to: '/admin/orders' },
          ]}
        />

        <May30EventStockPlanPanel includedInPlanning={eventStockPlan.included === true} />

        <ProductionBatchDraftCards dateGroups={dateGroups} ingredients={ingredients} />

        {warnings.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            {warnings.includes('hub_production_planning_service_not_configured') || warnings.some(warning => warning?.startsWith?.('hub_production_planning_unavailable'))
              ? 'Hub production planning is unavailable, so this view is showing native Customer App order mirror demand only.'
              : 'Production planning returned warnings. Review native and Hub planning context before batching.'}
          </div>
        )}

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
                <p className="text-xs text-muted-foreground mt-0.5">Grouped production demand from Hub batches and accepted native May 30 order mirrors</p>
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
                <p className="text-xs text-muted-foreground mt-0.5">Sanitized ingredient requirements, stock coverage, and IngredientYield purchase-unit needs. No inventory is deducted and no purchase order is created here.</p>
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
