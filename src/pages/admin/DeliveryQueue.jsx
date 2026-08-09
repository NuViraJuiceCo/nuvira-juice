import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays, format, parseISO } from 'date-fns';
import { Link, useSearchParams } from 'react-router-dom';
import AdminOpsHeader from '@/components/admin/AdminOpsHeader';
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  Camera,
  CheckCircle2,
  ClipboardList,
  Clock,
  Copy,
  ExternalLink,
  Image as ImageIcon,
  MapPin,
  Navigation,
  Package,
  RefreshCw,
  Truck,
  X,
} from 'lucide-react';
import { AdminStatusLegend, AdminStatusPill } from '@/components/admin/AdminStatusPill';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { isAdminUser } from '@/lib/admin-access';
import { unwrapBase44Result } from '@/lib/base44-result';
import { usePageVisibility } from '@/lib/usePageVisibility';

const NUVIRA_BASE_ADDRESS = '619 N Main St Unit 3, O\'Fallon, MO 63366';
const DELIVERY_LIFECYCLE_READ_MODEL_MODE = 'DELIVERY_LIFECYCLE';
const DELIVERY_LIFECYCLE_READ_MODEL_VERSION = 'g48d_delivery_lifecycle_v1';

const DELIVERY_DROP_OPTIONS = [
  'Front Door',
  'Handed to Customer',
  'Cooler / Delivery Bag',
  'Reception / Front Desk',
  'Garage / Side Door',
  'Other',
];

