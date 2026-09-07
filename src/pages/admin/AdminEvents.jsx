import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSessionMutation as useMutation } from '@/lib/useSessionMutation';
import AdminOpsHeader from '@/components/admin/AdminOpsHeader';
import { AdminStatusPill } from '@/components/admin/AdminStatusPill';
import { base44 } from '@/api/base44Client';
import { isAdminUser } from '@/lib/admin-access';
import { useAuth } from '@/lib/AuthContext';
import { unwrapBase44Result } from '@/lib/base44-result';
import { usePageVisibility } from '@/lib/usePageVisibility';
import {
  CalendarDays,
  Archive,
  ExternalLink,
  MapPin,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShoppingCart,
  Ticket,
} from 'lucide-react';

function todayDate() {
  const today = new Date();
  return [
    today.getFullYear(),
    `${today.getMonth() + 1}`.padStart(2, '0'),
    `${today.getDate()}`.padStart(2, '0'),
  ].join('-');
}

function addDays(dateStr, days) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateKey(value) {
  const text = String(value || '');
  const match = text.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : '';
}

function formatDate(value) {
  const key = dateKey(value);
  if (!key) return 'Date pending';
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function formatTime(value) {
  if (!value) return '';
  const text = String(value);
  const timeMatch = text.match(/T(\d{2}:\d{2})/);
  return timeMatch ? timeMatch[1] : text;
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function formatCount(value) {
  return Number(value || 0).toLocaleString();
}

function sourceLabel(event) {
  if (event.native_primary && event.hub_fallback_used) return 'Customer App + historical context';
  if (event.native_primary) return 'Customer App';
  if (event.hub_fallback_used || event.data_source === 'hub_fallback') return 'Historical source';
  return 'Customer App';
}

function sourceTone(event) {
  if (event.native_primary) return 'native';
  if (event.hub_fallback_used || event.data_source === 'hub_fallback') return 'hub';
  return 'source';
}

function eventStatus(event) {
  return event.status || 'scheduled';
}

function mergeEventDetails(calendarEvent, directEventsByKey) {
  const keyOptions = [
    calendarEvent.id && `id:${normalize(calendarEvent.id)}`,
    calendarEvent.title && calendarEvent.date && `title-date:${normalize(calendarEvent.title)}:${calendarEvent.date}`,
    calendarEvent.title && `title:${normalize(calendarEvent.title)}`,
  ].filter(Boolean);
  const detail = keyOptions.map(key => directEventsByKey.get(key)).find(Boolean) || {};
  return {
    ...detail,
    ...calendarEvent,
    website_link: detail.website_link || calendarEvent.website_link,
    tickets_link: detail.tickets_link || calendarEvent.tickets_link,
    capacity: detail.capacity || calendarEvent.capacity,
    price: detail.price || calendarEvent.price,
    image_url: detail.image_url || calendarEvent.image_url,
    tags: Array.isArray(detail.tags) ? detail.tags : [],
  };
}

function matchesSearch(event, search) {
  const query = normalize(search);
  if (!query) return true;
  return [
    event.title,
    event.summary,
    event.description,
    event.location,
    event.event_type,
    event.status,
    sourceLabel(event),
    ...(Array.isArray(event.tags) ? event.tags : []),
  ].filter(Boolean).join(' ').toLowerCase().includes(query);
}

function EventRow({ event, onEdit, onArchive }) {
  const date = event.date || dateKey(event.start_datetime);
  const time = event.time || formatTime(event.start_datetime);
  const timeLabel = [time, event.end_time].filter(Boolean).join('–');
  const hasExternalLink = Boolean(event.website_link || event.tickets_link);
  const category = event.type || event.event_type || (Array.isArray(event.tags) ? event.tags.find(Boolean) : '');

  return (
    <article className="rounded-xl border border-border/60 bg-card p-3 sm:p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <AdminStatusPill value={eventStatus(event)} label={eventStatus(event)} size="md" />
            <AdminStatusPill value={sourceLabel(event)} label={sourceLabel(event)} tone={sourceTone(event)} size="md" />
            {category ? <AdminStatusPill value={category} label={category} tone="source" size="md" /> : null}
            {event.event_welcome_enabled ? <AdminStatusPill value="scheduled" label="Welcome +2h" tone="native" size="md" /> : null}
            {event.price ? <AdminStatusPill value="ticketed" label={`$${Number(event.price).toFixed(2)}`} tone="source" size="md" /> : null}
          </div>
          <div>
            <h2 className="text-base font-black leading-tight text-foreground sm:text-lg">{event.title || 'Untitled event'}</h2>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold text-muted-foreground">
              <span>{formatDate(date)}{timeLabel ? ` · ${timeLabel}` : ''}</span>
              {event.event_type ? <span>{event.event_type}</span> : null}
            </p>
          </div>
          {(event.summary || event.description) && (
            <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
              {event.summary || event.description}
            </p>
          )}
          {event.location && (
            <p className="flex items-start gap-2 text-xs font-medium text-muted-foreground">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <span>{event.location}</span>
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap gap-2 lg:justify-end">
          {event.native_primary && (
            <>
              <button type="button" onClick={() => onEdit(event)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-background text-foreground" title="Edit event">
                <Pencil className="h-3.5 w-3.5" />
              </button>
              {eventStatus(event) !== 'inactive' && (
                <button type="button" onClick={() => onArchive(event)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground" title="Archive event">
                  <Archive className="h-3.5 w-3.5" />
                </button>
              )}
            </>
          )}
          {event.capacity ? (
            <div className="inline-flex h-9 items-center rounded-lg border border-border bg-background px-3 text-xs font-bold text-foreground">
              Capacity {formatCount(event.capacity)}
            </div>
          ) : null}
          {event.website_link && (
            <a href={event.website_link} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-bold text-foreground">
              <ExternalLink className="h-3.5 w-3.5" />
              Website
            </a>
          )}
          {event.tickets_link && (
            <a href={event.tickets_link} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-bold text-foreground">
              <Ticket className="h-3.5 w-3.5" />
              Tickets
            </a>
          )}
          {!hasExternalLink && (
            <span className="inline-flex h-9 items-center rounded-lg border border-border bg-background px-3 text-xs font-semibold text-muted-foreground">
              No public link
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

function requestId(prefix) {
  const fallback = Math.random().toString(36).slice(2);
  const randomId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : fallback;
  return `${prefix}_${Date.now()}_${randomId}`;
}

function EventEditor({ event, onClose, onSubmit, pending }) {
  const isEdit = Boolean(event?.id);
  const [form, setForm] = useState(() => ({
    title: event?.title || '',
    date: dateKey(event?.date || event?.start_datetime) || todayDate(),
    time: event?.time || formatTime(event?.start_datetime) || '',
    end_time: event?.end_time || '',
    location: event?.location || '',
    description: event?.description || event?.summary || '',
    capacity: event?.capacity ?? '',
    price: event?.price ?? '',
    website_link: event?.website_link || '',
    tickets_link: event?.tickets_link || '',
    image_url: event?.image_url || '',
    event_welcome_enabled: event?.event_welcome_enabled === true,
    event_welcome_key: event?.event_welcome_key || '',
    shopify_pos_location_id: event?.shopify_pos_location_id || '',
    shopify_pos_location_name: event?.shopify_pos_location_name || '',
    tags: Array.isArray(event?.tags) && event.tags.length > 0 ? event.tags : ['Community'],
  }));
  const setField = (field, value) => setForm(current => ({ ...current, [field]: value }));
  const welcomeConfigurationReady = !form.event_welcome_enabled || (
    form.time
    && form.end_time
    && form.location.trim()
    && /^gid:\/\/shopify\/Location\/\d+$/.test(form.shopify_pos_location_id.trim())
  );
  const canSubmit = form.title.trim() && form.date && welcomeConfigurationReady && !pending;

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={isEdit ? 'Edit event' : 'Create event'}>
      <form
        onSubmit={(submitEvent) => {
          submitEvent.preventDefault();
          if (canSubmit) onSubmit(form);
        }}
        className="max-h-[92dvh] w-full overflow-y-auto rounded-t-xl border border-border bg-card p-4 shadow-2xl sm:max-w-2xl sm:rounded-xl sm:p-5"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-wider text-primary">Customer App event</p>
            <h2 className="mt-1 text-lg font-black text-foreground">{isEdit ? 'Edit event' : 'Add event'}</h2>
          </div>
          <button type="button" onClick={onClose} className="h-9 rounded-lg border border-border px-3 text-xs font-bold text-foreground">Close</button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="space-y-1 sm:col-span-2">
            <span className="text-xs font-bold text-foreground">Event name</span>
            <input required maxLength={140} value={form.title} onChange={e => setField('title', e.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground" />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-bold text-foreground">Date</span>
            <input required type="date" value={form.date} onChange={e => setField('date', e.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground" />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-bold text-foreground">Start time</span>
            <input type="time" value={form.time} onChange={e => setField('time', e.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground" />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-bold text-foreground">End time</span>
            <input type="time" value={form.end_time} onChange={e => setField('end_time', e.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground" />
          </label>
          <label className="space-y-1 sm:col-span-2">
            <span className="text-xs font-bold text-foreground">Category</span>
            <select value={form.tags[0] || 'Community'} onChange={e => setField('tags', [e.target.value, ...form.tags.slice(1)])} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground">
              <option value="Pop-Up">Pop-Up</option>
              <option value="Community">Community</option>
              <option value="Festival">Festival</option>
              <option value="Drop">Drop</option>
            </select>
          </label>
          <label className="space-y-1 sm:col-span-2">
            <span className="text-xs font-bold text-foreground">Location</span>
            <input maxLength={240} value={form.location} onChange={e => setField('location', e.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground" />
          </label>
          <label className="space-y-1 sm:col-span-2">
            <span className="text-xs font-bold text-foreground">Description</span>
            <textarea rows={4} maxLength={2000} value={form.description} onChange={e => setField('description', e.target.value)} className="w-full rounded-lg border border-border bg-background p-3 text-sm text-foreground" />
          </label>
          <div className="space-y-3 rounded-xl border border-border bg-background p-3 sm:col-span-2">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={form.event_welcome_enabled}
                onChange={e => setField('event_welcome_enabled', e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-border"
              />
              <span>
                <span className="block text-sm font-bold text-foreground">Send the event welcome two hours after the event ends</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                  Only first-time customers with promotional email consent and a verified purchase at this event are eligible. Repeat syncs are duplicate-safe.
                </span>
              </span>
            </label>
            {form.event_welcome_enabled && (
              <div className="grid grid-cols-1 gap-3 border-t border-border pt-3 sm:grid-cols-2">
                <label className="space-y-1 sm:col-span-2">
                  <span className="text-xs font-bold text-foreground">Shopify POS location GID</span>
                  <input required value={form.shopify_pos_location_id} onChange={e => setField('shopify_pos_location_id', e.target.value)} placeholder="gid://shopify/Location/123456789" className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground" />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-bold text-foreground">POS location name</span>
                  <input maxLength={160} value={form.shopify_pos_location_name} onChange={e => setField('shopify_pos_location_name', e.target.value)} className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground" />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-bold text-foreground">Stable welcome key (optional)</span>
                  <input maxLength={120} value={form.event_welcome_key} onChange={e => setField('event_welcome_key', e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))} placeholder="event-name-2026-09-12" className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground" />
                </label>
              </div>
            )}
          </div>
          <label className="space-y-1">
            <span className="text-xs font-bold text-foreground">Capacity</span>
            <input type="number" min="1" value={form.capacity} onChange={e => setField('capacity', e.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground" />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-bold text-foreground">Ticket price</span>
            <input type="number" min="0" step="0.01" value={form.price} onChange={e => setField('price', e.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground" />
          </label>
          {['website_link', 'tickets_link', 'image_url'].map(field => (
            <label key={field} className="space-y-1 sm:col-span-2">
              <span className="text-xs font-bold text-foreground">{{ website_link: 'Website URL', tickets_link: 'Tickets URL', image_url: 'Image URL' }[field]}</span>
              <input type="url" inputMode="url" placeholder="https://" value={form[field]} onChange={e => setField(field, e.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground" />
            </label>
          ))}
        </div>

        <div className="mt-5 flex justify-end gap-2 border-t border-border pt-4">
          <button type="button" onClick={onClose} className="h-10 rounded-lg border border-border px-4 text-sm font-bold text-foreground">Cancel</button>
          <button type="submit" disabled={!canSubmit} className="h-10 rounded-lg bg-primary px-5 text-sm font-bold text-primary-foreground disabled:opacity-50">
            {pending ? 'Saving...' : isEdit ? 'Save event' : 'Create event'}
          </button>
        </div>
      </form>
    </div>
  );
}

function CompactMetric({ label, value }) {
  return (
    <div>
      <p className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-black text-foreground">{value}</p>
    </div>
  );
}

export default function AdminEvents() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isPageVisible = usePageVisibility();
  const [search, setSearch] = useState('');
  const [timingFilter, setTimingFilter] = useState('upcoming');
  const [statusFilter, setStatusFilter] = useState('all');
  const [editorEvent, setEditorEvent] = useState(undefined);
  const today = todayDate();
  const rangeEnd = addDays(today, 29);

  const calendarQuery = useQuery({
    queryKey: ['admin-events-calendar-read-model', today],
    queryFn: async () => {
      const res = await base44.functions.invoke('getAdminCalendarEventsSummary', {
        preset: 'next_30_days',
        type: 'event',
        limit: 200,
      });
      const result = unwrapBase44Result(res);
      if (result?.error) throw new Error(result.error);
      return result;
    },
    enabled: isAdminUser(user) && isPageVisible,
    staleTime: 60000,
    refetchOnWindowFocus: true,
  });

  const directEventQuery = useQuery({
    queryKey: ['admin-events-direct-details'],
    queryFn: () => base44.entities.Event.list('date', 200),
    enabled: isAdminUser(user) && isPageVisible,
    staleTime: 60000,
    refetchOnWindowFocus: true,
  });

  const directEvents = Array.isArray(directEventQuery.data) ? directEventQuery.data : [];

  const refreshEvents = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin-events-calendar-read-model'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-events-direct-details'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-calendar-events-summary'] }),
    ]);
  };

  const eventMutation = useMutation({
    mutationFn: async ({ operation, event, eventId }) => {
      const res = await base44.functions.invoke('getAdminCalendarEventsSummary', {
        operation,
        event_id: eventId || null,
        event: event || null,
        request_id: requestId(operation),
      });
      const result = unwrapBase44Result(res);
      if (result?.error) throw new Error(result.error);
      return result;
    },
    onSuccess: async () => {
      setEditorEvent(undefined);
      await refreshEvents();
    },
  });

  const archiveEvent = (event) => {
    if (!window.confirm(`Archive ${event.title || 'this event'}? It will no longer appear as active.`)) return;
    eventMutation.mutate({ operation: 'archive_event', eventId: event.id });
  };
  const directEventsByKey = useMemo(() => {
    const map = new Map();
    for (const event of directEvents) {
      const eventDate = dateKey(event.date || event.start_datetime);
      if (event.id) map.set(`id:${normalize(event.id)}`, event);
      if (event.title && eventDate) map.set(`title-date:${normalize(event.title)}:${eventDate}`, event);
      if (event.title && !map.has(`title:${normalize(event.title)}`)) map.set(`title:${normalize(event.title)}`, event);
    }
    return map;
  }, [directEvents]);

  const calendarData = calendarQuery.data || {};
  const allEvents = useMemo(() => {
    const calendarEvents = [];
    for (const group of Array.isArray(calendarData.dates) ? calendarData.dates : []) {
      for (const item of Array.isArray(group.items) ? group.items : []) {
        if (item?.type !== 'event') continue;
        calendarEvents.push(mergeEventDetails({
          ...item,
          date: dateKey(item.start_datetime) || group.date,
        }, directEventsByKey));
      }
    }

    const calendarIds = new Set(calendarEvents.map(event => normalize(event.id)).filter(Boolean));
    const directOnlyEvents = directEvents
      .filter(event => !calendarIds.has(normalize(event.id)))
      .filter(event => {
        const key = dateKey(event.date || event.start_datetime);
        return key && key >= today && key <= rangeEnd;
      })
      .map(event => ({
        ...event,
        date: dateKey(event.date || event.start_datetime),
        status: event.is_active === false ? 'inactive' : 'active',
        data_source: 'customer_app_native',
        native_primary: true,
        hub_fallback_used: false,
      }));

    return [...calendarEvents, ...directOnlyEvents]
      .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  }, [calendarData.dates, directEvents, directEventsByKey, rangeEnd, today]);

  const filteredEvents = useMemo(() => allEvents.filter(event => {
    const date = dateKey(event.date || event.start_datetime);
    if (timingFilter === 'today' && date !== today) return false;
    if (timingFilter === 'upcoming' && date && date < today) return false;
    if (timingFilter === 'past' && (!date || date >= today)) return false;
    if (statusFilter === 'active' && ['inactive', 'cancelled'].includes(normalize(eventStatus(event)))) return false;
    if (statusFilter === 'inactive' && !['inactive', 'cancelled'].includes(normalize(eventStatus(event)))) return false;
    return matchesSearch(event, search);
  }), [allEvents, search, statusFilter, timingFilter, today]);

  const upcomingEvents = allEvents.filter(event => {
    const date = dateKey(event.date || event.start_datetime);
    return !date || date >= today;
  });
  const nextEvent = upcomingEvents[0] || null;
  const todayEvents = allEvents.filter(event => dateKey(event.date || event.start_datetime) === today);
  const warnings = Array.isArray(calendarData.warnings) ? calendarData.warnings.filter(Boolean) : [];
  const dataSources = calendarData.data_sources || {};
  const isLoading = calendarQuery.isLoading || directEventQuery.isLoading;
  const isError = calendarQuery.isError || directEventQuery.isError;
  const isFetching = calendarQuery.isFetching || directEventQuery.isFetching;

  if (!isAdminUser(user)) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <p className="text-sm text-muted-foreground">Admin access required.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-[calc(7rem+env(safe-area-inset-bottom))] md:pb-10">
      <AdminOpsHeader
        title="Events"
        subtitle="Event calendar, POS context, and production handoff"
        badge="Live source"
        badgeTone="source"
      />

      <main className="mx-auto mt-4 w-full max-w-[1180px] space-y-4 px-4">
        <section className="rounded-xl border border-border bg-card p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Next event</p>
              <h2 className="mt-1 text-lg font-black leading-tight text-foreground">
                {nextEvent?.title || 'No upcoming event in the next 30 days'}
              </h2>
              <p className="mt-1 text-sm font-medium text-muted-foreground">
                {nextEvent ? `${formatDate(nextEvent.date || nextEvent.start_datetime)}${nextEvent.location ? ` · ${nextEvent.location}` : ''}` : 'Add an event in the Customer App to publish it here.'}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-4 rounded-lg border border-border/60 bg-background p-3 lg:min-w-[360px]">
              <CompactMetric label="Today" value={formatCount(todayEvents.length)} />
              <CompactMetric label="Upcoming" value={formatCount(upcomingEvents.length)} />
              <CompactMetric label="Visible" value={formatCount(filteredEvents.length)} />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2 border-t border-border/60 pt-3">
            <AdminStatusPill label={dataSources.native_available ? 'Customer App active' : 'Customer App unavailable'} tone={dataSources.native_available ? 'native' : 'warning'} size="md" />
            <AdminStatusPill label="Native event records" tone="neutral" size="md" />
            {isFetching && <RefreshCw className="h-4 w-4 animate-spin text-primary" />}
            <button type="button" onClick={() => setEditorEvent({})} className="ml-auto inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-bold text-primary-foreground">
              <Plus className="h-4 w-4" />
              Add event
            </button>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-3 sm:p-4">
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-[1fr_150px_150px]">
            <label className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="Search title, location, source..."
                className="h-10 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
              />
            </label>
            <select value={timingFilter} onChange={event => setTimingFilter(event.target.value)} className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground">
              <option value="upcoming">Upcoming</option>
              <option value="today">Today</option>
              <option value="all">All shown</option>
              <option value="past">Past</option>
            </select>
            <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)} className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground">
              <option value="all">All status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <Link to="/admin/pos-orders" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 text-sm font-bold text-foreground">
            <ShoppingCart className="h-4 w-4 text-primary" />
            POS Orders
          </Link>
          <Link to="/admin/production-planning" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 text-sm font-bold text-foreground">
            <Package className="h-4 w-4 text-primary" />
            Production Planning
          </Link>
          <Link to="/admin/calendar" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 text-sm font-bold text-foreground">
            <CalendarDays className="h-4 w-4 text-primary" />
            Calendar
          </Link>
        </section>

        {isError && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
            <p className="text-sm font-semibold text-destructive">Unable to load events</p>
            <p className="mt-1 text-xs text-muted-foreground">{calendarQuery.error?.message || directEventQuery.error?.message || 'Try again later.'}</p>
          </div>
        )}

        {eventMutation.isError && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
            <p className="text-sm font-semibold text-destructive">Unable to save event</p>
            <p className="mt-1 text-xs text-muted-foreground">{eventMutation.error?.message || 'Try again later.'}</p>
          </div>
        )}

        {warnings.length > 0 && (
          <div className="rounded-xl border border-cyan-200 bg-cyan-50 p-3 text-xs font-medium text-cyan-900 dark:border-cyan-900/60 dark:bg-cyan-950/30 dark:text-cyan-100">
            {warnings.slice(0, 3).map(warning => String(warning).replace(/_/g, ' ')).join(' · ')}
          </div>
        )}

        {isLoading ? (
          <div className="flex justify-center py-16">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="rounded-xl border border-border/60 bg-card p-8 text-center">
            <p className="text-sm font-semibold text-foreground">No events found</p>
            <p className="mt-1 text-xs text-muted-foreground">Adjust the filters or add the event directly in the Customer App.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredEvents.map(event => (
              <EventRow
                key={`${event.id || event.title}-${event.date || event.start_datetime}`}
                event={event}
                onEdit={setEditorEvent}
                onArchive={archiveEvent}
              />
            ))}
          </div>
        )}
      </main>
      {editorEvent !== undefined && (
        <EventEditor
          key={editorEvent?.id || 'new-event'}
          event={editorEvent}
          pending={eventMutation.isPending}
          onClose={() => setEditorEvent(undefined)}
          onSubmit={event => eventMutation.mutate({
            operation: editorEvent?.id ? 'update_event' : 'create_event',
            event,
            eventId: editorEvent?.id || null,
          })}
        />
      )}
    </div>
  );
}
