import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { addDays, format, parseISO } from 'date-fns';
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Clock,
  Image as ImageIcon,
  MapPin,
  Package,
  RefreshCw,
  Truck,
} from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';

function todayDate() {
  const today = new Date();
  const year = today.getFullYear();
  const month = `${today.getMonth() + 1}`.padStart(2, '0');
  const day = `${today.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function shiftDate(dateStr, days) {
  try {
    return format(addDays(parseISO(dateStr || todayDate()), days), 'yyyy-MM-dd');
  } catch {
    return todayDate();
  }
}

function formatDate(value) {
  if (!value) return 'Date pending';
  try {
    return format(parseISO(value), 'MMM d, yyyy');
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

function statusClass(status) {
  const key = (status || '').toString().toLowerCase();
  if (key.includes('delivered') || key.includes('complete')) return 'bg-green-100 text-green-700';
  if (key.includes('out') || key.includes('transit')) return 'bg-blue-100 text-blue-700';
  if (key.includes('unable') || key.includes('missing')) return 'bg-amber-100 text-amber-800';
  return 'bg-muted text-muted-foreground';
}

function sourceTypeLabel(value) {
  if (!value) return 'Source pending';
  return formatLabel(value);
}

function BagReturnsValue({ value }) {
  if (value === null || value === undefined) return <span className="text-xs font-semibold">Not tracked</span>;
  return <span className="text-lg font-bold">{value}</span>;
}

function StatCard({ icon: Icon, label, value, sublabel, isRefreshing }) {
  return (
    <div className="rounded-xl border border-border/50 bg-card p-3">
      {Icon && <Icon className={`w-4 h-4 text-primary mb-1 ${isRefreshing ? 'animate-spin' : ''}`} />}
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</p>
      {React.isValidElement(value) ? value : <p className="text-lg font-bold">{value}</p>}
      {sublabel && <p className="text-[10px] text-muted-foreground">{sublabel}</p>}
    </div>
  );
}

function StopCard({ stop, completed }) {
  return (
    <div className="rounded-xl border border-border/50 bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Order</p>
          <h2 className="font-heading text-lg font-bold text-foreground mt-0.5">
            {stop.order_number || 'Order pending'}
          </h2>
          <p className="text-xs text-muted-foreground">
            {stop.fulfillment_number !== null && stop.fulfillment_number !== undefined
              ? `Fulfillment #${stop.fulfillment_number}`
              : 'Fulfillment pending'}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${statusClass(stop.task_status)}`}>
            {formatLabel(stop.task_status)}
          </span>
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${statusClass(stop.delivery_status)}`}>
            {formatLabel(stop.delivery_status)}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div className="rounded-lg bg-secondary/50 p-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Delivery Window</p>
          <p className="text-sm font-bold">{stop.delivery_window_label || 'Window pending'}</p>
        </div>
        <div className="rounded-lg bg-secondary/50 p-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Source</p>
          <p className="text-sm font-bold">{sourceTypeLabel(stop.source_type)}</p>
        </div>
        <div className="rounded-lg bg-secondary/50 p-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Assigned Driver</p>
          <p className="text-sm font-bold break-words">{stop.assigned_driver || 'Unassigned'}</p>
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Items</p>
        <p className="text-xs text-foreground break-words">{stop.items_summary || 'Items pending'}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="rounded-lg border border-border/50 bg-background p-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className={`w-3.5 h-3.5 ${stop.missing_address ? 'text-amber-600' : 'text-muted-foreground'}`} />
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Address Check</p>
          </div>
          <p className="text-xs font-medium mt-1">{stop.missing_address ? 'Missing address flag' : 'Address present'}</p>
        </div>

        <div className="rounded-lg border border-border/50 bg-background p-2">
          <div className="flex items-center gap-2">
            <ImageIcon className={`w-3.5 h-3.5 ${stop.proof_available ? 'text-green-600' : 'text-muted-foreground'}`} />
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Proof</p>
          </div>
          {stop.delivery_photo_url ? (
            <div className="mt-1">
              <p className="text-[10px] text-muted-foreground font-semibold">Read-only evidence</p>
              <a
                href={stop.delivery_photo_url}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-semibold text-primary underline underline-offset-2 inline-block"
              >
                View proof photo
              </a>
            </div>
          ) : (
            <p className="text-xs font-medium mt-1">{stop.proof_available ? 'Proof available' : 'No proof yet'}</p>
          )}
        </div>
      </div>

      {(completed || stop.delivered_at || stop.delivery_drop_location) && (
        <div className="rounded-lg bg-green-50 border border-green-100 p-2 space-y-1">
          {stop.delivered_at && (
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-green-700" />
              <p className="text-xs text-green-800">Delivered: {formatDateTime(stop.delivered_at)}</p>
            </div>
          )}
          {stop.delivery_drop_location && (
            <div className="flex items-center gap-2">
              <MapPin className="w-3.5 h-3.5 text-green-700" />
              <p className="text-xs text-green-800">Drop location: {stop.delivery_drop_location}</p>
            </div>
          )}
        </div>
      )}

      <p className="text-[10px] text-muted-foreground pt-1 border-t border-border/40">
        Task ID: {stop.task_id || 'Task pending'}
      </p>
    </div>
  );
}

