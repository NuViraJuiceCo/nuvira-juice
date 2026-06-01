import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays, format, parseISO } from 'date-fns';
import AdminOpsHeader from '@/components/admin/AdminOpsHeader';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Image as ImageIcon,
  MapPin,
  Navigation,
  Package,
  RefreshCw,
  Truck,
} from 'lucide-react';
import { AdminStatusLegend, AdminStatusPill } from '@/components/admin/AdminStatusPill';
import May30ReadinessPanel from '@/components/admin/May30ReadinessPanel';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';

const NUVIRA_BASE_ADDRESS = '619 N Main St Unit 3, O\'Fallon, MO 63366';

const deliveryReadinessItems = [
  {
    label: 'Driver assignment',
    status: 'controlled',
    detail: 'Eligible scheduled tasks can be assigned, reassigned, or unassigned with an internal driver label.',
  },
  {
    label: 'Out For Delivery',
    status: 'controlled',
    detail: 'Eligible assigned tasks can be marked Out For Delivery without directly sending customer notifications.',
  },
  {
    label: 'Delivered',
    status: 'controlled',
    detail: 'Out-for-delivery tasks can be marked Delivered as an operational update while notification gates stay separate.',
  },
  {
    label: 'Route preview',
    status: 'ready',
    detail: 'Admins can copy a route manifest, open a static route, and preview optimization without saving route order.',
  },
  {
    label: 'Frozen actions',
    status: 'frozen',
    detail: 'Proof/drop upload, unable-to-deliver, route save, bag credits, and customer-facing delivery notifications are not exposed here.',
  },
];

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

function sourceTypeLabel(value) {
  if (!value) return 'Source pending';
  return formatLabel(value);
}

function dataSourceLabel(value) {
  if (value === 'customer_app_native_task') return 'Native Task';
  if (value === 'customer_app_native_order') return 'Native Order';
  if (value === 'hub') return 'Hub';
  return 'Source pending';
}

function isNativeDeliveryStop(stop) {
  return (stop?.data_source || '').toString().startsWith('customer_app_native');
}

function isNativeDeliveryTaskStop(stop) {
  return stop?.data_source === 'customer_app_native_task';
}

function canonicalTaskStatus(value) {
  const key = normalizedStatus(value);
  if (key === 'out for delivery') return 'out_for_delivery';
  if (key === 'in transit') return 'out_for_delivery';
  return value || null;
}

function normalizedStatus(value) {
  return (value || '').toString().trim().toLowerCase();
}

function trimDriverLabel(value) {
  return (value || '').toString().replace(/\s+/g, ' ').trim();
}

