import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Package,
  RefreshCw,
  Search,
  ShieldCheck,
  Truck,
} from 'lucide-react';
import AdminOpsHeader from '@/components/admin/AdminOpsHeader';
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

function addDays(dateStr, days) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return [
    date.getFullYear(),
    `${date.getMonth() + 1}`.padStart(2, '0'),
    `${date.getDate()}`.padStart(2, '0'),
  ].join('-');
}

function addMonths(dateStr, months) {
  const [year, month] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, 1);
  date.setMonth(date.getMonth() + months);
  return [
    date.getFullYear(),
    `${date.getMonth() + 1}`.padStart(2, '0'),
    '01',
  ].join('-');
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

function formatMonthLabel(from, to) {
  if (!from || !to) return 'Calendar';
  const [fromYear, fromMonth] = from.split('-').map(Number);
  const [toYear, toMonth] = to.split('-').map(Number);
  const startLabel = new Date(fromYear, fromMonth - 1, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
  if (fromYear === toYear && fromMonth === toMonth) return startLabel;
  const endLabel = new Date(toYear, toMonth - 1, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
  return `${startLabel} - ${endLabel}`;
}

function dayOfWeek(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day).getDay();
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

function ComplianceCard({ item }) {
  return (
    <div className="rounded-lg border border-border/50 bg-background p-3 space-y-3">
      <div>
        <div className="mb-1"><TypeChip label="compliance" /></div>
        <h3 className="text-sm font-semibold text-foreground">Compliance Summary</h3>
        <p className="text-xs text-muted-foreground">{formatDate(item.compliance_date)}</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <StatCard label="Logs" value={item.log_count} />
        <StatCard label="Open Actions" value={item.open_corrective_action_count} />
      </div>
      <p className="text-xs text-muted-foreground">Log types: <CountList counts={item.status_counts} /></p>
    </div>
  );
}

function CalendarItem({ item }) {
  if (item.type === 'event') return <EventCard item={item} />;
  if (item.type === 'production') return <ProductionCard item={item} />;
  if (item.type === 'delivery') return <DeliveryCard item={item} />;
  if (item.type === 'compliance') return <ComplianceCard item={item} />;
  return null;
}

function groupLookup(dates) {
  return new Map((dates || []).map(group => [group.date, group]));
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

function CalendarCell({ cell, selectedDate, onSelectDate }) {
  const group = cell.group;
  const items = group?.items || [];
  const hasItems = items.length > 0;
  const isSelected = cell.date === selectedDate;
  const today = todayDate();
  const isToday = cell.date === today;

  return (
    <button
      type="button"
      disabled={!cell.inRange}
      onClick={() => onSelectDate(cell.date)}
      className={`min-h-[112px] rounded-xl border p-2 text-left transition ${
        !cell.inRange
          ? 'border-transparent bg-muted/20 opacity-40'
          : isSelected
            ? 'border-primary bg-primary/10 shadow-sm'
            : hasItems
              ? 'border-cyan-300 bg-cyan-50/70 hover:border-primary'
              : 'border-border/60 bg-card hover:border-primary/60'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className={`text-xs font-black ${isSelected ? 'text-primary' : 'text-foreground'}`}>
            {cell.dayNumber}
          </p>
          {isToday && (
            <span className="mt-0.5 inline-flex rounded-full bg-emerald-500 px-1.5 py-0.5 text-[9px] font-black text-emerald-950">
              Today
            </span>
          )}
        </div>
        {hasItems && (
          <span className="rounded-full bg-slate-950 px-1.5 py-0.5 text-[9px] font-black text-white">
            {items.length}
          </span>
        )}
      </div>

      {cell.inRange && (
        <div className="mt-2 flex flex-wrap gap-1">
          {Number(group?.counts?.events || 0) > 0 && <TypeChip label={`${group.counts.events} event`} />}
          {Number(group?.counts?.production || 0) > 0 && <TypeChip label={`${group.counts.production} production`} />}
          {Number(group?.counts?.delivery || 0) > 0 && <TypeChip label={`${group.counts.delivery} delivery`} />}
          {Number(group?.counts?.compliance || 0) > 0 && <TypeChip label={`${group.counts.compliance} compliance`} />}
        </div>
      )}

      {cell.inRange && hasItems && (
        <div className="mt-2 space-y-1">
          {items.slice(0, 2).map((item, index) => (
            <p key={`${item.type}-${item.id || index}`} className="truncate text-[10px] font-semibold text-muted-foreground">
              {formatLabel(item.type)} · {item.title || item.batch_id || item.product_name || item.order_number || 'Scheduled'}
            </p>
          ))}
          {items.length > 2 && (
            <p className="text-[10px] font-semibold text-primary">+{items.length - 2} more</p>
          )}
        </div>
      )}
    </button>
  );
}

function buildCalendarCells(from, to, dates) {
  if (!from || !to) return [];
  const groups = groupLookup(dates);
  const start = addDays(from, -dayOfWeek(from));
  const endOffset = 6 - dayOfWeek(to);
  const end = addDays(to, endOffset);
  const cells = [];
  let current = start;
  while (current <= end) {
    const [, , day] = current.split('-');
    cells.push({
      date: current,
      dayNumber: Number(day),
      inRange: current >= from && current <= to,
      group: groups.get(current),
    });
    current = addDays(current, 1);
  }
  return cells;
}

function MonthGrid({ dates, rangeFrom, rangeTo, selectedDate, onSelectDate }) {
  const cells = buildCalendarCells(rangeFrom, rangeTo, dates);
  const selectedGroup = (dates || []).find(group => group.date === selectedDate);

  if (cells.length === 0) {
    return (
      <div className="rounded-xl border border-border/50 bg-card p-8 text-center">
        <p className="text-sm font-semibold text-foreground">No calendar range to display</p>
        <p className="text-xs text-muted-foreground mt-1">Try another preset or a valid custom range.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <div className="min-w-[760px] space-y-2">
          <div className="grid grid-cols-7 gap-2">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
              <div key={day} className="px-2 text-[10px] font-black uppercase tracking-wider text-muted-foreground">
                {day}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-2">
            {cells.map(cell => (
              <CalendarCell
                key={cell.date}
                cell={cell}
                selectedDate={selectedDate}
                onSelectDate={onSelectDate}
              />
            ))}
          </div>
        </div>
      </div>

      <section className="rounded-xl border border-border/60 bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Selected Day</p>
            <h2 className="mt-0.5 text-sm font-black text-foreground">{formatDate(selectedDate)}</h2>
          </div>
          <TypeChip label={`${selectedGroup?.items?.length || 0} items`} />
        </div>
        {selectedGroup?.items?.length > 0 ? (
          <div className="mt-3 space-y-2">
            {selectedGroup.items.map((item, index) => (
              <CalendarItem key={`${selectedGroup.date}-${item.type}-${item.id || index}`} item={item} />
            ))}
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">No read-only operations items returned for this day.</p>
        )}
      </section>
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
  const [viewMode, setViewMode] = useState('month');
  const [selectedDate, setSelectedDate] = useState(today);
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
  const warnings = Array.isArray(data?.warnings) ? data.warnings.filter(Boolean) : [];
  const isNativeFallback = data?.source === 'customer_app_native_calendar_fallback'
    || data?.data_sources?.hub_available === false;
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

  const visibleDateFrom = data?.date_from || (isCustom ? appliedDateFrom : firstDayOfMonth(today));
  const visibleDateTo = data?.date_to || (isCustom ? appliedDateTo : lastDayOfMonth(today));

  const applyMonthRange = (monthStart) => {
    const from = firstDayOfMonth(monthStart);
    const to = lastDayOfMonth(monthStart);
    setDateFrom(from);
    setDateTo(to);
    setAppliedDateFrom(from);
    setAppliedDateTo(to);
    setPreset('custom');
    setSelectedDate(from);
  };

  const applyPreset = (value) => {
    setPreset(value);
    if (value === 'today') {
      setSelectedDate(today);
    } else if (value === 'current_month') {
      setSelectedDate(today);
    } else if (value === 'next_30_days') {
      setSelectedDate(today);
    }
  };

  return (
    <div className="min-h-screen bg-background pb-10">
      <AdminOpsHeader
        title="Calendar"
        subtitle="Read-only operations schedule"
        badge="Read-only"
      />

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
                onClick={() => applyPreset(option.value)}
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
            <p className="text-xs font-semibold text-foreground">
              {isNativeFallback ? 'Native Customer App calendar fallback' : 'Hub Calendar view'}
            </p>
            <p className="text-[10px] text-muted-foreground">Read-only schedule visibility. Use the month controls to move the calendar; event, production, delivery, compliance, and order actions are not available here.</p>
            <p className="text-[10px] font-semibold text-primary mt-1">{formatMonthLabel(visibleDateFrom, visibleDateTo)}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => applyMonthRange(addMonths(visibleDateFrom, -1))}
              className="h-8 w-8 rounded-lg border border-border bg-background text-muted-foreground hover:text-foreground"
              aria-label="Previous month"
            >
              <ChevronLeft className="mx-auto h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => applyMonthRange(today)}
              className="h-8 px-3 rounded-lg border border-border bg-background text-xs font-semibold text-muted-foreground hover:text-foreground"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => applyMonthRange(addMonths(visibleDateFrom, 1))}
              className="h-8 w-8 rounded-lg border border-border bg-background text-muted-foreground hover:text-foreground"
              aria-label="Next month"
            >
              <ChevronRight className="mx-auto h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('agenda')}
              className={`h-8 px-3 rounded-lg border text-xs font-semibold ${
                viewMode === 'agenda' ? 'bg-nuvira-gradient text-white border-primary' : 'bg-background text-muted-foreground border-border'
              }`}
            >
              Agenda
            </button>
            <button
              type="button"
              onClick={() => setViewMode('month')}
              className={`h-8 px-3 rounded-lg border text-xs font-semibold ${
                viewMode === 'month' ? 'bg-nuvira-gradient text-white border-primary' : 'bg-background text-muted-foreground border-border'
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

        {warnings.length > 0 && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
            {warnings.includes('native_read_only_fallback')
              ? 'Hub calendar aggregation is unavailable. Showing native Customer App read-only schedule counts so calendar visibility stays available.'
              : warnings.slice(0, 2).join(', ')}
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
          <MonthGrid
            dates={dates}
            rangeFrom={visibleDateFrom}
            rangeTo={visibleDateTo}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
          />
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