function StopSection({ title, subtitle, stops, completed }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg font-bold text-foreground">{title}</h2>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-secondary text-secondary-foreground">
          {stops.length}
        </span>
      </div>

      {stops.length === 0 ? (
        <div className="rounded-xl border border-border/50 bg-card p-6 text-center">
          <p className="text-sm font-semibold text-foreground">
            {completed ? 'No completed deliveries found' : 'No active delivery stops found'}
          </p>
          <p className="text-xs text-muted-foreground mt-1">This Hub route summary has no rows for this section.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {stops.map(stop => (
            <StopCard key={stop.task_id || `${stop.order_number}-${stop.fulfillment_number}`} stop={stop} completed={completed} />
          ))}
        </div>
      )}
    </section>
  );
}

export default function DeliveryQueue() {
  const { user } = useAuth();
  const defaultDate = useMemo(() => todayDate(), []);
  const [deliveryDate, setDeliveryDate] = useState(defaultDate);

  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ['admin-delivery-route-summary', deliveryDate],
    queryFn: async () => {
      const res = await base44.functions.invoke('getAdminDeliveryRouteSummary', {
        delivery_date: deliveryDate,
        limit: 100,
      });
      const result = res?.data || res;
      if (result?.error) throw new Error(result.error);
      return result || { summary: {}, sections: { delivery_stops: [], completed: [] } };
    },
    enabled: user?.role === 'admin' && Boolean(deliveryDate),
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
  const deliveryStops = data?.sections?.delivery_stops || [];
  const completedStops = data?.sections?.completed || [];
  const hasRows = deliveryStops.length > 0 || completedStops.length > 0;

  return (
    <div className="min-h-screen bg-background pb-10">
      <div className="bg-primary px-4 pt-10 pb-5">
        <Link to="/admin/operations" className="w-9 h-9 bg-white/20 rounded-full flex items-center justify-center mb-3">
          <ArrowLeft className="w-4 h-4 text-white" />
        </Link>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="font-heading text-2xl font-bold text-primary-foreground">Delivery Queue</h1>
            <p className="text-primary-foreground/70 text-xs mt-0.5">Read-only Hub delivery summary</p>
          </div>
          <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-white/20 text-white">Read-only</span>
        </div>
      </div>

      <div className="px-4 mt-4 space-y-4">
        <div className="rounded-xl border border-border/50 bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-primary" />
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Delivery date</p>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setDeliveryDate(shiftDate(deliveryDate, -1))}
              className="h-10 rounded-lg border border-border bg-background px-3 text-xs font-semibold"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setDeliveryDate(defaultDate)}
              className="h-10 rounded-lg border border-border bg-background px-3 text-xs font-semibold"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => setDeliveryDate(shiftDate(deliveryDate, 1))}
              className="h-10 rounded-lg border border-border bg-background px-3 text-xs font-semibold"
            >
              Tomorrow
            </button>
          </div>

          <label className="space-y-1 block">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Selected Date</span>
            <input
              type="date"
              value={deliveryDate}
              onChange={event => setDeliveryDate(event.target.value)}
              className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </label>

          <p className="text-xs text-muted-foreground">
            Showing Hub delivery route summary for {formatDate(deliveryDate)}.
          </p>
          <p className="text-[10px] text-muted-foreground">Read-only Hub data · No actions available here.</p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <StatCard icon={Truck} label="Total Stops" value={summary.total_stops ?? 0} />
          <StatCard icon={Clock} label="Active" value={summary.active ?? 0} />
          <StatCard icon={CheckCircle2} label="Completed" value={summary.completed ?? 0} />
          <StatCard
            icon={Package}
            label="Bag Returns"
            value={<BagReturnsValue value={summary.bag_returns} />}
            sublabel={summary.bag_returns === null || summary.bag_returns === undefined ? 'read-only v1' : null}
          />
        </div>

        <div className="rounded-xl border border-border/50 bg-card p-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-foreground">Hub Driver Portal route view</p>
            <p className="text-[10px] text-muted-foreground">Preserved read-only structure with delivery actions omitted.</p>
          </div>
          <RefreshCw className={`w-4 h-4 text-primary ${isFetching ? 'animate-spin' : ''}`} />
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : isError ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
            <p className="text-sm font-semibold text-destructive">Unable to load delivery queue summary</p>
            <p className="text-xs text-muted-foreground mt-1">{error?.message || 'Try again later.'}</p>
          </div>
        ) : !hasRows ? (
          <div className="rounded-xl border border-border/50 bg-card p-8 text-center">
            <p className="text-sm font-semibold text-foreground">No delivery stops found</p>
            <p className="text-xs text-muted-foreground mt-1">This date has no Hub delivery route summary yet.</p>
          </div>
        ) : (
          <div className="space-y-6">
            <StopSection
              title="Delivery Stops"
              subtitle="Active Hub delivery tasks for this date"
              stops={deliveryStops}
              completed={false}
            />
            <StopSection
              title="Completed"
              subtitle="Delivered or completed Hub delivery tasks"
              stops={completedStops}
              completed
            />
          </div>
        )}
      </div>
    </div>
  );
}