function validateDriverLabel(value) {
  const driver = trimDriverLabel(value);
  if (!driver) return 'Internal driver label is required.';
  if (driver.length > 120) return 'Internal driver label must be 120 characters or less.';
  if (!/^[A-Za-z0-9 ._'@+-]+$/.test(driver)) return 'Internal driver label contains unsupported characters.';
  return null;
}

function requestIdFor(action, taskId) {
  const fallback = Math.random().toString(36).slice(2);
  const randomId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : fallback;
  return `fulfillment_assignment_${action}_${taskId}_${Date.now()}_${randomId}`;
}

function outForDeliveryRequestId(taskId) {
  const fallback = Math.random().toString(36).slice(2);
  const randomId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : fallback;
  return `fulfillment_out_for_delivery_${taskId}_${Date.now()}_${randomId}`;
}

function deliveredRequestId(taskId) {
  const fallback = Math.random().toString(36).slice(2);
  const randomId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : fallback;
  return `fulfillment_delivered_${taskId}_${Date.now()}_${randomId}`;
}

function nativePreviewRequestId(action, stop) {
  const fallback = Math.random().toString(36).slice(2);
  const randomId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : fallback;
  return `native_fulfillment_preview_${action}_${stop.task_id || stop.order_number || 'task'}_${Date.now()}_${randomId}`;
}

function nativeExecuteRequestId(action, stop) {
  const fallback = Math.random().toString(36).slice(2);
  const randomId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : fallback;
  return `native_fulfillment_execute_${action}_${stop.task_id || stop.order_number || 'task'}_${Date.now()}_${randomId}`;
}

function nativeMaterializationRequestId(stop) {
  const fallback = Math.random().toString(36).slice(2);
  const randomId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : fallback;
  return `native_task_materialize_${stop.order_number || 'order'}_${Date.now()}_${randomId}`;
}

function nativeTaskPayload(stop) {
  return {
    id: stop.task_id || null,
    fulfillment_task_id: stop.task_id || null,
    order_number: stop.order_number || null,
    status: canonicalTaskStatus(stop.task_status),
    delivery_status: canonicalTaskStatus(stop.delivery_status),
    fulfillment_type: 'delivery',
    source_type: stop.source_type || 'customer_app_native',
    delivery_date: stop.delivery_date || null,
    address: stop.delivery_address || null,
    assigned_driver: stop.assigned_driver || null,
    items: stop.items_summary ? [{ title: stop.items_summary, quantity: 1 }] : [],
  };
}

function routeStopPayload(stop) {
  return {
    task_id: stop.task_id || null,
    order_number: stop.order_number || null,
    fulfillment_number: stop.fulfillment_number ?? null,
    customer_name: stop.customer_name || null,
    delivery_address: stop.delivery_address || null,
    delivery_window_label: stop.delivery_window_label || null,
    items_summary: stop.items_summary || null,
    assigned_driver: stop.assigned_driver || null,
    task_status: stop.task_status || null,
    delivery_status: stop.delivery_status || null,
    source_type: stop.source_type || null,
    missing_address: stop.missing_address === true,
  };
}

function routeAddressStops(stops = []) {
  return stops.filter(stop => stop?.delivery_address && !stop?.missing_address && !stop?.is_return_stop);
}

function routeManifestText(stops = []) {
  const addressStops = routeAddressStops(stops);
  return [
    `Start: NuVira Base - ${NUVIRA_BASE_ADDRESS}`,
    ...addressStops.map((stop, index) => (
      `${index + 1}. ${stop.order_number || 'Order pending'} - ${stop.customer_name || 'Customer pending'} - ${stop.delivery_address}`
    )),
    `Return: NuVira Base - ${NUVIRA_BASE_ADDRESS}`,
  ].join('\n');
}

function googleMapsRouteUrl(stops = []) {
  const addressStops = routeAddressStops(stops);
  if (addressStops.length === 0) return null;

  const params = new URLSearchParams({
    api: '1',
    origin: NUVIRA_BASE_ADDRESS,
    destination: NUVIRA_BASE_ADDRESS,
    travelmode: 'driving',
  });

  params.set('waypoints', addressStops.map(stop => stop.delivery_address).join('|'));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function formatDistanceMeters(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return `${Math.round((parsed / 1609.344) * 10) / 10} mi`;
}

function formatDurationSeconds(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return `${Math.round(parsed / 60)} min`;
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

function RouteOptimizationPanel({ deliveryDate, stops }) {
  const eligibleStops = stops.filter(stop => stop.delivery_address && !stop.missing_address);
  const missingAddressCount = stops.length - eligibleStops.length;
  const stopSignature = useMemo(
    () => eligibleStops.map(stop => `${stop.task_id || stop.order_number || ''}:${stop.task_status || ''}:${stop.assigned_driver || ''}`).join('|'),
    [eligibleStops]
  );
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState(null);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    setResult(null);
    setMessage(null);
  }, [deliveryDate, stopSignature]);

  async function previewRoute() {
    setPending(true);
    setMessage(null);
    setResult(null);

    try {
      const res = await base44.functions.invoke('optimizeDeliveryRoute', {
        date: deliveryDate,
        optimize: true,
        stops: stops.map(routeStopPayload),
      });
      const payload = res?.data || res;
      if (payload?.error) throw new Error(payload.error);

      if (payload?.skipped) {
        setMessage({
          type: 'warn',
          text: payload.message || 'Route optimization is disabled.',
        });
        setResult(payload);
        return;
      }

      setResult(payload);
      setMessage({
        type: 'success',
        text: 'Route preview calculated. No route order was saved.',
      });
    } catch {
      setMessage({
        type: 'error',
        text: 'Unable to preview optimized route.',
      });
    } finally {
      setPending(false);
    }
  }

  const optimizedStops = Array.isArray(result?.optimized_orders) ? result.optimized_orders : [];
  const returnedStops = Array.isArray(result?.orders) ? result.orders : [];
  const routePreviewStops = optimizedStops.length > 0 ? optimizedStops : returnedStops;
  const mapsUrl = googleMapsRouteUrl(routePreviewStops.length > 0 ? routePreviewStops : eligibleStops);

  async function copyRouteManifest() {
    const text = routeManifestText(routePreviewStops.length > 0 ? routePreviewStops : eligibleStops);
    try {
      await navigator.clipboard.writeText(text);
      setMessage({ type: 'success', text: 'Route manifest copied. No route order was saved.' });
    } catch {
      setMessage({ type: 'error', text: 'Unable to copy route manifest.' });
    }
  }

  return (
    <div className="rounded-xl border border-border/50 bg-card p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Navigation className="w-4 h-4 text-primary" />
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Route Optimization</p>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Admin preview only. Uses active Hub delivery stops and does not save route order.
          </p>
        </div>
        <button
          type="button"
          onClick={previewRoute}
          disabled={pending || stops.length === 0 || eligibleStops.length < 2}
          className="h-9 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-60"
        >
          {pending ? 'Optimizing...' : 'Preview Route'}
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg bg-secondary/50 p-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Stops</p>
          <p className="text-sm font-bold">{stops.length}</p>
        </div>
        <div className="rounded-lg bg-secondary/50 p-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Addressable</p>
          <p className="text-sm font-bold">{eligibleStops.length}</p>
        </div>
        <div className="rounded-lg bg-secondary/50 p-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Missing</p>
          <p className="text-sm font-bold">{missingAddressCount}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={copyRouteManifest}
          disabled={eligibleStops.length === 0}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground disabled:opacity-60"
        >
          <Copy className="h-3.5 w-3.5" />
          Copy Stops
        </button>
        {mapsUrl ? (
          <a
            href={mapsUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open Static Route
          </a>
        ) : (
          <button
            type="button"
            disabled
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground opacity-60"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open Static Route
          </button>
        )}
      </div>

      {eligibleStops.length < 2 && (
        <p className="text-xs text-muted-foreground">
          At least two active stops with delivery addresses are required to optimize a route.
        </p>
      )}

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

      {routePreviewStops.length > 0 && (
        <div className="rounded-lg border border-border/50 bg-background p-2 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              {optimizedStops.length > 0 ? 'Previewed Stop Order' : 'Static Stop Manifest'}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {result?.total_distance_miles ? `${result.total_distance_miles} mi` : 'Distance pending'}
              {result?.total_duration_minutes ? ` · ${result.total_duration_minutes} min` : ''}
            </p>
          </div>
          <div className="space-y-1.5">
            {routePreviewStops.map((stop, index) => (
              <div
                key={stop.task_id || stop.order_number || `route-stop-${index}`}
                className="rounded-md bg-card px-2 py-1.5 text-xs"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground">
                      {index + 1}. {stop.is_return_stop ? 'Return to NuVira Base' : stop.order_number || 'Order pending'}
                    </p>
                    <p className="text-muted-foreground truncate">{stop.delivery_address || 'Address pending'}</p>
                  </div>
                  <p className="text-[10px] text-muted-foreground shrink-0">
                    {[formatDistanceMeters(stop.leg_distance_meters), formatDurationSeconds(stop.leg_duration_seconds)].filter(Boolean).join(' · ')}
                  </p>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground">This preview does not persist route order or notify customers.</p>
        </div>
      )}
    </div>
  );
}

function DriverAssignmentControls({ stop, onAssignmentSuccess }) {
  const taskId = stop.task_id;
  const status = normalizedStatus(stop.task_status);
  const assignedDriver = trimDriverLabel(stop.assigned_driver);
  const canAssign = Boolean(taskId) && (status === 'unassigned' || status === 'scheduled');
  const hasDriver = Boolean(assignedDriver);
  const showAssign = canAssign && !hasDriver;
  const showReassign = canAssign && status === 'scheduled' && hasDriver;
  const showUnassign = canAssign && status === 'scheduled' && hasDriver;
  const showControls = showAssign || showReassign || showUnassign;

  const [driverLabel, setDriverLabel] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState(null);

  if (!showControls) return null;

  async function runAssignment(uiAction) {
    const commandAction = uiAction === 'unassign' ? 'unassign' : 'assign';
    const nextDriver = trimDriverLabel(driverLabel);

    if (commandAction === 'assign') {
      const validationError = validateDriverLabel(nextDriver);
      if (validationError) {
        setMessage({ type: 'error', text: validationError });
        return;
      }
    }

    if (uiAction === 'reassign' && !window.confirm(`Reassign this task to ${nextDriver}?`)) return;
    if (uiAction === 'unassign' && !window.confirm('Remove the assigned driver from this task?')) return;

    const payload = {
      fulfillment_task_id: taskId,
      action: commandAction,
      request_id: requestIdFor(uiAction, taskId),
    };

    if (commandAction === 'assign') {
      payload.assigned_driver = nextDriver;
    }

    setPending(true);
    setMessage(null);

    try {
      const res = await base44.functions.invoke('updateAdminFulfillmentTaskAssignment', payload);
      const result = res?.data || res;
      if (!result?.success) throw new Error('assignment_failed');
      setMessage({ type: 'success', text: 'Driver assignment updated.' });
      setDriverLabel('');
      await onAssignmentSuccess?.();
    } catch {
      setMessage({ type: 'error', text: 'Unable to update driver assignment.' });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rounded-lg border border-border/50 bg-background p-2 space-y-2">
      <div>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Driver Assignment</p>
        <p className="text-[10px] text-muted-foreground">
          {hasDriver ? `Current: ${assignedDriver}` : 'No driver assigned'}
        </p>
      </div>

      {(showAssign || showReassign) && (
        <label className="space-y-1 block">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Internal driver label</span>
          <input
            type="text"
            value={driverLabel}
            onChange={event => setDriverLabel(event.target.value.slice(0, 120))}
            placeholder="Driver name or internal label"
            disabled={pending}
            maxLength={120}
            className="w-full h-9 rounded-lg border border-border bg-card px-3 text-xs focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
          />
        </label>
      )}

      <div className="flex flex-wrap gap-2">
        {showAssign && (
          <button
            type="button"
            onClick={() => runAssignment('assign')}
            disabled={pending}
            className="h-8 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-60"
          >
            {pending ? 'Saving...' : 'Assign'}
          </button>
        )}
        {showReassign && (
          <button
            type="button"
            onClick={() => runAssignment('reassign')}
            disabled={pending}
            className="h-8 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-60"
          >
            {pending ? 'Saving...' : 'Reassign'}
          </button>
        )}
        {showUnassign && (
          <button
            type="button"
            onClick={() => runAssignment('unassign')}
            disabled={pending}
            className="h-8 rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground disabled:opacity-60"
          >
            {pending ? 'Saving...' : 'Unassign'}
          </button>
        )}
      </div>

      {message && (
        <p className={`text-xs ${message.type === 'error' ? 'text-destructive' : 'text-green-700'}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}

function OperationalStatusControls({ stop, onStatusSuccess }) {
  const taskId = stop.task_id;
  const status = normalizedStatus(stop.task_status);
  const assignedDriver = trimDriverLabel(stop.assigned_driver);
  const hasDriver = Boolean(assignedDriver);
  const eligibleOutForDeliveryStatus = status === 'scheduled' || status === 'packed' || status === 'in transit';
  const isOutForDelivery = status === 'out for delivery';
  const isCompleted = status === 'completed';

  const [pendingOutForDeliveryTaskId, setPendingOutForDeliveryTaskId] = useState(null);
  const [pendingDeliveredTaskId, setPendingDeliveredTaskId] = useState(null);
  const [message, setMessage] = useState(null);
  const outForDeliveryPending = pendingOutForDeliveryTaskId === taskId;
  const deliveredPending = pendingDeliveredTaskId === taskId;

  if (isCompleted) {
    return (
      <div className="rounded-lg border border-green-100 bg-green-50 p-2">
        <p className="text-[10px] uppercase tracking-wider text-green-700 font-semibold">Operational Status</p>
        <p className="text-xs font-semibold text-green-800 mt-1">Delivered</p>
      </div>
    );
  }

  if (!taskId || (!eligibleOutForDeliveryStatus && !isOutForDelivery)) return null;

  async function markOutForDelivery() {
    if (!hasDriver) return;
    if (!window.confirm('Mark this task as Out For Delivery in Operations? Customer delivery notifications are controlled by separate backend gates and are not sent directly by this button.')) return;

    setPendingOutForDeliveryTaskId(taskId);
    setMessage(null);

    try {
      const res = await base44.functions.invoke('markAdminFulfillmentTaskOutForDelivery', {
        fulfillment_task_id: taskId,
        request_id: outForDeliveryRequestId(taskId),
        reason: 'Marked out for delivery from Delivery Queue.',
      });
      const result = res?.data || res;
      if (!result?.success) throw new Error('out_for_delivery_failed');
      setMessage({ type: 'success', text: 'Task marked Out For Delivery.' });
      await onStatusSuccess?.();
    } catch {
      setMessage({ type: 'error', text: 'Unable to mark task out for delivery.' });
    } finally {
      setPendingOutForDeliveryTaskId(null);
    }
  }

  async function markDelivered() {
    if (!hasDriver) return;
    if (!window.confirm('Mark this task Delivered in Operations? Customer delivery notifications are controlled by separate backend gates and are not sent directly by this button.')) return;

    setPendingDeliveredTaskId(taskId);
    setMessage(null);

    try {
      const res = await base44.functions.invoke('recordAdminFulfillmentTaskDelivered', {
        fulfillment_task_id: taskId,
        request_id: deliveredRequestId(taskId),
        reason: 'Marked delivered from Delivery Queue.',
      });
      const result = res?.data || res;
      if (!result?.success) throw new Error('delivered_failed');
      setMessage({ type: 'success', text: 'Task marked Delivered.' });
      await onStatusSuccess?.();
    } catch {
      setMessage({ type: 'error', text: 'Unable to mark task delivered.' });
    } finally {
      setPendingDeliveredTaskId(null);
    }
  }

  return (
    <div className="rounded-lg border border-border/50 bg-background p-2 space-y-2">
      <div>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Operational Status</p>
        <p className="text-[10px] text-muted-foreground">Operations status update. Customer delivery notifications are separately gated.</p>
      </div>

      {isOutForDelivery && hasDriver && (
        <button
          type="button"
          onClick={markDelivered}
          disabled={deliveredPending}
          className="h-8 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-60"
        >
          {deliveredPending ? 'Saving...' : 'Mark Delivered'}
        </button>
      )}

      {eligibleOutForDeliveryStatus && hasDriver && (
        <button
          type="button"
          onClick={markOutForDelivery}
          disabled={outForDeliveryPending}
          className="h-8 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-60"
        >
          {outForDeliveryPending ? 'Saving...' : 'Mark Out For Delivery'}
        </button>
      )}

      {!hasDriver && (
        <p className="text-xs font-semibold text-muted-foreground">Assign driver first</p>
      )}

      {message && (
        <p className={`text-xs ${message.type === 'error' ? 'text-destructive' : 'text-green-700'}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}

function NativeDeliveryReadOnlyNotice({ stop }) {
  return (
    <div className="rounded-lg border border-sky-200 bg-sky-50 p-2">
      <div className="flex items-start gap-2">
        <Truck className="w-3.5 h-3.5 text-sky-700 mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-sky-800 font-semibold">
            {isNativeDeliveryTaskStop(stop) ? 'Native FulfillmentTask' : 'Native Delivery Order'}
          </p>
          <p className="text-xs text-sky-800 mt-1">
            Hub-backed delivery write controls are hidden for this row. Use the dry-run preview below for native readiness until native delivery writes are explicitly allowlisted.
          </p>
        </div>
      </div>
    </div>
  );
}

function NativeFulfillmentPreviewPanel({ stop, onActionSuccess }) {
  const [activeAction, setActiveAction] = useState('assign');
  const [driverLabel, setDriverLabel] = useState('');
  const [preview, setPreview] = useState(null);
  const [pending, setPending] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [message, setMessage] = useState(null);

  const canPreview = Boolean(stop.task_id || stop.order_number);
  const blockers = Array.isArray(preview?.blockers) ? preview.blockers : [];
  const warnings = Array.isArray(preview?.warnings) ? preview.warnings : [];
  const projectedWrites = Array.isArray(preview?.projected_writes) ? preview.projected_writes : [];
  const actions = [
    { key: 'assign', label: 'Assign' },
    { key: 'unassign', label: 'Unassign' },
    { key: 'pack', label: 'Pack' },
    { key: 'out_for_delivery', label: 'Out For Delivery' },
    { key: 'delivered_operational', label: 'Delivered' },
  ];

  async function runPreview(action) {
    const nextDriver = trimDriverLabel(driverLabel);
    if (action === 'assign' && !nextDriver) {
      setMessage({ type: 'error', text: 'Enter an internal driver label to preview assignment.' });
      return;
    }

    setActiveAction(action);
    setPending(true);
    setPreview(null);
    setMessage(null);

    try {
      const payload = {
        action,
        mode: 'dry_run',
        task: nativeTaskPayload(stop),
        request_id: nativePreviewRequestId(action, stop),
      };

      if (action === 'assign') {
        payload.assignment_input = { assigned_driver: nextDriver };
      }

      const res = await base44.functions.invoke('previewNativeFulfillmentTaskLifecycle', payload);
      const result = res?.data || res;
      if (result?.error && result?.success !== true) throw new Error(result.error);
      setPreview(result);
      setMessage({
        type: result.lifecycle_ready ? 'success' : 'warn',
        text: result.lifecycle_ready
          ? `${formatLabel(action)} readiness preview passed. Native execution remains exact-gated.`
          : `${formatLabel(action)} has preview blockers or warnings.`,
      });
    } catch (error) {
      setMessage({ type: 'error', text: error?.message || `Unable to preview native ${formatLabel(action)}.` });
    } finally {
      setPending(false);
    }
  }

  async function runNative(action) {
    const nextDriver = trimDriverLabel(driverLabel);
    if (!stop.task_id) {
      setMessage({ type: 'error', text: 'A native FulfillmentTask id is required before execution.' });
      return;
    }
    if (!preview?.lifecycle_ready || preview.action !== action) return;
    if (action === 'assign' && !nextDriver) {
      setMessage({ type: 'error', text: 'Enter an internal driver label before assigning.' });
      return;
    }
    if (!window.confirm(`Run native ${formatLabel(action)} for ${stop.order_number || stop.task_id}? This is exact-task gated and does not update orders, notify customers, save routes, or process proof/drop evidence.`)) {
      return;
    }

    setActionPending(true);
    setMessage(null);

    try {
      const payload = {
        mode: 'live',
        confirmation: 'execute_native_fulfillment_task_lifecycle',
        fulfillment_task_id: stop.task_id,
        action,
        request_id: nativeExecuteRequestId(action, stop),
        reason: `Admin Delivery Queue native ${formatLabel(action)}.`,
      };

      if (action === 'assign') {
        payload.assigned_driver = nextDriver;
      }

      const res = await base44.functions.invoke('executeNativeFulfillmentTaskLifecycle', payload);
      const result = res?.data || res;
      if (!result?.success) {
        const gate = result?.error_code ? ` (${formatLabel(result.error_code)})` : '';
        throw new Error(`${result?.error || 'Native fulfillment action was not allowed'}${gate}`);
      }
      setPreview(null);
      setMessage({
        type: result.skipped ? 'warn' : 'success',
        text: result.skipped ? 'Native action was already recorded.' : `Native ${formatLabel(action)} completed.`,
      });
      await onActionSuccess?.();
    } catch (error) {
      setMessage({ type: 'error', text: error?.message || `Unable to run native ${formatLabel(action)}.` });
    } finally {
      setActionPending(false);
    }
  }

  const canExecuteNative = Boolean(stop.task_id && preview?.lifecycle_ready && preview.action === activeAction);

  return (
    <div className="rounded-lg border border-border/50 bg-background p-2 space-y-3">
      <div>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Native Fulfillment Preview</p>
        <p className="text-[10px] text-muted-foreground mt-1">
          Dry-run only. No native task update, notification, proof/drop action, route save, provider call, or customer-facing status write occurs.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {actions.map(action => (
          <button
            key={action.key}
            type="button"
            disabled={pending || !canPreview}
            onClick={() => runPreview(action.key)}
            className={`h-9 rounded-lg border px-2 text-xs font-semibold ${
              activeAction === action.key
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card text-foreground border-border disabled:opacity-50'
            }`}
          >
            {pending && activeAction === action.key ? 'Previewing...' : action.label}
          </button>
        ))}
      </div>

      {activeAction === 'assign' && (
        <label className="space-y-1 block">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Preview driver label</span>
          <input
            type="text"
            value={driverLabel}
            onChange={event => setDriverLabel(event.target.value.slice(0, 120))}
            placeholder="Driver name or internal label"
            disabled={pending}
            maxLength={120}
            className="w-full h-9 rounded-lg border border-border bg-card px-3 text-xs focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
          />
        </label>
      )}

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
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg bg-card p-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Ready</p>
              <p className="text-sm font-bold">{preview.lifecycle_ready ? 'Yes' : 'No'}</p>
            </div>
            <div className="rounded-lg bg-card p-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Native Write</p>
              <p className="text-sm font-bold">{preview.native_write_allowed ? 'Yes' : 'No'}</p>
            </div>
            <div className="rounded-lg bg-card p-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Action</p>
              <p className="text-sm font-bold">{formatLabel(preview.action)}</p>
            </div>
          </div>

          {(blockers.length > 0 || warnings.length > 0) && (
            <div className="space-y-1">
              {blockers.map(blocker => (
                <div key={`native-fulfillment-blocker-${blocker}`} className="flex items-start gap-2 text-xs text-amber-800">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>Blocker: {formatLabel(blocker)}</span>
                </div>
              ))}
              {warnings.map(warning => (
                <div key={`native-fulfillment-warning-${warning}`} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>{formatLabel(warning)}</span>
                </div>
              ))}
            </div>
          )}

          {projectedWrites.length > 0 && (
            <p className="text-[10px] text-muted-foreground">
              Would write if a future native command is explicitly approved: {projectedWrites.map(formatLabel).join(', ')}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => runNative(activeAction)}
              disabled={!canExecuteNative || actionPending}
              className="h-9 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-50"
            >
              {actionPending ? 'Running...' : `Run Native ${formatLabel(activeAction)}`}
            </button>
            <p className="text-[10px] text-muted-foreground">
              Default off. Requires exact task allowlist and native fulfillment gates before any write can occur.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function NativeFulfillmentTaskMaterializationPanel({ stop, selectedDate, onMaterialized }) {
  const [deliveryDate, setDeliveryDate] = useState(stop.delivery_date || '');
  const [productionDate, setProductionDate] = useState('');
  const [windowLabel, setWindowLabel] = useState(stop.delivery_window_label || '');
  const [preview, setPreview] = useState(null);
  const [pending, setPending] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [message, setMessage] = useState(null);

  const blockers = Array.isArray(preview?.blockers) ? preview.blockers : [];
  const warnings = Array.isArray(preview?.warnings) ? preview.warnings : [];
  const projectedWrites = Array.isArray(preview?.projected_writes) ? preview.projected_writes : [];
  const canPreview = Boolean(stop.order_number && deliveryDate);
  const canRun = Boolean(preview?.task_materialization_ready && !pending && !actionPending);

  function materializationPayload(mode = 'dry_run') {
    return {
      mode,
      order_number: stop.order_number,
      delivery_date: deliveryDate,
      production_date: productionDate || undefined,
      delivery_window_label: windowLabel || undefined,
      request_id: nativeMaterializationRequestId(stop),
    };
  }

  async function runPreview() {
    if (!canPreview) {
      setMessage({ type: 'error', text: 'Order number and delivery date are required before preview.' });
      return;
    }

    setPending(true);
    setPreview(null);
    setMessage(null);

    try {
      const res = await base44.functions.invoke('previewNativeFulfillmentTaskMaterialization', materializationPayload('dry_run'));
      const result = res?.data || res;
      if (result?.error && result?.success !== true) throw new Error(result.error);
      setPreview(result);
      setMessage({
        type: result.task_materialization_ready ? 'success' : 'warn',
        text: result.task_materialization_ready
          ? 'Native task materialization preview passed. Execution remains exact-order gated.'
          : 'Native task materialization has blockers or warnings.',
      });
    } catch (error) {
      setMessage({ type: 'error', text: error?.message || 'Unable to preview native task materialization.' });
    } finally {
      setPending(false);
    }
  }

  async function runMaterialization() {
    if (!canRun) return;
    if (!window.confirm(`Create one native FulfillmentTask for order ${stop.order_number} on ${deliveryDate}? This updates only the native operational order schedule and creates one native task. It does not notify customers, call providers, deduct inventory, or run sync/repair.`)) {
      return;
    }

    setActionPending(true);
    setMessage(null);

    try {
      const requestId = nativeMaterializationRequestId(stop);
      const res = await base44.functions.invoke('executeNativeFulfillmentTaskMaterialization', {
        ...materializationPayload('live'),
        request_id: requestId,
        confirmation: 'execute_native_fulfillment_task_materialization',
      });
      const result = res?.data || res;
      if (!result?.success) {
        const gate = result?.error_code ? ` (${formatLabel(result.error_code)})` : '';
        throw new Error(`${result?.error || 'Native task materialization was not allowed'}${gate}`);
      }
      setPreview(null);
      setMessage({
        type: result.skipped ? 'warn' : 'success',
        text: result.skipped ? 'Native task materialization was already recorded.' : 'Native FulfillmentTask created.',
      });
      await onMaterialized?.();
    } catch (error) {
      setMessage({ type: 'error', text: error?.message || 'Unable to run native task materialization.' });
    } finally {
      setActionPending(false);
    }
  }

  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-2 space-y-3">
      <div>
        <p className="text-[10px] uppercase tracking-wider text-emerald-900 font-semibold">Native Task Materialization</p>
        <p className="text-[10px] text-emerald-800 mt-1">
          For native delivery orders without a task. Enter the actual customer delivery date, preview first, then exact-order gated execution can create one native FulfillmentTask.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <label className="space-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Delivery date</span>
          <input
            type="date"
            value={deliveryDate}
            onChange={event => setDeliveryDate(event.target.value)}
            disabled={pending || actionPending}
            className="w-full h-9 rounded-lg border border-border bg-card px-3 text-xs"
          />
          {!deliveryDate && (
            <span className="text-[10px] text-amber-700">
              Required. Route filter is {formatDate(selectedDate)} but is not auto-applied.
            </span>
          )}
        </label>
        <label className="space-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Production date</span>
          <input
            type="date"
            value={productionDate}
            onChange={event => setProductionDate(event.target.value)}
            disabled={pending || actionPending}
            className="w-full h-9 rounded-lg border border-border bg-card px-3 text-xs"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Window</span>
          <input
            value={windowLabel}
            onChange={event => setWindowLabel(event.target.value.slice(0, 120))}
            disabled={pending || actionPending}
            placeholder="Optional"
            className="w-full h-9 rounded-lg border border-border bg-card px-3 text-xs"
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!canPreview || pending || actionPending}
          onClick={runPreview}
          className="h-9 rounded-lg border border-emerald-300 bg-white px-3 text-xs font-semibold text-emerald-900 disabled:opacity-50"
        >
          {pending ? 'Previewing...' : 'Preview Task Create'}
        </button>
        <button
          type="button"
          disabled={!canRun}
          onClick={runMaterialization}
          className="h-9 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-50"
        >
          {actionPending ? 'Running...' : 'Run Native Task Create'}
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
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg bg-card p-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Ready</p>
              <p className="text-sm font-bold">{preview.task_materialization_ready ? 'Yes' : 'No'}</p>
            </div>
            <div className="rounded-lg bg-card p-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Existing tasks</p>
              <p className="text-sm font-bold">{preview.existing_task_count ?? 0}</p>
            </div>
            <div className="rounded-lg bg-card p-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Native Write</p>
              <p className="text-sm font-bold">{preview.native_write_allowed ? 'Yes' : 'No'}</p>
            </div>
          </div>

          {(blockers.length > 0 || warnings.length > 0) && (
            <div className="space-y-1">
              {blockers.map(blocker => (
                <div key={`materialization-blocker-${blocker}`} className="flex items-start gap-2 text-xs text-amber-800">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>Blocker: {formatLabel(blocker)}</span>
                </div>
              ))}
              {warnings.map(warning => (
                <div key={`materialization-warning-${warning}`} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>{formatLabel(warning)}</span>
                </div>
              ))}
            </div>
          )}

          {projectedWrites.length > 0 && (
            <p className="text-[10px] text-muted-foreground">
              Would write if exact native gates are open: {projectedWrites.map(formatLabel).join(', ')}
            </p>
          )}

          {preview.fulfillment_task_draft && (
            <p className="text-[10px] text-muted-foreground">
              Draft: {preview.fulfillment_task_draft.items_summary || `${preview.fulfillment_task_draft.item_count || 0} item(s)`} for {preview.fulfillment_task_draft.delivery_date}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function StopCard({ stop, completed, selectedDate, onAssignmentSuccess }) {
  const nativeStop = isNativeDeliveryStop(stop);

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
          <AdminStatusPill value={stop.task_status} label={formatLabel(stop.task_status)} />
          <AdminStatusPill value={stop.delivery_status} label={formatLabel(stop.delivery_status)} />
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
          {stop.data_source && (
            <p className="text-[10px] text-muted-foreground mt-0.5">{dataSourceLabel(stop.data_source)}</p>
          )}
        </div>
        <div className="rounded-lg bg-secondary/50 p-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Assigned Driver</p>
          <p className="text-sm font-bold break-words">{stop.assigned_driver || 'Unassigned'}</p>
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Customer</p>
        <p className="text-xs text-foreground break-words">{stop.customer_name || 'Customer pending'}</p>
      </div>

      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Delivery Address</p>
        <p className="text-xs text-foreground break-words">{stop.delivery_address || 'Address pending'}</p>
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

      {nativeStop ? (
        <>
          <NativeDeliveryReadOnlyNotice stop={stop} />
          {isNativeDeliveryTaskStop(stop) ? (
            <NativeFulfillmentPreviewPanel stop={stop} onActionSuccess={onAssignmentSuccess} />
          ) : (
            <NativeFulfillmentTaskMaterializationPanel
              stop={stop}
              selectedDate={selectedDate}
              onMaterialized={onAssignmentSuccess}
            />
          )}
        </>
      ) : (
        <>
          <DriverAssignmentControls stop={stop} onAssignmentSuccess={onAssignmentSuccess} />
          <OperationalStatusControls stop={stop} onStatusSuccess={onAssignmentSuccess} />
        </>
      )}
    </div>
  );
}

function StopSection({ title, subtitle, stops, completed, selectedDate, onAssignmentSuccess }) {
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
            <StopCard
              key={stop.task_id || `${stop.order_number}-${stop.fulfillment_number}`}
              stop={stop}
              completed={completed}
              selectedDate={selectedDate}
              onAssignmentSuccess={onAssignmentSuccess}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export default function DeliveryQueue() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const defaultDate = useMemo(() => todayDate(), []);
  const [deliveryDate, setDeliveryDate] = useState(defaultDate);

  const { data, isLoading, isError, error, isFetching, refetch } = useQuery({
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
  const unscheduledStops = data?.sections?.unscheduled_delivery_orders || [];
  const hasRows = deliveryStops.length > 0 || completedStops.length > 0 || unscheduledStops.length > 0;

  async function refreshDeliveryActionSummaries() {
    await Promise.all([
      refetch(),
      queryClient.invalidateQueries({ queryKey: ['admin-delivery-route-summary'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-operations-dashboard-summary'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-orders'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-shopify-ops-summary'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-sync-health-summary'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-calendar-events-summary'] }),
    ]);
  }

  return (
    <div className="min-h-screen bg-background pb-10">
      <AdminOpsHeader
        title="Delivery Queue"
        subtitle="Hub delivery summary with controlled operational actions"
        badge="Ops v1"
        badgeTone="warning"
      />

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
            Showing Hub and native Customer App delivery route summary for {formatDate(deliveryDate)}.
          </p>
          <AdminStatusLegend />
          <p className="text-[10px] text-muted-foreground">Hub data plus native Customer App delivery rows. Native delivery writes remain preview-first and exact-gated.</p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
          <StatCard icon={Truck} label="Total Stops" value={summary.total_stops ?? 0} />
          <StatCard icon={Clock} label="Active" value={summary.active ?? 0} />
          <StatCard icon={CheckCircle2} label="Completed" value={summary.completed ?? 0} />
          <StatCard icon={AlertTriangle} label="Date Pending" value={summary.unscheduled ?? 0} sublabel="needs review" />
          <StatCard
            icon={Package}
            label="Bag Returns"
            value={<BagReturnsValue value={summary.bag_returns} />}
            sublabel={summary.bag_returns === null || summary.bag_returns === undefined ? 'read-only v1' : null}
          />
        </div>

        <div className="rounded-xl border border-border/50 bg-card p-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-foreground">Driver Portal route view</p>
            <p className="text-[10px] text-muted-foreground">Date-pending native orders can be previewed for task creation. Proof, bag return, and manual notification actions remain omitted. Route optimization is preview-only.</p>
          </div>
          <RefreshCw className={`w-4 h-4 text-primary ${isFetching ? 'animate-spin' : ''}`} />
        </div>

        <May30ReadinessPanel
          title="Fulfillment / delivery ops"
          description="Use this page for approved operational delivery actions. Customer-facing notification expansion remains separate and gated."
          items={deliveryReadinessItems}
          actions={[
            { label: 'Admin Orders', to: '/admin/orders' },
            { label: 'Production Queue', to: '/admin/production-queue' },
            { label: 'Review / Sync Health', to: '/admin/sync-health' },
          ]}
        />

        <RouteOptimizationPanel deliveryDate={deliveryDate} stops={deliveryStops} />

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
            <p className="text-xs text-muted-foreground mt-1">This date has no scheduled Hub delivery route summary or native date-pending delivery orders yet.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {unscheduledStops.length > 0 && (
              <StopSection
                title="Date Pending / Needs Review"
                subtitle="Native delivery orders without a task yet. Preview a delivery date and create one exact-gated native task when approved."
                stops={unscheduledStops}
                completed={false}
                selectedDate={deliveryDate}
                onAssignmentSuccess={refreshDeliveryActionSummaries}
              />
            )}
            <StopSection
              title="Delivery Stops"
              subtitle="Active Hub and native delivery tasks for this date"
              stops={deliveryStops}
              completed={false}
              selectedDate={deliveryDate}
              onAssignmentSuccess={refreshDeliveryActionSummaries}
            />
            <StopSection
              title="Completed"
              subtitle="Delivered or completed delivery tasks"
              stops={completedStops}
              completed
              selectedDate={deliveryDate}
              onAssignmentSuccess={refreshDeliveryActionSummaries}
            />
          </div>
        )}
      </div>
    </div>
  );
}