function todayDate() {
  const today = new Date();
  const year = today.getFullYear();
  const month = `${today.getMonth() + 1}`.padStart(2, '0');
  const day = `${today.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeDeliveryDateInput(value) {
  const text = (value || '').toString().trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;

  try {
    const parsed = parseISO(text);
    return Number.isNaN(parsed.getTime()) ? null : text;
  } catch {
    return null;
  }
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
  if (value === 'hub') return 'Source';
  return 'Source pending';
}

function deliveryLifecycleClassificationLabel(value) {
  return formatLabel(value).replace(/\bHub\b/g, 'Source');
}


function hasValidDeliveryLifecycleReadModel(data) {
  const model = data?.delivery_lifecycle_read_model;
  return data?.delivery_lifecycle_read_model_available === true &&
    data?.delivery_lifecycle_read_model_enabled === true &&
    data?.delivery_lifecycle_read_model_version === DELIVERY_LIFECYCLE_READ_MODEL_VERSION &&
    model?.read_model_enabled === true &&
    model?.read_model_version === DELIVERY_LIFECYCLE_READ_MODEL_VERSION &&
    model?.read_model_available === true &&
    Array.isArray(model?.rows) &&
    model?.summary &&
    typeof model.summary === 'object';
}

function DeliveryLifecycleReadModelPanel({ model }) {
  const summary = model?.summary || {};
  const classificationCounts = model?.classification_counts || {};
  const topClassifications = Object.entries(classificationCounts).slice(0, 4);

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 space-y-3 dark:border-sky-900/60 dark:bg-sky-950/30">
      <div className="flex items-start gap-2">
        <Truck className="w-4 h-4 text-blue-700 mt-0.5 shrink-0 dark:text-sky-300" />
        <div>
          <p className="text-xs font-semibold text-blue-950 dark:text-sky-100">Delivery lifecycle read model</p>
          <p className="text-[10px] text-blue-900 mt-0.5 dark:text-sky-200/80">
            Diagnostics-only view for native/source reconciliation. Use the delivery task controls for operational work.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <StatCard icon={Package} label="Exact Chains" value={summary.exact_order_chain_count ?? 0} />
        <StatCard icon={Truck} label="Route Linked" value={summary.route_linked_count ?? 0} />
        <StatCard icon={AlertTriangle} label="Fallback" value={summary.fallback_required_count ?? 0} />
        <StatCard icon={AlertTriangle} label="Review" value={summary.review_required_count ?? 0} />
      </div>
      {topClassifications.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {topClassifications.map(([classification, count]) => (
            <span
              key={classification}
              className="text-[10px] font-semibold rounded-full border border-blue-200 bg-white/70 px-2 py-1 text-blue-900 dark:border-sky-800/70 dark:bg-background/70 dark:text-sky-100"
            >
              {deliveryLifecycleClassificationLabel(classification)}: {count}
            </span>
          ))}
        </div>
      )}
      <p className="text-[10px] text-blue-900 dark:text-sky-200/80">
        Route save, Shopify fulfillment, provider routing, and source write suppression remain separate migration gates.
      </p>
    </div>
  );
}

function DeliveryLifecycleDiagnosticsDisclosure({ model, reconciliation, suppressedRows = [] }) {
  const staleDateDetected = reconciliation?.stale_hub_fallback_detected === true;

  return (
    <details className="rounded-xl border border-border/50 bg-card p-3">
      <summary className="cursor-pointer text-xs font-semibold text-foreground">
        Delivery diagnostics{' '}
        <span className="ml-2 text-[10px] font-medium text-muted-foreground">native/source reconciliation</span>
      </summary>
      <div className="mt-3 space-y-3">
        {model && <DeliveryLifecycleReadModelPanel model={model} />}

        {suppressedRows.length > 0 && (
          <div className={`rounded-lg border p-3 space-y-2 ${
            staleDateDetected
              ? 'border-amber-200 bg-amber-50/70 dark:border-amber-900/60 dark:bg-amber-950/20'
              : 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/60 dark:bg-emerald-950/20'
          }`}>
            <div className="flex items-start gap-2">
              {staleDateDetected ? (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
              ) : (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-300" />
              )}
              <div>
                <p className="text-xs font-semibold text-foreground">Source reconciliation</p>
                <p className="text-[10px] text-muted-foreground">
                  {suppressedRows.length} duplicate source {suppressedRows.length === 1 ? 'row was' : 'rows were'} excluded from route totals because the matching native schedule is authoritative.
                </p>
              </div>
            </div>
            <div className="space-y-1">
              {suppressedRows.slice(0, 5).map(row => (
                <p key={`${row.order_number}-${row.hub_delivery_date}-${row.native_delivery_date}`} className="text-[10px] text-muted-foreground">
                  {row.order_number}: source {row.hub_delivery_date || 'date pending'} → native {row.native_delivery_date || 'date pending'} · {deliveryLifecycleClassificationLabel(row.merge_status)}
                </p>
              ))}
            </div>
          </div>
        )}
      </div>
    </details>
  );
}

function isNativeDeliveryStop(stop) {
  return (stop?.data_source || '').toString().startsWith('customer_app_native');
}

function isNativeDeliveryTaskStop(stop) {
  return stop?.data_source === 'customer_app_native_task';
}

const HISTORICAL_DELIVERY_ACTIONS_RETIRED = true;

function normalizedStatus(value) {
  return (value || '').toString().trim().toLowerCase();
}

function taskStatusKey(value) {
  const key = normalizedStatus(value).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!key) return '';
  if (key === 'out for delivery' || key === 'in transit') return 'out_for_delivery';
  if (key === 'bottled packed') return 'bottled_packed';
  if (key === 'ready for delivery') return 'ready_for_delivery';
  if (key === 'complete' || key === 'completed' || key === 'fulfilled') return 'delivered';
  return key.replace(/\s+/g, '_');
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

function nativeScheduleCorrectionRequestId(stop) {
  const fallback = Math.random().toString(36).slice(2);
  const randomId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : fallback;
  return `native_schedule_correct_${stop.order_number || 'order'}_${Date.now()}_${randomId}`;
}

function functionErrorBody(error) {
  return error?.response?.data || error?.data || error?.body || null;
}

function nativeScheduleCorrectionErrorText(error) {
  const body = functionErrorBody(error);
  const errorCode = body?.error_code || body?.code;
  const blockers = Array.isArray(body?.blockers) ? body.blockers : [];
  const warnings = Array.isArray(body?.warnings) ? body.warnings : [];
  const parts = [];

  if (body?.error) parts.push(body.error);
  if (errorCode) parts.push(`Code: ${formatLabel(errorCode)}`);
  if (blockers.length > 0) parts.push(`Blockers: ${blockers.map(formatLabel).join(', ')}`);
  if (warnings.length > 0) parts.push(`Warnings: ${warnings.map(formatLabel).join(', ')}`);

  if (parts.length > 0) return parts.join(' | ');
  return error?.message || 'Unable to run native schedule correction.';
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
  if (value === null || value === undefined) return <span className="text-xs font-semibold">Managed</span>;
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
      const payload = unwrapBase44Result(res);
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
            Admin preview only. Uses active source delivery stops and does not save route order.
          </p>
        </div>
        <button
          type="button"
          onClick={previewRoute}
          disabled={pending || stops.length === 0 || eligibleStops.length < 2}
          className="h-9 rounded-lg bg-nuvira-gradient px-3 text-xs font-semibold text-white disabled:opacity-60"
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
              ? 'text-cyan-700'
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
      const result = unwrapBase44Result(res);
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
            className="h-8 rounded-lg bg-nuvira-gradient px-3 text-xs font-semibold text-white disabled:opacity-60"
          >
            {pending ? 'Saving...' : 'Assign'}
          </button>
        )}
        {showReassign && (
          <button
            type="button"
            onClick={() => runAssignment('reassign')}
            disabled={pending}
            className="h-8 rounded-lg bg-nuvira-gradient px-3 text-xs font-semibold text-white disabled:opacity-60"
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
  const status = taskStatusKey(stop.task_status || stop.delivery_status);
  const assignedDriver = trimDriverLabel(stop.assigned_driver);
  const hasDriver = Boolean(assignedDriver);
  const eligibleOutForDeliveryStatus = ['scheduled', 'assigned', 'packed', 'bottled_packed', 'ready_for_delivery'].includes(status);
  const isOutForDelivery = status === 'out_for_delivery';
  const isCompleted = status === 'delivered';

  const [pendingOutForDeliveryTaskId, setPendingOutForDeliveryTaskId] = useState(null);
  const [pendingDeliveredTaskId, setPendingDeliveredTaskId] = useState(null);
  const [deliveredDialogOpen, setDeliveredDialogOpen] = useState(false);
  const [deliveredForm, setDeliveredForm] = useState({
    dropLocation: 'Front Door',
    otherDropLocation: '',
    deliveryNotes: '',
    deliveryPhotoUrl: '',
  });
  const [uploadingProof, setUploadingProof] = useState(false);
  const [message, setMessage] = useState(null);
  const proofFileRef = useRef(null);
  const outForDeliveryPending = pendingOutForDeliveryTaskId === taskId;
  const deliveredPending = pendingDeliveredTaskId === taskId;
  const selectedDropLocation = deliveredForm.dropLocation === 'Other'
    ? trimDriverLabel(deliveredForm.otherDropLocation)
    : trimDriverLabel(deliveredForm.dropLocation);

  if (isCompleted) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2 dark:border-emerald-900/60 dark:bg-emerald-950/30">
        <p className="text-[10px] uppercase tracking-wider text-emerald-700 font-semibold dark:text-emerald-200">Operational Status</p>
        <p className="text-xs font-semibold text-emerald-800 mt-1 dark:text-emerald-100">Delivered</p>
      </div>
    );
  }

  if (!taskId || (!eligibleOutForDeliveryStatus && !isOutForDelivery)) return null;

  async function markOutForDelivery() {
    if (!hasDriver) return;
    if (!window.confirm('Mark this task as Out For Delivery in Operations? Customer delivery notifications are handled by separate backend gates and are not sent directly by this button.')) return;

    setPendingOutForDeliveryTaskId(taskId);
    setMessage(null);

    try {
      const res = await base44.functions.invoke('markAdminFulfillmentTaskOutForDelivery', {
        fulfillment_task_id: taskId,
        request_id: outForDeliveryRequestId(taskId),
        reason: 'Marked out for delivery from Delivery Queue.',
      });
      const result = unwrapBase44Result(res);
      if (!result?.success) throw new Error('out_for_delivery_failed');
      setMessage({ type: 'success', text: 'Task marked Out For Delivery.' });
      await onStatusSuccess?.();
    } catch {
      setMessage({ type: 'error', text: 'Unable to mark task out for delivery.' });
    } finally {
      setPendingOutForDeliveryTaskId(null);
    }
  }

  async function uploadProofPhoto(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadingProof(true);
    setMessage(null);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setDeliveredForm(prev => ({ ...prev, deliveryPhotoUrl: file_url || '' }));
    } catch {
      setMessage({ type: 'error', text: 'Unable to upload proof photo.' });
    } finally {
      setUploadingProof(false);
      event.target.value = '';
    }
  }

  function updateDeliveredForm(field, value) {
    setDeliveredForm(prev => ({
      ...prev,
      [field]: value,
    }));
  }

  async function markDelivered(event) {
    event?.preventDefault?.();
    if (!hasDriver) return;
    if (!selectedDropLocation) {
      setMessage({ type: 'error', text: 'Choose where the order was left.' });
      return;
    }

    setPendingDeliveredTaskId(taskId);
    setMessage(null);

    try {
      const notes = trimDriverLabel(deliveredForm.deliveryNotes).slice(0, 300);
      const res = await base44.functions.invoke('recordAdminFulfillmentTaskDelivered', {
        fulfillment_task_id: taskId,
        request_id: deliveredRequestId(taskId),
        reason: notes || 'Marked delivered from Delivery Queue.',
        delivery_drop_location: selectedDropLocation.slice(0, 120),
        delivery_notes: notes,
        delivery_photo_url: trimDriverLabel(deliveredForm.deliveryPhotoUrl).slice(0, 500),
      });
      const result = unwrapBase44Result(res);
      if (!result?.success) throw new Error('delivered_failed');
      setMessage({
        type: result.proof_drop_omitted ? 'warning' : 'success',
        text: result.proof_drop_omitted
          ? 'Task marked Delivered. Proof/drop details were not accepted by the backend contract.'
          : 'Task marked Delivered with delivery details.',
      });
      setDeliveredDialogOpen(false);
      setDeliveredForm({
        dropLocation: 'Front Door',
        otherDropLocation: '',
        deliveryNotes: '',
        deliveryPhotoUrl: '',
      });
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
        <Dialog open={deliveredDialogOpen} onOpenChange={open => !deliveredPending && setDeliveredDialogOpen(open)}>
          <button
            type="button"
            onClick={() => {
              setMessage(null);
              setDeliveredDialogOpen(true);
            }}
            disabled={deliveredPending}
            className="h-8 rounded-lg bg-nuvira-gradient px-3 text-xs font-semibold text-white disabled:opacity-60"
          >
            {deliveredPending ? 'Saving...' : 'Mark Delivered'}
          </button>
          <DialogContent className="max-w-xl gap-0 overflow-y-auto border-emerald-200 bg-card p-0 text-card-foreground dark:border-emerald-900/70">
            <DialogHeader className="border-b border-border bg-secondary/50 px-4 py-4 pr-12 text-left">
              <DialogTitle className="text-base font-black text-foreground">Delivery Completed</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Record where the order was left and attach an optional proof photo. Customer notifications are handled by backend gates.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={markDelivered} className="space-y-4 px-4 py-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground" htmlFor={`drop-location-${taskId}`}>
                    Drop Location
                  </label>
                  <select
                    id={`drop-location-${taskId}`}
                    value={deliveredForm.dropLocation}
                    onChange={event => updateDeliveredForm('dropLocation', event.target.value)}
                    disabled={deliveredPending}
                    className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm font-semibold text-foreground outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
                  >
                    {DELIVERY_DROP_OPTIONS.map(option => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground" htmlFor={`delivered-by-${taskId}`}>
                    Driver
                  </label>
                  <input
                    id={`delivered-by-${taskId}`}
                    type="text"
                    value={assignedDriver}
                    readOnly
                    className="h-10 w-full rounded-lg border border-border bg-secondary/60 px-3 text-sm font-semibold text-foreground"
                  />
                </div>
              </div>

              {deliveredForm.dropLocation === 'Other' && (
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground" htmlFor={`other-drop-location-${taskId}`}>
                    Specific Location
                  </label>
                  <input
                    id={`other-drop-location-${taskId}`}
                    type="text"
                    value={deliveredForm.otherDropLocation}
                    onChange={event => updateDeliveredForm('otherDropLocation', event.target.value.slice(0, 120))}
                    disabled={deliveredPending}
                    placeholder="Example: left with concierge"
                    className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring disabled:opacity-60"
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground" htmlFor={`delivery-notes-${taskId}`}>
                  Delivery Notes
                </label>
                <textarea
                  id={`delivery-notes-${taskId}`}
                  value={deliveredForm.deliveryNotes}
                  onChange={event => updateDeliveredForm('deliveryNotes', event.target.value.slice(0, 300))}
                  disabled={deliveredPending}
                  placeholder="Optional notes for the route record"
                  rows={3}
                  className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring disabled:opacity-60"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Proof Photo</p>
                    <p className="text-xs text-muted-foreground">Optional, but useful for completed-delivery disputes.</p>
                  </div>
                  {deliveredForm.deliveryPhotoUrl && (
                    <button
                      type="button"
                      onClick={() => updateDeliveredForm('deliveryPhotoUrl', '')}
                      disabled={deliveredPending}
                      className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-background px-2 text-xs font-semibold text-foreground disabled:opacity-60"
                    >
                      <X className="h-3.5 w-3.5" />
                      Remove
                    </button>
                  )}
                </div>
                <input
                  ref={proofFileRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={uploadProofPhoto}
                />
                {deliveredForm.deliveryPhotoUrl ? (
                  <div className="overflow-hidden rounded-xl border border-border bg-secondary/40">
                    <img
                      src={deliveredForm.deliveryPhotoUrl}
                      alt="Delivery proof preview"
                      className="max-h-52 w-full object-cover"
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => proofFileRef.current?.click()}
                    disabled={uploadingProof || deliveredPending}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-secondary/40 px-4 py-4 text-sm font-semibold text-foreground transition hover:bg-secondary disabled:opacity-60"
                  >
                    {uploadingProof ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      <Camera className="h-4 w-4" />
                    )}
                    {uploadingProof ? 'Uploading...' : 'Take or Upload Photo'}
                  </button>
                )}
              </div>

              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-medium text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
                This action records operational delivery completion. It does not manually send customer notifications from this screen.
              </div>

              <DialogFooter className="gap-2 border-t border-border pt-4 sm:space-x-0">
                <button
                  type="button"
                  onClick={() => setDeliveredDialogOpen(false)}
                  disabled={deliveredPending}
                  className="h-10 rounded-lg border border-border bg-background px-4 text-sm font-semibold text-foreground disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={deliveredPending || uploadingProof || !selectedDropLocation}
                  className="h-10 rounded-lg bg-nuvira-gradient px-4 text-sm font-black text-white disabled:opacity-60"
                >
                  {deliveredPending ? 'Saving...' : 'Confirm Delivered'}
                </button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {eligibleOutForDeliveryStatus && hasDriver && (
        <button
          type="button"
          onClick={markOutForDelivery}
          disabled={outForDeliveryPending}
          className="h-8 rounded-lg bg-nuvira-gradient px-3 text-xs font-semibold text-white disabled:opacity-60"
        >
          {outForDeliveryPending ? 'Saving...' : 'Mark Out For Delivery'}
        </button>
      )}

      {!hasDriver && (
        <p className="text-xs font-semibold text-muted-foreground">Assign driver first</p>
      )}

      {message && (
        <p className={`text-xs ${
          message.type === 'error'
            ? 'text-destructive'
            : message.type === 'warning'
              ? 'text-amber-700 dark:text-amber-300'
              : 'text-green-700 dark:text-green-300'
        }`}>
          {message.text}
        </p>
      )}
    </div>
  );
}

function NativeDeliveryReadOnlyNotice({ stop }) {
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2 dark:border-emerald-900/60 dark:bg-emerald-950/30">
      <div className="flex items-start gap-2">
        <Truck className="w-3.5 h-3.5 text-emerald-700 mt-0.5 shrink-0 dark:text-emerald-300" />
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-emerald-800 font-semibold dark:text-emerald-100">
            {isNativeDeliveryTaskStop(stop) ? 'Native FulfillmentTask' : 'Native Delivery Order'}
          </p>
          <p className="text-xs text-emerald-800 mt-1 dark:text-emerald-200/80">
            Customer App native task. Operational actions are exact-task gated; diagnostics remain available below when a gate blocks execution.
          </p>
        </div>
      </div>
    </div>
  );
}

function NativeDeliveryActionControls({ stop, onActionSuccess }) {
  const taskId = stop.task_id;
  const status = taskStatusKey(stop.task_status || stop.delivery_status);
  const assignedDriver = trimDriverLabel(stop.assigned_driver);
  const hasDriver = Boolean(assignedDriver);
  const [driverLabel, setDriverLabel] = useState(assignedDriver || '');
  const [pendingAction, setPendingAction] = useState(null);
  const [message, setMessage] = useState(null);
  const [deliveredDialogOpen, setDeliveredDialogOpen] = useState(false);
  const [deliveredForm, setDeliveredForm] = useState({
    dropLocation: 'Front Door',
    otherDropLocation: '',
    deliveryNotes: '',
    deliveryPhotoUrl: '',
  });
  const [uploadingProof, setUploadingProof] = useState(false);
  const proofFileRef = useRef(null);
  const selectedDropLocation = deliveredForm.dropLocation === 'Other'
    ? trimDriverLabel(deliveredForm.otherDropLocation)
    : trimDriverLabel(deliveredForm.dropLocation);
  const isTerminal = status === 'delivered' || status === 'cancelled' || status === 'unable_to_deliver';
  const canAssign = Boolean(taskId) && !isTerminal;
  const canPack = Boolean(taskId) && ['pending', 'scheduled', 'assigned', 'in_production'].includes(status);
  const canOutForDelivery = Boolean(taskId) && hasDriver && ['packed', 'bottled_packed', 'ready_for_delivery'].includes(status);
  const canDeliver = Boolean(taskId) && hasDriver && status === 'out_for_delivery';
  const pending = Boolean(pendingAction);

  function updateDeliveredForm(field, value) {
    setDeliveredForm(prev => ({ ...prev, [field]: value }));
  }

  function notificationText(result) {
    const projection = result?.customer_order_projection || {};
    const notification = result?.customer_notification || {};
    const pieces = [];
    if (projection.updated) pieces.push('customer order updated');
    if (notification.sent) pieces.push('customer notified');
    if (notification.queued) pieces.push('customer notification queued');
    else if (notification.attempted && !notification.sent) pieces.push(`notification ${notification.reason ? formatLabel(notification.reason) : 'not sent'}`);
    return pieces.length ? ` (${pieces.join(', ')})` : '';
  }

  async function runNativeAction(action, extras = {}) {
    if (!taskId) return;
    const nextDriver = trimDriverLabel(driverLabel || assignedDriver);
    if (action === 'assign') {
      const labelError = validateDriverLabel(nextDriver);
      if (labelError) {
        setMessage({ type: 'error', text: labelError });
        return;
      }
    }

    const customerImpact = action === 'out_for_delivery' || action === 'delivered_operational'
      ? ' This will also project customer-visible order status and use the gated customer notification path.'
      : '';
    if (action !== 'delivered_operational' && !window.confirm(`Run ${formatLabel(action)} for ${stop.order_number || taskId}?${customerImpact}`)) {
      return;
    }

    setPendingAction(action);
    setMessage(null);

    try {
      const payload = {
        mode: 'live',
        confirmation: 'execute_native_fulfillment_task_lifecycle',
        fulfillment_task_id: taskId,
        action,
        request_id: nativeExecuteRequestId(action, stop),
        reason: extras.reason || `Admin Delivery Queue native ${formatLabel(action)}.`,
        ...extras,
      };

      if (action === 'assign') {
        payload.assigned_driver = nextDriver;
      }
      if (action === 'out_for_delivery' || action === 'delivered_operational') {
        payload.update_customer_order_status = true;
        payload.notify_customer = true;
      }

      const res = await base44.functions.invoke('executeNativeFulfillmentTaskLifecycle', payload);
      const result = unwrapBase44Result(res);
      if (!result?.success) {
        const gate = result?.error_code ? ` (${formatLabel(result.error_code)})` : '';
        throw new Error(`${result?.error || 'Native delivery action was not allowed'}${gate}`);
      }

      setMessage({
        type: result.warnings?.length ? 'warn' : 'success',
        text: result.skipped
          ? `Native ${formatLabel(action)} was already recorded.`
          : `Native ${formatLabel(action)} completed${notificationText(result)}.`,
      });
      if (action === 'delivered_operational') {
        setDeliveredDialogOpen(false);
        setDeliveredForm({
          dropLocation: 'Front Door',
          otherDropLocation: '',
          deliveryNotes: '',
          deliveryPhotoUrl: '',
        });
      }
      await onActionSuccess?.();
    } catch (error) {
      setMessage({ type: 'error', text: error?.message || `Unable to run ${formatLabel(action)}.` });
    } finally {
      setPendingAction(null);
    }
  }

  async function uploadProofPhoto(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadingProof(true);
    setMessage(null);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setDeliveredForm(prev => ({ ...prev, deliveryPhotoUrl: file_url || '' }));
    } catch {
      setMessage({ type: 'error', text: 'Unable to upload proof photo.' });
    } finally {
      setUploadingProof(false);
      event.target.value = '';
    }
  }

  async function markDelivered(event) {
    event?.preventDefault?.();
    if (!selectedDropLocation) {
      setMessage({ type: 'error', text: 'Choose where the order was left.' });
      return;
    }
    const notes = trimDriverLabel(deliveredForm.deliveryNotes).slice(0, 300);
    await runNativeAction('delivered_operational', {
      reason: notes || 'Marked delivered from Customer App Delivery Queue.',
      delivery_drop_location: selectedDropLocation.slice(0, 120),
      delivery_notes: notes,
      delivery_photo_url: trimDriverLabel(deliveredForm.deliveryPhotoUrl).slice(0, 500),
    });
  }

  if (!taskId) return null;

  return (
    <div className="rounded-lg border border-border/50 bg-background p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Native Delivery Controls</p>
          <p className="text-[10px] text-muted-foreground mt-1">
            {stop.is_test_task
              ? 'Internal validation task. Customer order projection and notifications are server-forbidden.'
              : 'Exact task command with customer-status and notification projection for delivery milestones.'}
          </p>
        </div>
        <AdminStatusPill value={stop.task_status} label={formatLabel(stop.task_status)} />
      </div>

      {!isTerminal && (
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
          <input
            type="text"
            value={driverLabel}
            onChange={event => setDriverLabel(event.target.value.slice(0, 120))}
            placeholder="Driver name or internal label"
            disabled={pending}
            maxLength={120}
            className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring disabled:opacity-60"
          />
          <button
            type="button"
            onClick={() => runNativeAction('assign')}
            disabled={pending || !canAssign || !trimDriverLabel(driverLabel || assignedDriver)}
            className="h-10 rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground disabled:opacity-50"
          >
            {pendingAction === 'assign' ? 'Assigning...' : hasDriver ? 'Update Driver' : 'Assign Driver'}
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <button
          type="button"
          onClick={() => runNativeAction('pack')}
          disabled={pending || !canPack}
          className="h-10 rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground disabled:opacity-50"
        >
          {pendingAction === 'pack' ? 'Saving...' : 'Mark Packed'}
        </button>
        <button
          type="button"
          onClick={() => runNativeAction('out_for_delivery')}
          disabled={pending || !canOutForDelivery}
          className="h-10 rounded-lg bg-nuvira-gradient px-3 text-xs font-semibold text-white disabled:opacity-50"
        >
          {pendingAction === 'out_for_delivery' ? 'Saving...' : 'Out For Delivery'}
        </button>
        <Dialog open={deliveredDialogOpen} onOpenChange={open => !pending && setDeliveredDialogOpen(open)}>
          <button
            type="button"
            onClick={() => {
              setMessage(null);
              setDeliveredDialogOpen(true);
            }}
            disabled={pending || !canDeliver}
            className="h-10 rounded-lg bg-nuvira-gradient px-3 text-xs font-semibold text-white disabled:opacity-50"
          >
            {pendingAction === 'delivered_operational' ? 'Saving...' : 'Mark Delivered'}
          </button>
          <DialogContent className="max-w-xl gap-0 overflow-y-auto border-emerald-200 bg-card p-0 text-card-foreground dark:border-emerald-900/70">
            <DialogHeader className="border-b border-border bg-secondary/50 px-4 py-4 pr-12 text-left">
              <DialogTitle className="text-base font-black text-foreground">Complete Delivery</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Record drop location and optional proof. This projects the order to delivered and uses the gated notification path once.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={markDelivered} className="space-y-4 px-4 py-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground" htmlFor={`native-drop-location-${taskId}`}>
                    Drop Location
                  </label>
                  <select
                    id={`native-drop-location-${taskId}`}
                    value={deliveredForm.dropLocation}
                    onChange={event => updateDeliveredForm('dropLocation', event.target.value)}
                    disabled={pending}
                    className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm font-semibold text-foreground outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
                  >
                    {DELIVERY_DROP_OPTIONS.map(option => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground" htmlFor={`native-delivered-driver-${taskId}`}>
                    Driver
                  </label>
                  <input
                    id={`native-delivered-driver-${taskId}`}
                    type="text"
                    value={assignedDriver || driverLabel}
                    readOnly
                    className="h-10 w-full rounded-lg border border-border bg-secondary/60 px-3 text-sm font-semibold text-foreground"
                  />
                </div>
              </div>

              {deliveredForm.dropLocation === 'Other' && (
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground" htmlFor={`native-other-drop-location-${taskId}`}>
                    Specific Location
                  </label>
                  <input
                    id={`native-other-drop-location-${taskId}`}
                    type="text"
                    value={deliveredForm.otherDropLocation}
                    onChange={event => updateDeliveredForm('otherDropLocation', event.target.value.slice(0, 120))}
                    disabled={pending}
                    placeholder="Example: left with concierge"
                    className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring disabled:opacity-60"
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground" htmlFor={`native-delivery-notes-${taskId}`}>
                  Delivery Notes
                </label>
                <textarea
                  id={`native-delivery-notes-${taskId}`}
                  value={deliveredForm.deliveryNotes}
                  onChange={event => updateDeliveredForm('deliveryNotes', event.target.value.slice(0, 300))}
                  disabled={pending}
                  placeholder="Optional notes for the route record"
                  rows={3}
                  className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring disabled:opacity-60"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Proof Photo</p>
                    <p className="text-xs text-muted-foreground">Optional, but recommended for completed deliveries.</p>
                  </div>
                  {deliveredForm.deliveryPhotoUrl && (
                    <button
                      type="button"
                      onClick={() => updateDeliveredForm('deliveryPhotoUrl', '')}
                      disabled={pending}
                      className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-background px-2 text-xs font-semibold text-foreground disabled:opacity-60"
                    >
                      <X className="h-3.5 w-3.5" />
                      Remove
                    </button>
                  )}
                </div>
                <input
                  ref={proofFileRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={uploadProofPhoto}
                />
                {deliveredForm.deliveryPhotoUrl ? (
                  <div className="overflow-hidden rounded-xl border border-border bg-secondary/40">
                    <img src={deliveredForm.deliveryPhotoUrl} alt="Delivery proof preview" className="max-h-52 w-full object-cover" />
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => proofFileRef.current?.click()}
                    disabled={uploadingProof || pending}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-secondary/40 px-4 py-4 text-sm font-semibold text-foreground transition hover:bg-secondary disabled:opacity-60"
                  >
                    {uploadingProof ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                    {uploadingProof ? 'Uploading...' : 'Take or Upload Photo'}
                  </button>
                )}
              </div>

              <DialogFooter className="gap-2 border-t border-border pt-4 sm:space-x-0">
                <button
                  type="button"
                  onClick={() => setDeliveredDialogOpen(false)}
                  disabled={pending}
                  className="h-10 rounded-lg border border-border bg-background px-4 text-sm font-semibold text-foreground disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={pending || uploadingProof || !selectedDropLocation}
                  className="h-10 rounded-lg bg-nuvira-gradient px-4 text-sm font-black text-white disabled:opacity-60"
                >
                  {pendingAction === 'delivered_operational' ? 'Saving...' : 'Confirm Delivered'}
                </button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {message && (
        <p className={`text-xs ${
          message.type === 'error'
            ? 'text-destructive'
            : message.type === 'warn'
              ? 'text-cyan-700 dark:text-cyan-200'
              : 'text-green-700 dark:text-green-300'
        }`}>
          {message.text}
        </p>
      )}
    </div>
  );
}

function NativeOrderScheduleCorrectionPanel({ stop, selectedDate, onCorrected }) {
  const [deliveryDate, setDeliveryDate] = useState(stop.delivery_date || selectedDate || '');
  const [productionDate, setProductionDate] = useState(stop.production_date || (selectedDate ? shiftDate(selectedDate, -1) : ''));
  const [windowLabel, setWindowLabel] = useState(stop.delivery_window_label || '');
  const [preview, setPreview] = useState(null);
  const [pending, setPending] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [message, setMessage] = useState(null);

  const blockers = Array.isArray(preview?.blockers) ? preview.blockers : [];
  const warnings = Array.isArray(preview?.warnings) ? preview.warnings : [];
  const projectedWrites = Array.isArray(preview?.projected_writes) ? preview.projected_writes : [];
  const canPreview = Boolean(stop.order_number && deliveryDate && productionDate);
  const canRun = Boolean(preview?.schedule_correction_ready && !pending && !actionPending);

  function schedulePayload(mode = 'dry_run') {
    return {
      mode,
      order_number: stop.order_number,
      delivery_date: deliveryDate,
      production_date: productionDate,
      delivery_window_label: windowLabel || undefined,
      request_id: nativeScheduleCorrectionRequestId(stop),
    };
  }

  async function runPreview() {
    if (!canPreview) {
      setMessage({ type: 'error', text: 'Order number, delivery date, and production date are required before preview.' });
      return;
    }

    setPending(true);
    setPreview(null);
    setMessage(null);

    try {
      const res = await base44.functions.invoke('previewNativeOrderScheduleCorrection', schedulePayload('dry_run'));
      const result = unwrapBase44Result(res);
      if (result?.error && result?.success !== true) throw new Error(result.error);
      setPreview(result);
      setMessage({
        type: result.schedule_correction_ready ? 'success' : 'warn',
        text: result.schedule_correction_ready
          ? 'Native schedule correction preview passed. Execution remains exact-order gated.'
          : 'Native schedule correction has blockers or warnings.',
      });
    } catch (error) {
      setMessage({ type: 'error', text: error?.message || 'Unable to preview native schedule correction.' });
    } finally {
      setPending(false);
    }
  }

  async function runCorrection() {
    if (!canRun) return;
    if (!window.confirm(`Correct native schedule for order ${stop.order_number} to delivery ${deliveryDate} and production ${productionDate}? This updates only native operational order schedule fields and does not create a task or notify customers.`)) {
      return;
    }

    setActionPending(true);
    setMessage(null);

    try {
      const requestId = nativeScheduleCorrectionRequestId(stop);
      const res = await base44.functions.invoke('executeNativeOrderScheduleCorrection', {
        ...schedulePayload('live'),
        request_id: requestId,
        confirmation: 'execute_native_order_schedule_correction',
      });
      const result = unwrapBase44Result(res);
      if (!result?.success) {
        const gate = result?.error_code ? ` (${formatLabel(result.error_code)})` : '';
        throw new Error(`${result?.error || 'Native schedule correction was not allowed'}${gate}`);
      }
      setPreview(null);
      setMessage({
        type: result.skipped ? 'warn' : 'success',
        text: result.skipped ? 'Native schedule correction was already recorded.' : 'Native schedule corrected.',
      });
      await onCorrected?.();
    } catch (error) {
      setMessage({ type: 'error', text: nativeScheduleCorrectionErrorText(error) });
    } finally {
      setActionPending(false);
    }
  }

  return (
    <div className="rounded-lg border border-sky-200 bg-sky-50/70 p-2 space-y-3 dark:border-sky-900/60 dark:bg-sky-950/30">
      <div>
        <p className="text-[10px] uppercase tracking-wider text-sky-950 font-semibold dark:text-sky-100">Native Schedule Correction</p>
        <p className="text-[10px] text-sky-900 mt-1 dark:text-sky-200/80">
          For native delivery orders missing schedule fields. Preview first. Execution is exact-order gated and does not create tasks, notify customers, call providers, deduct inventory, or run sync/repair.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <label className="space-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Delivery date</span>
          <input
            type="text"
            inputMode="numeric"
            placeholder="YYYY-MM-DD"
            value={deliveryDate}
            onChange={event => setDeliveryDate(event.target.value.slice(0, 10))}
            disabled={pending || actionPending}
            className="w-full h-9 rounded-lg border border-border bg-card px-3 text-xs"
          />
          {!deliveryDate && (
            <span className="text-[10px] text-cyan-700 dark:text-cyan-300">
              Required. Route filter is {formatDate(selectedDate)} and is prefilled for review.
            </span>
          )}
        </label>
        <label className="space-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Production date</span>
          <input
            type="text"
            inputMode="numeric"
            placeholder="YYYY-MM-DD"
            value={productionDate}
            onChange={event => setProductionDate(event.target.value.slice(0, 10))}
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
          className="h-9 rounded-lg border border-sky-300 bg-white px-3 text-xs font-semibold text-sky-950 disabled:opacity-50 dark:border-sky-800/70 dark:bg-background/70 dark:text-sky-100"
        >
          {pending ? 'Checking...' : 'Check Schedule'}
        </button>
        <button
          type="button"
          disabled={!canRun}
          onClick={runCorrection}
          className="h-9 rounded-lg bg-nuvira-gradient px-3 text-xs font-semibold text-white disabled:opacity-50"
        >
          {actionPending ? 'Saving...' : 'Save Schedule'}
        </button>
      </div>

      {message && (
        <p className={`text-xs ${
          message.type === 'error'
            ? 'text-destructive'
            : message.type === 'warn'
              ? 'text-cyan-700 dark:text-cyan-300'
              : 'text-green-700 dark:text-green-300'
        }`}>
          {message.text}
        </p>
      )}

      {preview && (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg bg-card p-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Ready</p>
              <p className="text-sm font-bold">{preview.schedule_correction_ready ? 'Yes' : 'No'}</p>
            </div>
            <div className="rounded-lg bg-card p-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Native Write</p>
              <p className="text-sm font-bold">{preview.native_write_allowed ? 'Yes' : 'No'}</p>
            </div>
            <div className="rounded-lg bg-card p-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Tasks</p>
              <p className="text-sm font-bold">{preview.existing_task_count || 0}</p>
            </div>
          </div>

          {(blockers.length > 0 || warnings.length > 0) && (
            <div className="space-y-1">
              {blockers.map(blocker => (
                <div key={`native-schedule-blocker-${blocker}`} className="flex items-start gap-2 text-xs text-cyan-800 dark:text-cyan-200">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>Blocker: {formatLabel(blocker)}</span>
                </div>
              ))}
              {warnings.map(warning => (
                <div key={`native-schedule-warning-${warning}`} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>{formatLabel(warning)}</span>
                </div>
              ))}
            </div>
          )}

          {projectedWrites.length > 0 && (
            <p className="text-[10px] text-muted-foreground">
              Checked fields: {projectedWrites.map(formatLabel).join(', ')}
            </p>
          )}

          {preview.patch_draft && (
            <p className="text-[10px] text-muted-foreground">
              Draft: delivery {preview.patch_draft.assigned_delivery_date}; production {preview.patch_draft.production_date}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function NativeFulfillmentTaskMaterializationPanel({ stop, selectedDate, onMaterialized }) {
  const [deliveryDate, setDeliveryDate] = useState(stop.delivery_date || selectedDate || '');
  const [productionDate, setProductionDate] = useState(stop.production_date || (selectedDate ? shiftDate(selectedDate, -1) : ''));
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
      const result = unwrapBase44Result(res);
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
      const result = unwrapBase44Result(res);
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
    <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-2 space-y-3 dark:border-emerald-900/60 dark:bg-emerald-950/30">
      <div>
        <p className="text-[10px] uppercase tracking-wider text-emerald-900 font-semibold dark:text-emerald-100">Native Task Materialization</p>
        <p className="text-[10px] text-emerald-800 mt-1 dark:text-emerald-200/80">
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
            <span className="text-[10px] text-cyan-700 dark:text-cyan-300">
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
          className="h-9 rounded-lg border border-emerald-300 bg-white px-3 text-xs font-semibold text-emerald-900 disabled:opacity-50 dark:border-emerald-800/70 dark:bg-background/70 dark:text-emerald-100"
        >
          {pending ? 'Checking...' : 'Check Task'}
        </button>
        <button
          type="button"
          disabled={!canRun}
          onClick={runMaterialization}
          className="h-9 rounded-lg bg-nuvira-gradient px-3 text-xs font-semibold text-white disabled:opacity-50"
        >
          {actionPending ? 'Saving...' : 'Create Task'}
        </button>
      </div>

      {message && (
        <p className={`text-xs ${
          message.type === 'error'
            ? 'text-destructive'
            : message.type === 'warn'
              ? 'text-cyan-700'
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
                <div key={`materialization-blocker-${blocker}`} className="flex items-start gap-2 text-xs text-cyan-800">
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
              Checked fields: {projectedWrites.map(formatLabel).join(', ')}
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
  const orderRef = stop.order_number || '';

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
            <AlertTriangle className={`w-3.5 h-3.5 ${stop.missing_address ? 'text-cyan-600' : 'text-muted-foreground'}`} />
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

      {(completed || stop.delivered_at || stop.delivery_drop_location || stop.delivery_notes) && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2 space-y-1 text-emerald-950 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-100">
          {stop.delivered_at && (
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-300" />
              <p className="text-xs">Delivered: {formatDateTime(stop.delivered_at)}</p>
            </div>
          )}
          {stop.delivery_drop_location && (
            <div className="flex items-center gap-2">
              <MapPin className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-300" />
              <p className="text-xs">Drop location: {stop.delivery_drop_location}</p>
            </div>
          )}
          {stop.delivery_notes && (
            <div className="flex items-start gap-2">
              <ClipboardList className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-700 dark:text-emerald-300" />
              <p className="text-xs">Notes: {stop.delivery_notes}</p>
            </div>
          )}
        </div>
      )}

      <p className="text-[10px] text-muted-foreground pt-1 border-t border-border/40">
        Task ID: {stop.task_id || 'Task pending'}
      </p>

      {orderRef && stop.is_test_task !== true && (
        <Link
          to={`/admin/orders?order=${encodeURIComponent(orderRef)}`}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-semibold text-foreground hover:border-primary/60"
        >
          View order details
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      )}

      {nativeStop ? (
        <>
          <NativeDeliveryReadOnlyNotice stop={stop} />
          {isNativeDeliveryTaskStop(stop) ? (
            <>
              <NativeDeliveryActionControls stop={stop} onActionSuccess={onAssignmentSuccess} />
            </>
          ) : (
            <>
              <NativeOrderScheduleCorrectionPanel
                stop={stop}
                selectedDate={selectedDate}
                onCorrected={onAssignmentSuccess}
              />
              <NativeFulfillmentTaskMaterializationPanel
                stop={stop}
                selectedDate={selectedDate}
                onMaterialized={onAssignmentSuccess}
              />
            </>
          )}
        </>
      ) : (
        HISTORICAL_DELIVERY_ACTIONS_RETIRED ? (
          <div className="rounded-xl border border-border bg-secondary/30 p-3">
            <p className="text-xs font-bold text-foreground">Historical delivery record</p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              This legacy source row remains visible for audit context only. Assignment and delivery changes must use a Customer App fulfillment task.
            </p>
          </div>
        ) : (
          <>
            <DriverAssignmentControls stop={stop} onAssignmentSuccess={onAssignmentSuccess} />
            <OperationalStatusControls stop={stop} onStatusSuccess={onAssignmentSuccess} />
          </>
        )
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
          <p className="text-xs text-muted-foreground mt-1">The Customer App route queue has no rows for this section.</p>
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
  const isPageVisible = usePageVisibility();
  const canUseAdmin = isAdminUser(user);
  const [searchParams, setSearchParams] = useSearchParams();
  const defaultDate = useMemo(() => todayDate(), []);
  const [deliveryDate, setDeliveryDateState] = useState(
    () => normalizeDeliveryDateInput(searchParams.get('date') || searchParams.get('delivery_date')) || defaultDate
  );
  const [testTaskMode, setTestTaskModeState] = useState(
    () => searchParams.get('test_task_mode') === 'only' ? 'only' : 'exclude'
  );
  const showInternalTestValidation = searchParams.get('internal_test_validation') === '1';
  const setDeliveryDate = useCallback((value) => {
    const nextDate = normalizeDeliveryDateInput(value) || defaultDate;
    setDeliveryDateState(nextDate);
    setSearchParams((previous) => {
      const nextParams = new URLSearchParams(previous);
      nextParams.set('date', nextDate);
      nextParams.delete('delivery_date');
      return nextParams;
    }, { replace: true });
  }, [defaultDate, setSearchParams]);
  const setTestTaskMode = useCallback((value) => {
    const nextMode = value === 'only' ? 'only' : 'exclude';
    setTestTaskModeState(nextMode);
    setSearchParams((previous) => {
      const nextParams = new URLSearchParams(previous);
      if (nextMode === 'only') nextParams.set('test_task_mode', 'only');
      else nextParams.delete('test_task_mode');
      return nextParams;
    }, { replace: true });
  }, [setSearchParams]);

  useEffect(() => {
    const routeDate = normalizeDeliveryDateInput(searchParams.get('date') || searchParams.get('delivery_date'));
    if (routeDate && routeDate !== deliveryDate) {
      setDeliveryDateState(routeDate);
    }
    const routeTestTaskMode = searchParams.get('test_task_mode') === 'only' ? 'only' : 'exclude';
    if (routeTestTaskMode !== testTaskMode) {
      setTestTaskModeState(routeTestTaskMode);
    }
  }, [deliveryDate, searchParams, testTaskMode]);

  useEffect(() => {
    if (!canUseAdmin || !isPageVisible || !deliveryDate) return;
    queryClient.invalidateQueries({ queryKey: ['admin-delivery-route-summary', deliveryDate, testTaskMode] });
  }, [canUseAdmin, deliveryDate, isPageVisible, queryClient, testTaskMode]);

  const { data, isLoading, isError, error, isFetching, refetch } = useQuery({
    queryKey: ['admin-delivery-route-summary', deliveryDate, testTaskMode],
    queryFn: async () => {
      const res = await base44.functions.invoke('getAdminDeliveryRouteSummary', {
        delivery_date: deliveryDate,
        limit: 100,
        read_model_mode: DELIVERY_LIFECYCLE_READ_MODEL_MODE,
        test_task_mode: testTaskMode,
      });
      const result = unwrapBase44Result(res);
      if (result?.error) throw new Error(result.error);
      return result || { summary: {}, sections: { delivery_stops: [], completed: [] } };
    },
    enabled: canUseAdmin && isPageVisible && Boolean(deliveryDate),
    staleTime: 60000,
    refetchInterval: isPageVisible ? 30000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  if (!canUseAdmin) {
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
  const hubFallbackReconciliation = data?.hub_fallback_reconciliation || {};
  const suppressedHubRows = hubFallbackReconciliation.suppressed_hub_rows || [];
  const suppressedNativeRows = data?.sections?.suppressed_stale_delivery_tasks || [];
  const hasRows = deliveryStops.length > 0 || completedStops.length > 0 || unscheduledStops.length > 0;
  const deliveryLifecycleReadModel = hasValidDeliveryLifecycleReadModel(data) ? data.delivery_lifecycle_read_model : null;

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
    <div className="min-h-screen bg-background pb-[calc(7rem+env(safe-area-inset-bottom))] md:pb-10">
      <AdminOpsHeader
        title={testTaskMode === 'only' ? 'Delivery Queue · Internal Test' : 'Delivery Queue'}
        subtitle={testTaskMode === 'only'
          ? 'Isolated validation tasks; excluded from operational totals'
          : 'Customer App delivery queue with live operational actions'}
        badge={testTaskMode === 'only' ? 'Test-only' : 'Ops v1'}
        badgeTone={testTaskMode === 'only' ? 'warning' : 'warning'}
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
            {testTaskMode === 'only'
              ? `Showing formally marked internal test tasks only for ${formatDate(deliveryDate)}.`
              : `Showing the Customer App delivery route for ${formatDate(deliveryDate)}.`}
          </p>
          {(showInternalTestValidation || testTaskMode === 'only') && (
            <button
              type="button"
              onClick={() => setTestTaskMode(testTaskMode === 'only' ? 'exclude' : 'only')}
              className={`w-full h-10 rounded-lg border px-3 text-xs font-semibold ${
                testTaskMode === 'only'
                  ? 'border-amber-400 bg-amber-50 text-amber-950 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100'
                  : 'border-border bg-background text-foreground'
              }`}
            >
              {testTaskMode === 'only' ? 'Return to Operational Queue' : 'Open Internal Test Validation'}
            </button>
          )}
          <AdminStatusLegend />
          <p className="text-[10px] text-muted-foreground">Customer App orders and delivery tasks are authoritative. Task controls remain exact-gated and explain any blocked action.</p>
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
            sublabel={summary.bag_returns === null || summary.bag_returns === undefined ? 'Return + Reward' : null}
          />
        </div>

        <div className="rounded-xl border border-border/50 bg-card p-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-foreground">Driver Portal route view</p>
            <p className="text-[10px] text-muted-foreground">Date-pending native orders can be previewed for task creation. Eligible native tasks support driver assignment, packing, out-for-delivery, delivered proof/drop capture, and gated customer status notifications. Route optimization remains preview-only.</p>
          </div>
          <RefreshCw className={`w-4 h-4 text-primary ${isFetching ? 'animate-spin' : ''}`} />
        </div>

        {(deliveryLifecycleReadModel || suppressedHubRows.length > 0) && (
          <DeliveryLifecycleDiagnosticsDisclosure
            model={deliveryLifecycleReadModel}
            reconciliation={hubFallbackReconciliation}
            suppressedRows={suppressedHubRows}
          />
        )}

        {suppressedNativeRows.length > 0 && (
          <div className="rounded-xl border border-cyan-200 bg-cyan-50 p-3 space-y-2 dark:border-cyan-900/60 dark:bg-cyan-950/30">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-cyan-700 mt-0.5 shrink-0 dark:text-cyan-300" />
              <div>
                <p className="text-xs font-semibold text-cyan-950 dark:text-cyan-100">Historical native task context</p>
                <p className="text-[10px] text-cyan-900 dark:text-cyan-200/80">
                  Legacy nonterminal native tasks are excluded from active route totals for this date and kept here for audit context.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-white/70 text-cyan-900 border border-cyan-200 dark:border-cyan-800/70 dark:bg-background/70 dark:text-cyan-100">
                Suppressed native rows: {suppressedNativeRows.length}
              </span>
              {data?.stale_native_delivery_task_detected && (
                <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-white/70 text-cyan-900 border border-cyan-200 dark:border-cyan-800/70 dark:bg-background/70 dark:text-cyan-100">
                  Active route impact prevented
                </span>
              )}
            </div>
            <div className="space-y-1">
              {suppressedNativeRows.slice(0, 5).map(row => (
                <p key={`${row.order_number}-${row.delivery_date}-${row.native_fulfillment_task_id || row.task_id}`} className="text-[10px] text-cyan-900 dark:text-cyan-200/80">
                  {row.order_number}: {formatLabel(row.task_status || row.delivery_status || 'pending')} · {formatLabel(row.suppression_reason)}
                </p>
              ))}
            </div>
          </div>
        )}

        {testTaskMode !== 'only' && (
          <RouteOptimizationPanel deliveryDate={deliveryDate} stops={deliveryStops} />
        )}

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
            <p className="text-xs text-muted-foreground mt-1">This date has no scheduled Customer App delivery tasks or date-pending delivery orders.</p>
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
              subtitle="Active source and native delivery tasks for this date"
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
