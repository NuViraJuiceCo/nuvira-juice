import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  CalendarDays,
  ClipboardList,
  Package,
  RefreshCw,
  Search,
  ShieldCheck,
  Truck,
} from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';

const MAX_RANGE_DAYS = 31;
const presetOptions = [
  { value: 'current_month', label: 'Current Month' },
  { value: 'next_30_days', label: 'Next 30 Days' },
  { value: 'today', label: 'Today' },
];

function todayDate() {
  const today = new Date();
  const year = today.getFullYear();
  const month = `${today.getMonth() + 1}`.padStart(2, '0');
  const day = `${today.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function firstDayOfMonth(dateStr) {
  return `${dateStr.slice(0, 7)}-01`;
}

function lastDayOfMonth(dateStr) {
  const [year, month] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
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

function formatTime(value) {
  if (!value) return null;
  try {
    return new Date(value).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return null;
  }
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
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

function chipClass(typeOrStatus) {
  const key = (typeOrStatus || '').toString().toLowerCase();
  if (key === 'event' || key === 'scheduled' || key === 'active') return 'bg-blue-50 text-blue-700 border-blue-100';
  if (key === 'production' || key === 'completed' || key === 'complete') return 'bg-emerald-50 text-emerald-700 border-emerald-100';
  if (key === 'delivery' || key === 'pending') return 'bg-amber-50 text-amber-800 border-amber-100';
  if (key === 'compliance') return 'bg-purple-50 text-purple-700 border-purple-100';
  if (key === 'cancelled' || key === 'canceled') return 'bg-red-50 text-red-700 border-red-100';
  return 'bg-secondary text-secondary-foreground border-border/50';
}

function TypeChip({ label }) {
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full border text-[10px] font-semibold ${chipClass(label)}`}>
      {formatLabel(label)}
    </span>
  );
}

function StatCard({ icon: Icon, label, value, sublabel, isRefreshing }) {
  return (
    <div className="rounded-xl border border-border/50 bg-card p-3">
      {Icon && <Icon className={`w-4 h-4 text-primary mb-1 ${isRefreshing ? 'animate-spin' : ''}`} />}
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</p>
      <p className="text-lg font-bold text-foreground">{formatNumber(value)}</p>
      {sublabel && <p className="text-[10px] text-muted-foreground">{sublabel}</p>}
    </div>
  );
}

function CountList({ counts }) {
  const entries = Object.entries(counts || {}).filter(([, value]) => Number(value || 0) > 0);
  if (entries.length === 0) return <span className="text-muted-foreground">None returned</span>;
  return entries.map(([label, value]) => `${formatLabel(label)}: ${formatNumber(value)}`).join(' · ');
}

function EventCard({ item }) {
  const startTime = formatTime(item.start_datetime);
  const endTime = formatTime(item.end_datetime);
  return (
    <div className="rounded-lg border border-border/50 bg-background p-3 space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 mb-1">
            <TypeChip label="event" />
            {item.status && <TypeChip label={item.status} />}
          </div>
          <h3 className="text-sm font-semibold text-foreground">{item.title || 'Event'}</h3>
          <p className="text-xs text-muted-foreground">{item.event_type || 'Event type pending'}</p>
        </div>
        <p className="text-xs font-semibold text-foreground whitespace-nowrap">
          {startTime && endTime ? `${startTime} - ${endTime}` : formatDate(item.start_datetime)}
        </p>
      </div>
      {item.location && <p className="text-xs text-muted-foreground">Location: {item.location}</p>}
      {item.summary && <p className="text-xs text-muted-foreground leading-relaxed">{item.summary}</p>}
    </div>
  );
}

function ProductionCard({ item }) {
  return (
    <div className="rounded-lg border border-border/50 bg-background p-3 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="mb-1"><TypeChip label="production" /></div>
          <h3 className="text-sm font-semibold text-foreground">Production Summary</h3>
          <p className="text-xs text-muted-foreground">{formatDate(item.production_date)}</p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <StatCard label="Batches" value={item.batch_count} />
        <StatCard label="Products" value={item.product_count} />
        <StatCard label="Planned" value={item.planned_units} />
      </div>
      <p className="text-xs text-muted-foreground">Status counts: <CountList counts={item.status_counts} /></p>
    </div>
  );
}

function DeliveryCard({ item }) {
  return (
    <div className="rounded-lg border border-border/50 bg-background p-3 space-y-3">
      <div>
        <div className="mb-1"><TypeChip label="delivery" /></div>
        <h3 className="text-sm font-semibold text-foreground">Delivery Summary</h3>
        <p className="text-xs text-muted-foreground">{formatDate(item.delivery_date)}</p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <StatCard label="Stops" value={item.stop_count} />
        <StatCard label="Completed" value={item.completed_count} />
        <StatCard label="Pending" value={item.pending_count} />
      </div>
      <p className="text-xs text-muted-foreground">Source types: <CountList counts={item.source_type_counts} /></p>
    </div>
  );
}

function CalendarItem({ item }) {
  if (item.type === 'event') return <EventCard item={item} />;
  if (item.type === 'production') return <ProductionCard item={item} />;
  if (item.type === 'delivery') return <DeliveryCard item={item} />;
  return null;
}

function DateGroup({ group }) {
  return (
    <section className="rounded-xl border border-border/50 bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Schedule Date</p>
          <h2 className="text-sm font-bold text-foreground mt-0.5">{formatDate(group.date)}</h2>
        </div>
        <div className="flex flex-wrap gap-1.5 justify-end">
          {Number(group.counts?.events || 0) > 0 && <TypeChip label={`${group.counts.events} events`} />}
          {Number(group.counts?.production || 0) > 0 && <TypeChip label={`${group.counts.production} production`} />}
          {Number(group.counts?.delivery || 0) > 0 && <TypeChip label={`${group.counts.delivery} delivery`} />}
          {Number(group.counts?.compliance || 0) > 0 && <TypeChip label={`${group.counts.compliance} compliance`} />}
        </div>
      </div>

      {Array.isArray(group.items) && group.items.length > 0 ? (
        <div className="space-y-2">
          {group.items.map((item, index) => (
            <CalendarItem key={`${group.date}-${item.type}-${item.id || index}`} item={item} />
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No schedule items returned for this date.</p>
      )}
    </section>
  );
}

function MonthGrid({ dates }) {
  if (!Array.isArray(dates) || dates.length === 0) {
    return (
      <div className="rounded-xl border border-border/50 bg-card p-8 text-center">
        <p className="text-sm font-semibold text-foreground">No calendar items to place on the month grid</p>
        <p className="text-xs text-muted-foreground mt-1">Try another preset or a valid custom range.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
      {dates.map(group => (
        <div key={group.date} className="rounded-xl border border-border/50 bg-card p-3 min-h-[120px]">
          <p className="text-xs font-bold text-foreground">{formatDate(group.date)}</p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {Number(group.counts?.events || 0) > 0 && <TypeChip label={`${group.counts.events} events`} />}
            {Number(group.counts?.production || 0) > 0 && <TypeChip label={`${group.counts.production} production`} />}
            {Number(group.counts?.delivery || 0) > 0 && <TypeChip label={`${group.counts.delivery} delivery`} />}
            {Number(group.counts?.compliance || 0) > 0 && <TypeChip label={`${group.counts.compliance} compliance`} />}
          </div>
          <p className="text-[10px] text-muted-foreground mt-3">
            {(group.items || []).length} read-only item{(group.items || []).length === 1 ? '' : 's'}
          </p>
        </div>
      ))}
    </div>
  );
}

export default function Calendar() {
  const { user } = useAuth();
  const today = useMemo(() => todayDate(), []);
  const [preset, setPreset] = useState('current_month');
  const [dateFrom, setDateFrom] = useState(firstDayOfMonth(today));
  const [dateTo, setDateTo] = useState(lastDayOfMonth(today));
  const [appliedDateFrom, setAppliedDateFrom] = useState(firstDayOfMonth(today));
  const [appliedDateTo, setAppliedDateTo] = useState(lastDayOfMonth(today));
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [viewMode, setViewMode] = useState('agenda');
  const isCustom = preset === 'custom';
  const rangeError = validateRange(dateFrom, dateTo);
  const requestDateFrom = isCustom ? appliedDateFrom : null;
  const requestDateTo = isCustom ? appliedDateTo : null;

  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ['admin-calendar-events-summary', preset, requestDateFrom, requestDateTo, typeFilter, statusFilter, search],
    queryFn: async () => {
      const payload = {
        limit: 200,
      };
      if (isCustom) {
        payload.preset = 'custom';
        payload.date_from = appliedDateFrom;
        payload.date_to = appliedDateTo;
      } else {
        payload.preset = preset;
      }
      if (search.trim()) payload.search = search.trim();
      if (typeFilter !== 'all') payload.type = typeFilter;
      if (statusFilter !== 'all') payload.status = statusFilter;

      const res = await base44.functions.invoke('getAdminCalendarEventsSummary', payload);
      const result = res?.data || res;
      if (result?.error) throw new Error(result.error);
      return result || { summary: {}, dates: [] };
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
  const dates = data?.dates || [];
  const hasResults = dates.length > 0;
  const hasCompliance = Number(summary.compliance_items || 0) > 0 || dates.some(group => Number(group.counts?.compliance || 0) > 0) || typeFilter === 'compliance';
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
    return presetOptions.find(option => option.value === preset)?.label || 'Current Month';
  })();

  return (
    <div className="min-h-screen bg-background pb-10">
      <div className="bg-primary px-4 pt-10 pb-5">
        <Link to="/admin/operations" className="w-9 h-9 bg-white/20 rounded-full flex items-center justify-center mb-3">
          <ArrowLeft className="w-4 h-4 text-white" />
        </Link>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="font-heading text-2xl font-bold text-primary-foreground">Calendar</h1>
            <p className="text-primary-foreground/70 text-xs mt-0.5">Read-only operations schedule</p>
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
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Calendar range</p>
                <p className="text-xs font-semibold text-foreground mt-0.5">{contextLabel}</p>
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

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
            <label className="relative lg:col-span-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                className="w-full h-10 rounded-lg border border-border bg-background pl-9 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder="Search schedule..."
                value={search}
                onChange={event => setSearch(event.target.value)}
              />
            </label>
            <select
              value={typeFilter}
              onChange={event => setTypeFilter(event.target.value)}
              className="h-10 rounded-lg border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="all">All Types</option>
              <option value="event">Events</option>
              <option value="production">Production</option>
              <option value="delivery">Delivery</option>
              {hasCompliance && <option value="compliance">Compliance</option>}
            </select>
            <select
              value={statusFilter}
              onChange={event => setStatusFilter(event.target.value)}
              className="h-10 rounded-lg border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="all">All Statuses</option>
              <option value="scheduled">Scheduled</option>
              <option value="active">Active</option>
              <option value="pending">Pending</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
          <StatCard icon={ClipboardList} label="Total Items" value={summary.total_items} isRefreshing={isFetching} />
          <StatCard icon={CalendarDays} label="Events" value={summary.events} />
          <StatCard icon={Package} label="Production Days" value={summary.production_days} />
          <StatCard icon={Truck} label="Delivery Days" value={summary.delivery_days} />
          <StatCard icon={ShieldCheck} label="Compliance Items" value={summary.compliance_items} />
        </div>

        <div className="rounded-xl border border-border/50 bg-card p-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-foreground">Hub Calendar view</p>
            <p className="text-[10px] text-muted-foreground">Read-only schedule visibility. Event, production, delivery, and order actions are not available here.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setViewMode('agenda')}
              className={`h-8 px-3 rounded-lg border text-xs font-semibold ${
                viewMode === 'agenda' ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-muted-foreground border-border'
              }`}
            >
              Agenda
            </button>
            <button
              type="button"
              onClick={() => setViewMode('month')}
              className={`h-8 px-3 rounded-lg border text-xs font-semibold ${
                viewMode === 'month' ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-muted-foreground border-border'
              }`}
            >
              Month
            </button>
            <RefreshCw className={`w-4 h-4 text-primary ${isFetching ? 'animate-spin' : ''}`} />
          </div>
        </div>

        {showError && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
            <p className="text-sm font-semibold text-destructive">Unable to load calendar summary</p>
            <p className="text-xs text-muted-foreground mt-1">{error?.message || 'Try again later.'}</p>
          </div>
        )}

        {data?.truncated && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
            Results are capped. Narrow the date range or filters for a more complete calendar view.
          </p>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : !showError && !hasResults ? (
          <div className="rounded-xl border border-border/50 bg-card p-8 text-center">
            <p className="text-sm font-semibold text-foreground">No schedule items found</p>
            <p className="text-xs text-muted-foreground mt-1">Try another preset, filter, or valid custom date range.</p>
          </div>
        ) : !showError && viewMode === 'month' ? (
          <MonthGrid dates={dates} />
        ) : !showError ? (
          <div className="space-y-3">
            {dates.map(group => (
              <DateGroup key={group.date} group={group} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
